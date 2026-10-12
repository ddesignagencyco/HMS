/* Dev-only helper: drive the admin plan routes against a running API.
 *
 * Not part of the app. It exists because `packages/db/seed` has no plans
 * step, so the four plan tables stay empty in development and every
 * plans screen can only be seen in its empty state.
 *
 * Everything here goes through the real HTTP API with a real staff
 * session — nothing is inserted with SQL — so running it also proves the
 * admin write path:
 *
 *   node scripts/dev-admin-plans.mjs
 *
 * Requires a TOTP-verified admin session; run `dev-totp.mjs` first.
 */

const BASE = process.env.API_ORIGIN ?? 'http://localhost:3000/api/v1';
const IDENTIFIER = process.env.SEED_ADMIN ?? 'admin@smart-home.local';
const PASSWORD = process.env.SEED_PASSWORD ?? 'DevPassword!2026';

const json = async (path, init) => {
  const response = await fetch(`${BASE}${path}`, init);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${response.status} ${JSON.stringify(body)}`);
  return body;
};

const post = (token, path, body) => json(path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

const login = async () => {
  /* Reuse the TOTP helper rather than reimplementing the code: it prints
     the staff session JSON on its last line. `TOTP_SECRET` must already be
     in the environment — run `dev-totp.mjs` once to enrol and capture it. */
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, ['scripts/dev-totp.mjs'], { encoding: 'utf8', env: process.env });
  const line = out.trim().split('\n').at(-1);
  return JSON.parse(line).accessToken;
};

const main = async () => {
  const token = await login();

  /* Services the catalogue itself flags plan-eligible, so the create is
     something a real administrator could have done. */
  const categories = await json('/catalogue/categories');
  const services = [];
  for (const category of categories.items) {
    const inCategory = await json(`/catalogue/categories/${encodeURIComponent(category.slug)}/services`);
    services.push(...inCategory.items.filter((service) => service.isPlanEligible && service.isActive));
  }
  process.stdout.write(`plan-eligible services available: ${services.length}\n`);
  if (services.length === 0) throw new Error('no plan-eligible services; seed the catalogue first');

  const existing = await json('/admin/plans', { headers: { Authorization: `Bearer ${token}` } });
  if (existing.items.length > 0) {
    process.stdout.write(`${existing.items.length} plan(s) already exist — nothing created\n`);
    for (const plan of existing.items) process.stdout.write(`  ${plan.nameEn}  ${plan.pricePaisa}paisa  active=${plan.isActive}  subs=${plan.activeSubscriptionsCount}\n`);
    return;
  }

  const wanted = [
    { match: /ac|air/i, visits: 2, days: 180 },
    { match: /plumb|leak|pipe/i, visits: 1, days: 180 },
    { match: /electric|switch|socket/i, visits: 1, days: 180 }
  ];
  const picked = wanted
    .map((w) => services.find((service) => w.match.test(service.nameEn)))
    .filter((service) => service !== undefined)
    .slice(0, 3);

  /* `plan_services` has a composite primary key on (plan_id, service_id), and
     `planCreateSchema` does **not** reject a repeated `serviceId` — so a plan
     listing the same service twice is accepted by the validator and refused by
     the database with a bare "The resource already exists". Deduplicated here.
     Written up as a gap in apps/web/docs/backend_requirement.md. */
  const seen = new Set();
  const unique = picked.filter((service) => (seen.has(service.id) ? false : (seen.add(service.id), true)));
  if (unique.length === 0) throw new Error(`none of the wanted patterns matched: ${services.map((s) => s.nameEn).join(', ')}`);

  const created = await post(token, '/admin/plans', {
    nameEn: 'Annual Home Care',
    nameUr: 'سالانہ گھری نگہداشت',
    description: 'Scheduled visits across the jobs every home needs, bundled at one price.',
    pricePaisa: 2499000,
    durationMonths: 12,
    services: unique.map((service, index) => ({ serviceId: service.id, visitsIncluded: wanted[index].visits, intervalDays: wanted[index].days }))
  });
  process.stdout.write(`created plan ${created.id}\n`);

  /* Second plan, so the public catalogue grid has more than one card and
     the "cheapest first" ordering is visible. */
  const second = unique[0];
  await post(token, '/admin/plans', {
    nameEn: 'Half Yearly Essentials',
    nameUr: 'ششماہی بنیادی',
    description: 'Two essential visits a year.',
    pricePaisa: 990000,
    durationMonths: 6,
    services: [{ serviceId: second.id, visitsIncluded: 2, intervalDays: 180 }]
  });
  process.stdout.write('created a second plan\n');

  const listed = await json('/admin/plans', { headers: { Authorization: `Bearer ${token}` } });
  process.stdout.write(`\nadmin list now holds ${listed.items.length}:\n`);
  for (const plan of listed.items) {
    process.stdout.write(
      `  ${plan.nameEn}  ${plan.pricePaisa}paisa  ${plan.durationMonths}mo  active=${plan.isActive}  services=${plan.services.map((s) => `${s.serviceNameEn}x${s.visitsIncluded}`).join(', ')}\n`
    );
  }

  const publicList = await json('/plans');
  process.stdout.write(`\npublic GET /plans returns ${publicList.items.length} plan(s):\n`);
  for (const plan of publicList.items) {
    process.stdout.write(`  ${plan.nameEn}  ${plan.pricePaisa}paisa  services=${plan.services.map((s) => `${s.serviceNameEn}x${s.visitsIncluded}/${s.intervalDays}d`).join(', ')}\n`);
  }
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
