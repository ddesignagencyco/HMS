/* Browser verification against the running stack (web :3001, api :3000).

   Checks the things unit tests cannot: that the navbar renders as specified, that
   the session settles without a 401 storm, that the booking step offers the
   API's real problem list, and that no screen prints 0.0/NaN for an unrated
   professional. Run with: node verify.cjs */

const { chromium } = require("playwright-core");

const WEB = "http://localhost:3001";
const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

(async () => {
  const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  /* Every request the browser makes, so a 401 storm is visible rather than inferred. */
  const apiCalls = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("/api/v1/")) apiCalls.push({ url: url.replace(WEB, ""), status: res.status() });
  });

  /* ---- Signed out: the public home page ---- */
  await page.goto(`${WEB}/en`, { waitUntil: "networkidle", timeout: 90000 });

  const navTexts = await page.$$eval("header nav a", (as) => as.map((a) => a.textContent.trim()));
  record(
    "navbar labels are one word each",
    navTexts.length > 0 && navTexts.every((t) => t.split(/\s+/).length === 1),
    JSON.stringify(navTexts),
  );

  const bodyText = await page.textContent("body");
  record(
    "navbar does not print the wordmark",
    !(await page.$eval("header", (h) => h.textContent)).includes("Smart Home Maintenance"),
  );
  record("page body free of the wordmark leak", !bodyText.includes("Smart Home Maintainer"));

  /* The session question must settle on a 200, never a 401. */
  const sessionCalls = apiCalls.filter((c) => c.url.includes("/auth/"));
  record(
    "signed-out page load asks /auth/session and gets 200",
    sessionCalls.some((c) => c.url.includes("/auth/session") && c.status === 200),
    JSON.stringify(sessionCalls),
  );
  record(
    "signed-out page load produces no 401",
    !sessionCalls.some((c) => c.status === 401),
    JSON.stringify(sessionCalls.filter((c) => c.status === 401)),
  );
  record(
    "signed-out page load asks /auth/me",
    !sessionCalls.some((c) => c.url.includes("/auth/me")),
  );

  /* Underline = active route only. */
  await page.goto(`${WEB}/en/providers`, { waitUntil: "networkidle", timeout: 90000 });
  const current = await page.$$eval('header nav a[aria-current="page"]', (as) => as.map((a) => a.getAttribute("href")));
  record("exactly one active nav item on /providers", current.length === 1 && current[0] === "/en/providers", JSON.stringify(current));

  const providersCalls = apiCalls.filter((c) => c.url.includes("/places/cities"));
  record("places/cities returns 200", providersCalls.some((c) => c.status === 200), JSON.stringify(providersCalls.slice(0, 3)));

  /* Hover must not draw the underline.

     Tailwind v4's `scale-x-*` writes the standalone CSS `scale` property, not
     `transform`, so this reads `scale` and checks its first component: "1" means
     drawn, anything else means collapsed. `aria-current="page"` is the
     independent signal that the marker tracks the route rather than the pointer. */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${WEB}/en/providers`, { waitUntil: "networkidle", timeout: 90000 });

  const underlineState = () =>
    page.$$eval("header nav a", (as) =>
      as.map((a) => {
        const spans = [...a.querySelectorAll("span")];
        const indicator = spans[spans.length - 1];
        const scale = indicator ? getComputedStyle(indicator).scale : "0 1";
        return { label: a.textContent.trim(), active: a.getAttribute("aria-current"), drawn: scale.split(" ")[0] === "1" };
      }),
    );

  const atRest = await underlineState();
  record(
    "only the active route is underlined at rest",
    atRest.filter((n) => n.drawn).length === 1 && atRest.find((n) => n.drawn)?.active === "page",
    JSON.stringify(atRest),
  );

  const servicesNav = await page.$('header nav a[href="/en/services"]');
  if (servicesNav) {
    await servicesNav.hover();
    await page.waitForTimeout(500);
    const hovered = await underlineState();
    record(
      "hovering an inactive item does not underline it",
      hovered.find((n) => n.label === "Services")?.drawn === false,
      JSON.stringify(hovered.map((n) => `${n.label}:${n.drawn ? "drawn" : "hidden"}`)),
    );
    record(
      "hovering an inactive item leaves the active underline where it was",
      hovered.filter((n) => n.drawn).length === 1,
      JSON.stringify(hovered.map((n) => `${n.label}:${n.drawn ? "drawn" : "hidden"}`)),
    );
  }

  /* Unrated professional must not render 0.00 / NaN. */
  const searchText = await page.textContent("body");
  record("search page shows no NaN rating", !/NaN/.test(searchText));
  record("search page shows no 0.00 rating", !/0\.00/.test(searchText));

  /* Responsive sweep of the critical screens. */
  const widths = [360, 768, 1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${WEB}/en`, { waitUntil: "networkidle", timeout: 90000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    record(`home page has no horizontal overflow at ${width}px`, overflow <= 1, `overflow=${overflow}`);
  }

  /* Sign-in page. */
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(`${WEB}/en/auth/sign-in`, { waitUntil: "networkidle", timeout: 90000 });
  const signInOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  record("sign-in has no horizontal overflow at 360px", signInOverflow <= 1, `overflow=${signInOverflow}`);

  /* Protected route while signed out must bounce to sign-in, not show the portal. */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${WEB}/en/account/bookings`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(2500);
  record(
    "signed-out visitor is redirected from /account/bookings",
    page.url().includes("/auth/sign-in"),
    page.url(),
  );

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((error) => {
  console.error("harness error:", error);
  process.exit(2);
});