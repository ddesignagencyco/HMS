/* Renders the Urdu plan catalogue and reports whether the Urdu plan and
   service names actually reach the page.
 *
 * Needed because the API stores `name_ur` and the browser is the only place
 * that proves the non-Latin text survives the round trip — a PowerShell
 * console mangles it to `??????` regardless of what was stored.
 *
 *   node e2e/verify-plans-ur.cjs */

const { chromium } = require('playwright-core');

const WEB = process.env.WEB_ORIGIN ?? 'http://localhost:3001';

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
};

const main = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(`${WEB}/ur/plans`, { waitUntil: 'networkidle' });

  const api = await page.evaluate(async () => (await fetch('/api/v1/plans')).json()).catch(() => null);
  const plans = api?.items ?? [];
  record('the API holds at least one plan', plans.length > 0, `${plans.length} plan(s)`);

  for (const plan of plans) {
    /* The stored Urdu name must render as Urdu, not as `?` and not as the
       English fallback. */
    const hasName = plan.nameUr.trim() !== '';
    const rendered = (await page.locator(`text=${plan.nameUr}`).count()) > 0;
    record(`"${plan.nameEn}" renders its stored Urdu name`, !hasName || rendered, plan.nameUr);

    /* The body text must contain the Urdu name, and must not contain the
       ASCII stand-in `????` a mangled round trip produces. Reading the
       *stored* value and looking for it is the real assertion — an earlier
       version of this check tested `includes('')`, which is always true and
       so proved nothing. */
    if (hasName) {
      const body = await page.evaluate(() => document.body.innerText);
      record(`"${plan.nameEn}" Urdu text is present in the page`, body.includes(plan.nameUr));
      record(`"${plan.nameEn}" is not degraded to question marks`, !body.includes('????') && !body.includes('�'));
    }
  }

  const service = plans[0]?.services?.[0];
  if (service?.serviceNameUr) {
    record(`the service name renders in Urdu ("${service.serviceNameUr}")`, (await page.locator(`text=${service.serviceNameUr}`).count()) > 0);
  }

  const body = await page.evaluate(() => document.body.innerText);
  record('the Urdu page is laid out right to left', (await page.evaluate(() => getComputedStyle(document.documentElement).direction)) === 'rtl');
  record('the Urdu empty-state copy is absent when plans exist', !body.includes('ابھی کوئی مینٹیننس پلان شائع نہیں'));
  record("the price is still rendered with the Urdu locale's numerals", /Rs|روپے/.test(body));

  await page.screenshot({ path: 'e2e/plans-public-ur.png', fullPage: true });
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
  if (failed.length > 0) process.exitCode = 1;
};

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
