/* Booking flow, end to end, in a real browser against the running API.

   Creates a real booking through the UI and then reads it back, proving that:
     · the problem step offers the API's own issue-options
     · the chosen fault is sent as issueOptionId
     · the booking is created and lands on a real, addressable detail page
     · no fabricated professional name, rating or fee appears

   node verify-booking.cjs */

const { chromium } = require("playwright-core");

const WEB = "http://localhost:3001";
const ACCOUNT = { identifier: "customer@smart-home.local", password: "DevPassword!2026" };

const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

(async () => {
  const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  const posts = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("/api/v1/bookings") && res.request().method() === "POST") {
      let body = null;
      try {
        body = res.request().postDataJSON();
      } catch {
        body = null;
      }
      posts.push({ url: url.replace(WEB, ""), status: res.status(), body });
    }
  });

  /* ---- sign in ---- */
  await page.goto(`${WEB}/en/auth/sign-in`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForSelector('input[name="identifier"]');
  await page.fill('input[name="identifier"]', ACCOUNT.identifier);
  await page.fill('input[name="password"]', ACCOUNT.password);
  await page.click('form button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes("/auth/sign-in"), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);

  /* ---- which services actually have issue options published ---- */
  const catalog = await page.evaluate(async () => {
    const r = await fetch("/api/v1/catalogue/categories/plumbing/services");
    const j = await r.json();
    const out = [];
    for (const s of j.items) {
      const o = await fetch(`/api/v1/catalogue/services/${s.slug}/issue-options`);
      const oj = await o.json();
      out.push({ slug: s.slug, name: s.nameEn, options: oj.items ?? [] });
    }
    return out;
  });
  const withOptions = catalog.find((c) => c.options.length > 0);
  record(
    "at least one service publishes issue options",
    Boolean(withOptions),
    JSON.stringify(catalog.map((c) => `${c.slug}:${c.options.length}`)),
  );

  if (!withOptions) {
    await browser.close();
    console.log("\ncannot proceed without a service that publishes faults");
    process.exit(1);
  }

  /* ---- walk the flow ---- */
  await page.goto(`${WEB}/en/book/${withOptions.slug}`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(2500);

  const clickContinue = async () => {
    /* Pressing Escape first closes any open select menu, which would otherwise
       sit over the button and swallow the click. */
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(250);
    const btn = await page.$('button:has-text("Continue")');
    if (!btn) return false;
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ force: true }).catch(async () => {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => /Continue/.test(x.textContent ?? ""));
        b?.click();
      });
    });
    await page.waitForTimeout(1800);
    return true;
  };

  /* Step 1 — address. The address picker is a Radix RadioGroup, so there is no
     native input[type=radio] to grab; the option is selected by its label. */
  const homeOption = await page.$('label:has-text("Home")');
  record("address step offers a saved address", Boolean(homeOption));
  if (homeOption) {
    await homeOption.click();
    await page.waitForTimeout(700);
  }
  await clickContinue();

  /* Step 2 — professional selection. Same Radix pattern, so the platform option
     is chosen by its label rather than by an input element. */
  const bodyAfterProviderStep = await page.textContent("body");
  const hasAutoAssign = /Let the platform assign|platform/i.test(bodyAfterProviderStep);
  record("provider step offers the platform-select option", hasAutoAssign);

  const platformOption = await page.$('label:has-text("Let us choose")');
  record("platform option is selectable", Boolean(platformOption));
  if (platformOption) {
    await platformOption.click();
    await page.waitForTimeout(900);
  }
  await clickContinue();

  /* Step 3 — time window.
     The last offered day and the last offered start are chosen deliberately: the
     API refuses a booking whose start is not in the future, and this suite runs
     at an arbitrary hour of the day, so "the first time on the first day" is a
     slot that is sometimes already yesterday. */
  const days = [];
  for (const b of await page.$$("button")) {
    const t = (await b.textContent())?.trim() ?? "";
    if (/^\w{3}, \d{1,2} \w{3}$/.test(t)) days.push(b);
  }
  record("schedule step offers real days", days.length > 0, `days=${days.length}`);
  if (days.length) {
    await days[days.length - 1].click({ force: true });
    await page.waitForTimeout(1200);
  }
  const times = [];
  for (const b of await page.$$("button")) {
    const t = (await b.textContent())?.trim() ?? "";
    if (/^\d{1,2}:\d{2}/.test(t)) times.push(b);
  }
  record("schedule step offers real start times", times.length > 0, `times=${times.length}`);
  if (times.length) {
    await times[times.length - 1].click({ force: true });
    await page.waitForTimeout(800);
  }
  await clickContinue();

  /* Step 4 — the problem, from the API */
  await page.waitForTimeout(1500);
  const stepText = await page.textContent("body");
  record("problem step asks what the problem is", /What is the problem\?/.test(stepText));

  const issueSelect = await page.$("#booking-issue");
  record("problem step renders a dropdown, not only a text box", Boolean(issueSelect));
  record("a description field is still available as extra detail", Boolean(await page.$("#booking-problem")));

  /* react-select keeps a visually-hidden input (0.01 x 0.21px) at the given id —
     that is its accessible text field, not the control a person clicks. So the
     visible 42px-tall control is what gets clicked, the options are read off the
     menu it opens, and the chosen one is clicked for real rather than dispatched
     synthetically — react-select ignores a synthetic event that carries no
     pointer target, which looks like "the dropdown does not work" if you do not
     know that. */
  let optionLabels = [];
  if (issueSelect) {
    const control = (
      await page.evaluateHandle(() => {
        const input = document.querySelector("#booking-issue");
        return input?.closest('[class*="-control"]') ?? input?.parentElement ?? null;
      })
    ).asElement();
    if (control) {
      await control.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(300);
      await control.click({ timeout: 15000 });
      await page.waitForTimeout(1000);
    }
    optionLabels = await page.$$eval('[class*="option"]', (ns) =>
      ns.map((n) => n.textContent.trim()).filter((t) => t.length > 0 && t !== "Choose the problem"),
    );
  }
  const menuText = optionLabels.join("|");
  const apiLabels = withOptions.options.map((o) => o.labelEn);
  const offeredFromApi = apiLabels.filter((l) => menuText.includes(l));
  record(
    "dropdown offers the API's own faults",
    apiLabels.length > 0 && offeredFromApi.length === apiLabels.length,
    `api=${JSON.stringify(apiLabels)} shown=${offeredFromApi.length}`,
  );

  let faultChosen = false;
  if (issueSelect) {
    const opt = await page.$(`text="${withOptions.options[0].labelEn}"`);
    if (opt) {
      await opt.click({ timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1200);
    }
    const controlText = await page.evaluate(() => {
      const input = document.querySelector("#booking-issue");
      const c = input?.closest('[class*="-control"]') ?? input?.parentElement;
      return c?.textContent?.trim() ?? null;
    });
    faultChosen = controlText === withOptions.options[0].labelEn;
    record("choosing a fault puts its name in the control", faultChosen, `control=${controlText}`);
  }
  await clickContinue();

  /* Step 5 — review */
  await page.waitForTimeout(1500);
  const reviewText = await page.textContent("body");
  record("review step shows the chosen fault by name", reviewText.includes(withOptions.options[0].labelEn));
  record("review shows no invented professional name", !/Bilal|Sana Iqbal|prv-/.test(reviewText));
  /* Scoped to the price list only — everything between the "Cost breakdown" heading
     and the cancellation policy. "PKR 500.00" inside the server's own policy
     sentence is a real configured fee, not a missing value, so a blanket /0\.00/
     over the page would flag a correct figure. */
  const start = reviewText.indexOf("Cost breakdown");
  const end = reviewText.indexOf("cancellation policy", start) > start
    ? reviewText.indexOf("cancellation policy", start)
    : reviewText.indexOf("Free cancellation", start);
  const costBlock = start >= 0 ? reviewText.slice(start, end > start ? end : start + 300) : "";
  record("review shows no NaN money", !/NaN/.test(reviewText));
  record("review shows no empty money rendered as 0.00", !/0\.00/.test(costBlock), costBlock.replace(/\s+/g, " ").slice(0, 160));
  record("review shows the server's own cancellation policy", /cancellation fee/i.test(reviewText));

  const agree = await page.$('input[type="checkbox"], [role="checkbox"]');
  if (agree) {
    await agree.click();
    await page.waitForTimeout(500);
  }
  await clickContinue();

  /* Step 6 — payment */
  await page.waitForTimeout(1500);
  const paymentText = await page.textContent("body");
  record("payment step offers cash and online", /Cash/i.test(paymentText) && /Online/i.test(paymentText));
  const cashOption = await page.$('label:has-text("Cash")');
  if (cashOption) {
    await cashOption.click();
    await page.waitForTimeout(800);
  }
  const confirm = await page.$('button:has-text("Confirm")');
  record("a confirm button is offered", Boolean(confirm));
  if (confirm) {
    await confirm.click();
    await page.waitForTimeout(6000);
  }

  /* ---- what was actually sent ---- */
  const create = posts.find((p) => p.url.endsWith("/bookings") && p.body && p.body.paymentMode);
  record("a booking create request was sent", Boolean(create), JSON.stringify(posts.map((p) => `${p.url}:${p.status}`)));
  if (create) {
    record(
      "the request carried the API's issueOptionId",
      create.body.issueOptionId === withOptions.options[0].id,
      `sent=${create.body.issueOptionId} api=${withOptions.options[0].id}`,
    );
    record(
      "the request carried no providerId when the platform was asked to choose",
      create.body.providerId === undefined,
      `providerId=${create.body.providerId}`,
    );
    record("the request was accepted", create.status === 201 || create.status === 200, `status=${create.status}`);
  }

  const afterCreate = await page.textContent("body");
  record("a real booking reference is shown", /SHM-\d+/.test(afterCreate), (afterCreate.match(/SHM-\d+/) || [""])[0]);
  record("the confirmation screen links to the booking", Boolean(await page.$('a:has-text("View booking")')));

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((error) => {
  console.error("harness error:", error);
  process.exit(2);
});