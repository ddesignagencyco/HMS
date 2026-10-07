const { chromium } = require("playwright-core");
const WEB = "http://localhost:3001";
const ACCOUNT = { identifier: "customer@smart-home.local", password: "DevPassword!2026" };

const results = [];
const record = (n, ok, d = "") => { results.push({ n, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };

(async () => {
  const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  /* Read the rendered content only. `document.body.textContent` also picks up the
     RSC payload Next embeds for hydration, which contains every dictionary
     string the bundle ships — matching copy against that would test the bundle,
     not the screen. */
  const shown = () => page.$eval("main", (m) => m.innerText.replace(/\s+/g, " ")).catch(() => "");

  await page.goto(`${WEB}/en/auth/sign-in`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForSelector('input[name="identifier"]');
  await page.fill('input[name="identifier"]', ACCOUNT.identifier);
  await page.fill('input[name="password"]', ACCOUNT.password);
  await page.click('form button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes("/auth/sign-in"), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);

  await page.goto(`${WEB}/en/account/bookings`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(3500);

  const apiCodes = await (async () => {
    const login = await fetch("http://localhost:3000/api/v1/auth/login", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ACCOUNT),
    }).then((r) => r.json());
    const body = await fetch("http://localhost:3000/api/v1/bookings", {
      headers: { authorization: `Bearer ${login.accessToken}` },
    }).then((r) => r.json());
    return body.items.map((b) => b.code);
  })();
  record("the API really does return this account's bookings", apiCodes.length > 0, apiCodes.join(", "));

  const inPlay = await shown();
  record(
    "an empty tab does not claim the account has never booked",
    !/No bookings yet/.test(inPlay) && /Nothing in this group/.test(inPlay),
    inPlay.slice(0, 200),
  );

  await page.click('[role="tab"]:has-text("All")');
  await page.waitForTimeout(2000);
  const all = await shown();
  const listed = apiCodes.filter((c) => all.includes(c));
  record("the All tab shows every booking the API returned", listed.length === apiCodes.length, `shown ${listed.length}/${apiCodes.length}`);

  await page.click('[role="tab"]:has-text("Closed")');
  await page.waitForTimeout(1800);
  const closed = await shown();
  console.log("CLOSED>>>", closed.slice(0, 700)); /* The table prints the short status label ("Verified"), not the long one the
     timeline uses ("Work verified"), so the check is on the record itself:
     a VERIFIED booking must appear under Closed rather than in no group at all. */
  record(
    "a verified booking is classified as closed, not as neither",
    /SHM-0000001/.test(closed) && /Verified/i.test(closed),
    closed.match(/SHM-0000001[^A-Z]{0,40}/)?.[0] ?? "not found",
  );

  record("the list shows no NaN", !/NaN/.test(all));
  record("the list shows no unearned 0.00 rating", !/0\.00/.test(all));

  /* Detail page. */
  const link = await page.$('a[href*="/account/bookings/"]');
  if (link) {
    const href = await link.getAttribute("href");
    await page.goto(WEB + href, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(3000);
    const detail = await shown();
    record("a booking detail page renders for a real booking", !/could not find that booking/i.test(detail), detail.slice(0, 180));
    record("the detail shows no NaN", !/NaN/.test(detail));
    record("the detail names the real service", /Blocked Drain/.test(detail));
    record("the detail shows the real status, not a fixed script", /Not taken up/.test(detail));

    const cancelBtn = await page.$('button:has-text("Cancel booking")');
    if (cancelBtn) {
      await cancelBtn.click();
      await page.waitForTimeout(1800);
      const afterCancel = await shown();
      record(
        "cancelling quotes the API's own rule rather than claiming no fee exists",
        /Cancelling this booking now is free/.test(afterCancel) || /Cancelling this booking now costs/.test(afterCancel),
        afterCancel.match(/Cancelling this booking now[^.]*\./i)?.[0] ?? "no line found",
      );
    }
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error("harness error:", e); process.exit(2); });
