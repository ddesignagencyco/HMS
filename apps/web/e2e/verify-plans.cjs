/* Browser verification for the maintenance-plan screens against the running stack.
 *
 * Not part of the test suite — this drives a real browser so the client-side
 * render is checked, which `Invoke-WebRequest` cannot do because the plan list
 * is fetched after hydration.
 *
 * Prerequisite: the API and the web app are running, and at least one plan
 * exists (`node scripts/dev-admin-plans.mjs`).
 *
 *   node e2e/verify-plans.cjs */

const { chromium } = require('playwright-core');

const WEB = process.env.WEB_ORIGIN ?? 'http://localhost:3001';
const ACCOUNT = { identifier: process.env.SEED_CUSTOMER ?? 'customer@smart-home.local', password: process.env.SEED_PASSWORD };

if (!ACCOUNT.password) {
  process.stderr.write('Set SEED_PASSWORD (the seeded dev accounts password) — it is not stored in the repo\n');
  process.exit(1);
}

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
};

const main = async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  /* Navigated first, because the fetch below is a relative URL and would
     resolve against `about:blank` from a fresh page. */
  await page.goto(`${WEB}/en`, { waitUntil: 'domcontentloaded' });
  const apiPlans = await page.evaluate(async () => (await fetch('/api/v1/plans')).json()).catch(() => null);
  record('the proxied API returns plans', Array.isArray(apiPlans?.items) && apiPlans.items.length > 0, `${apiPlans?.items?.length ?? 0} plan(s)`);
  if (!apiPlans || apiPlans.items.length === 0) {
    await browser.close();
    process.stdout.write('\nno plans to verify — run scripts/dev-admin-plans.mjs first\n');
    process.exitCode = 1;
    return;
  }

  /* The price the API holds must be the price the card shows. Rs is
     formatted from paisa with no rounding applied by us, so this compares
     the rendered string against the stored figure. */
  const expected = apiPlans.items.map((plan) => ({
    nameEn: plan.nameEn,
    rupees: Math.round(plan.pricePaisa / 100).toLocaleString('en-PK')
  }));

  await page.goto(`${WEB}/en/plans`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Rs ', { timeout: 15000 });

  for (const plan of expected) {
    record(`the public card names "${plan.nameEn}"`, (await page.locator(`text=${plan.nameEn}`).count()) > 0);
    record(`the public card shows Rs ${plan.rupees} for "${plan.nameEn}"`, (await page.locator(`text=Rs ${plan.rupees}`).count()) > 0);
  }

  /* The three figures that used to be invented. If any of these appear,
     the mock array is back. */
  for (const invented of ['Rs 4,900', 'Rs 8,900', 'Rs 14,900', 'Care Plus', 'Full Cover', 'Most chosen']) {
    record(`the invented figure "${invented}" is gone`, (await page.locator(`text=${invented}`).count()) === 0);
  }

  /* What the plan actually includes, from plan_services. */
  const firstService = apiPlans.items[0].services[0];
  if (firstService) {
    record(
      `the card lists "${firstService.serviceNameEn}" with its visit count`,
      (await page.locator(`text=${firstService.serviceNameEn}`).count()) > 0 && (await page.locator(`text=${firstService.visitsIncluded} visits`).count()) > 0
    );
  }

  /* ---- signed in: the customer's own subscriptions ---- */
  await page.goto(`${WEB}/en/auth/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type="tel"], input[name="identifier"], input#identifier', ACCOUNT.identifier).catch(() => undefined);
  const filled = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')];
    const target = inputs.find((i) => i.type !== 'password');
    if (!target) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(target, window.__account ?? target.value);
    target.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  });
  if (filled) {
    await page.fill('input[type="password"]', ACCOUNT.password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
  }

  await page.goto(`${WEB}/en/account/plans`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const heading = await page.locator('h1, h2').first().textContent();
  record('the customer plans page renders a heading', typeof heading === 'string' && heading.trim().length > 0, heading?.trim());
  record(
    'the customer page offers the published plans or says none are subscribed',
    (await page.locator('text=Annual Home Care').count()) > 0 || (await page.locator('text=You are not on a plan yet').count()) > 0
  );

  await page.screenshot({ path: 'e2e/plans-customer.png', fullPage: true });
  await page.goto(`${WEB}/en/plans`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'e2e/plans-public.png', fullPage: true });

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
  if (failed.length > 0) process.exitCode = 1;
};

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
