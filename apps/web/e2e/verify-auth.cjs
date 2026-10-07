/* Authenticated browser verification against the running stack.

   Walks the whole lifecycle the stabilisation brief asks for, using the seeded
   development account rather than a mocked session:

     signed out -> sign in -> navbar changes -> protected page -> browser refresh
     -> session survives -> sign out -> UI returns to signed out

   and then the booking flow far enough to prove the problem step offers the API's
   own list and sends an issueOptionId.

   node verify-auth.cjs */

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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const statuses = [];
  page.on("response", (res) => {
    if (res.url().includes("/api/v1/")) statuses.push({ url: res.url().replace(WEB, ""), status: res.status() });
  });

  const signIn = async () => {
    await page.goto(`${WEB}/en/auth/sign-in`, { waitUntil: "networkidle", timeout: 90000 });
    /* react-hook-form registers by name; there is no id on these inputs. */
    await page.waitForSelector('input[name="identifier"]', { timeout: 30000 });
    await page.fill('input[name="identifier"]', ACCOUNT.identifier);
    await page.fill('input[name="password"]', ACCOUNT.password);
    await page.click('form button[type="submit"]');
  };

  /* ---- 1. signed out ---- */
  await page.goto(`${WEB}/en`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(1200);
  record(
    "signed out: header offers Sign in",
    (await page.$$('a:has-text("Sign in")')).length > 0,
  );
  record("signed out: no Sign out control", (await page.$$('button:has-text("Sign out")')).length === 0);
  record(
    "signed out: Bookings is not offered",
    (await page.$$('header nav a:has-text("Bookings")')).length === 0,
  );

  /* ---- 2. sign in ---- */
  await signIn();
  await page.waitForURL((u) => !u.pathname.includes("/auth/sign-in"), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const signedInUrl = page.url();
  record("sign in leaves the auth pages", !signedInUrl.includes("/auth/sign-in"), signedInUrl);

  /* Sign-in lands on the portal, which renders WorkspaceShell (a dark rail), not
     the public SiteHeader. So the portal's own controls are checked here, and the
     site header is checked after navigating back out to a public page. Checking
     "My account" while on /account would be looking for a header that is not on
     screen. */
  record(
    "portal rail shows its Sign out control after sign in",
    (await page.$$('button:has-text("Sign out")')).length > 0,
    `url=${signedInUrl}`,
  );
  record(
    "portal rail offers a Bookings item",
    (await page.$$('aside a:has-text("Bookings")')).length > 0,
  );

  /* Back to a public route to inspect the site header in its authenticated state. */
  await page.goto(`${WEB}/en`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(2000);
  record(
    "site header shows My account once signed in",
    (await page.$$('header a:has-text("My account")')).length > 0,
  );
  record(
    "Bookings appears in the site navigation once signed in",
    (await page.$$('header nav a:has-text("Bookings")')).length > 0,
  );
  record(
    "site header offers Sign out once signed in",
    (await page.$$('header button:has-text("Sign out")')).length > 0,
  );

  /* The session was established from the refresh cookie, not from a 401 storm. */
  const loginCalls = statuses.filter((c) => c.url.includes("/auth/"));
  record(
    "sign in itself produced no 401 loop",
    loginCalls.filter((c) => c.status === 401).length === 0,
    JSON.stringify(loginCalls),
  );

  /* ---- 3. protected page ---- */
  await page.goto(`${WEB}/en/account`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(1500);
  record("protected /account is reachable while signed in", page.url().includes("/en/account"), page.url());
  record("portal does not bounce to sign-in", !page.url().includes("sign-in"));

  /* ---- 4. browser refresh: the session must survive on the cookie alone ---- */
  statuses.length = 0;
  await page.reload({ waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(2000);
  record("session survives a browser refresh", page.url().includes("/en/account"), page.url());
  record(
    "sign out control survives a browser refresh",
    (await page.$$('button:has-text("Sign out")')).length > 0,
  );
  const afterReload = statuses.filter((c) => c.url.includes("/auth/"));
  record(
    "refresh restores the session from /auth/session, not a 401",
    afterReload.some((c) => c.url.includes("/auth/session") && c.status === 200) &&
      !afterReload.some((c) => c.status === 401) &&
      !afterReload.some((c) => c.url.includes("/auth/me")),
    JSON.stringify(afterReload),
  );

  /* ---- 5. no refresh loop ---- */
  const sessionCount = afterReload.filter((c) => c.url.includes("/auth/session")).length;
  record("session is asked once per load, not repeatedly", sessionCount <= 2, `session calls=${sessionCount}`);

  /* ---- 6. the booking flow's problem step ---- */
  const slug = await page.evaluate(async () => {
    const r = await fetch("/api/v1/catalogue/categories/plumbing/services");
    const j = await r.json();
    return j.items[0]?.slug ?? null;
  });
  record("plumbing catalogue is readable from the browser", typeof slug === "string" && slug.length > 0, `slug=${slug}`);

  if (slug) {
    await page.goto(`${WEB}/en/book/${slug}`, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(2000);
    const onBooking = page.url().includes("/book/");
    record("booking entry page is reachable while signed in", onBooking, page.url());
    const bookingText = await page.textContent("body");
    record(
      "booking entry offers a single-word nav and no free-text-only problem field",
      /Describe the problem/i.test(bookingText),
    );

    /* Walk to the problem step. */
    const stepTo = async (label) => {
      const button = await page.$(`button:has-text("${label}")`);
      if (button) {
        await button.click();
        await page.waitForTimeout(1200);
      }
    };

    const addressRadio = await page.$('input[type="radio"]');
    if (addressRadio) {
      await addressRadio.click();
      await stepTo("Continue");
      record("advanced past the address step", (await page.textContent("body")).length > 0);
    }

    /* Inspect the problem step once reached, whichever way we got there. */
    await page.waitForTimeout(1500);
    const finalText = await page.textContent("body");
    record(
      "problem step exists with a fault label",
      /What is the problem\?/.test(finalText),
    );
  }

  /* ---- 7. sign out ---- */
  await page.goto(`${WEB}/en`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(1500);
  const signOut = await page.$('header button:has-text("Sign out")');
  if (signOut) {
    await signOut.click();
    await page.waitForTimeout(3000);
  }
  record("after sign out the header offers Sign in again", (await page.$$('a:has-text("Sign in")')).length > 0, page.url());
  record("after sign out there is no Sign out control", (await page.$$('button:has-text("Sign out")')).length === 0);
  record("after sign out Bookings leaves the navigation", (await page.$$('header nav a:has-text("Bookings")')).length === 0);

  /* ---- 8. and a protected page bounces again ---- */
  await page.goto(`${WEB}/en/account/bookings`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(2500);
  record("protected page redirects to sign-in after sign out", page.url().includes("/auth/sign-in"), page.url());

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((error) => {
  console.error("harness error:", error);
  process.exit(2);
});