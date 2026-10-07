# HANDOVER — HMS web frontend

**Written 2026-10-07.** Read this first on any machine, before touching anything.

Its purpose is to let you continue without trusting anyone's memory — including
mine. Every number below was measured in the session that wrote this file, and the
command to re-measure it is given next to it.

---

## 1. Where things stand

| Gate | Command (run from `apps/web`) | Result at handover |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | ✅ clean, 0 errors |
| Lint | `npx eslint src` | ✅ 0 errors, 15 warnings (all pre-existing) |
| Build | `npm run build` | ✅ compiles |
| Tests | `npx vitest run` | ❌ **521 passed / 15 failed** (of 536) |

The build is green. **The test suite is not.** Do not let anyone tell you it is.
Every one of the 15 is one bug — see §4a.

---

## 2. Git state — this matters most

Last commit: **`71e17cb`** — *"feat(web): add initial web app features, components,
tests, and e2e verification scripts"*

**That commit is the last known-good frontend.** Everything below is uncommitted
work sitting on top of it.

```
 M apps/web/docs/PROJECT_PROGRESS.md        docs, updated
 M apps/web/docs/backend_requirement.md     docs, rewritten
 M apps/web/src/components/site-header.tsx  navbar restyle
 M apps/web/src/components/evidence-image.tsx  one lint fix
 M apps/web/src/lib/dictionaries.ts         2 new nav labels
?? apps/web/docs/FINAL_VERIFICATION_REPORT.md   docs, new
```

### Two things that were deliberately rolled back

**The homepage restyle is gone.** It took the homepage from a building state to
one that crashed at render time (`ProcessJourney is not defined`, plus a chain of
import errors behind it). Reverted to `71e17cb`:

- `src/app/[locale]/(public)/page.tsx`
- `src/components/cards.tsx`
- `src/features/home/home-catalogue.tsx`
- `src/features/home/home-platform.tsx`
- `src/features/home/home-sections.tsx`
- `src/tests/home/home-catalogue-sections.test.tsx`
- the `HeroDepth` component it introduced (`src/components/home/`) — deleted

**`problem-photo.png`** was deleted in the working tree and has been restored.
It is a 70-byte stray file at the repo root, committed by accident in `71e17cb`.
It is harmless. If you want it gone, that is a deliberate decision, not a cleanup.

### What is still uncommitted and worth keeping

- **Navbar** (`site-header.tsx` + the two dictionary labels): wordmark removed,
  utility strip with phone + Support + language dropdown, account menu replacing
  the My Account / Sign out pair, `+` icon on the Book a Service button.
- **`evidence-image.tsx`**: one lint fix, described below.

---

## 3. Getting it running on a new machine

```bash
# from the repo root
npm install
npm run infra:up                       # Postgres + Redis
npm run build --workspace @smart-home/contracts --workspace @smart-home/domain
npm run db:migrate
npm run db:seed
npm run dev                             # API on :3000

# then, in a second shell
cd apps/web
npm install
npm run dev                             # web on :3001
```

**The workspace build in the first block is not optional.** Without it the API dies
at boot with `ERR_MODULE_NOT_FOUND: .../@smart-home/contracts/dist/index.js`, which
looks like a web problem and is not.

If `db:seed` reports `@prisma/client did not initialize yet`, run
`npm run db:generate --workspace @smart-home/db` first.

### The port trap that will cost you an hour if you don't know it

`apps/web/package.json` currently has `"dev": "next dev -p 3001"` — **correct**.
It was briefly `"next dev"` with no port, which binds **3000, the API's port**.
If the two contend, `next.config.ts` proxies `/api/v1` back into itself and every
request dies on `ECONNRESET`. If the web app suddenly cannot reach the API, check
which port `next dev` actually bound before you debug anything else.

### Dev accounts

All use `DevPassword!2026`:

```
customer@smart-home.local
provider@smart-home.local
admin@smart-home.local
finance@smart-home.local
agent1@smart-home.local
```

OTP codes: `GET http://localhost:3000/api/v1/dev/inbox?limit=1` (dev only).

---

## 4. The 17 failing tests — the actual work waiting

### 4a. `booking-flow.test.tsx` — 15 failures, ONE root cause

Every failure funnels through the same helper:

```
timeButtons  src/tests/booking/booking-flow.test.tsx:223
  → Unable to find an accessible element with the role "button"
    and name /^\d{1,2}:\d{2}/
```

**Meaning: no slot-time button renders in the booking schedule step.** Because all
15 go through one helper, this is one bug, not fifteen. Fix the schedule step's
slot rendering and all 15 should go green together.

The failing describes: *step four — the problem, chosen from the API*,
*step five — the review shows the*, *step six — payment and the outcome*.

**Status: pre-existing. These fail at `71e17cb` with no local changes applied.**
This is the highest-priority thing to fix, because booking is the brief's
highest-priority surface after auth.

**Already tried and reverted:** bumping the fixture slot date from `2026-10-06`
to `2030-10-06` (the old date is now in the past, and the app rejects past slots).
It took the count from 15 to **16** instead of fixing it, so it was not kept.
Don't repeat it without understanding why it made things worse.

### 4b. `site-header.test.tsx` — was 2 failures — **FIXED, was a real bug**

```
> shows the signed-out controls again when the session ends
> swaps the sign-in link for the account and sign-out controls
    as soon as a sign-in succeeds
```

**This was not an outdated test.** The cause was a genuine accessibility defect
introduced by the navbar restyle: the language dropdown and the account menu were
both given `aria-label={dict.nav.accountMenu}`, i.e. **two different controls
answering to the identical accessible name "Account menu"**.

Consequences, both real beyond the tests:
- a screen-reader user hears "Account menu" twice and cannot tell them apart;
- `queryByRole("button", { name: "Account menu" })` returns whichever the browser
  hands back first — so the test clicked the *language* button, no account menu
  appeared, and `menuitem "Sign out"` was never found.

**Fixed** by giving the language dropdown its own name, `dict.nav.languageMenu`
(`"Language"` / `"زبان"`). No test change was needed; the helpers at lines
~100–108 were already correct. `site-header.test.tsx` now passes 12/12.

Worth remembering: an a11y bug that a test catches is a gift. The same duplicate
name would have shipped silently.

---

## 5. The `evidence-image.tsx` fix, and why it looks odd

The lint rule `react-hooks/set-state-in-effect` fires because the component was
calling `setResolved(url)` synchronously inside a `useEffect`.

**The fix is to derive, not to suppress.** A real object URL *is* the resolved
value, so it is computed during render:

```ts
const isEnvelope = /\/dev\/storage\//.test(url);
const resolved = isEnvelope ? decoded : url;
```

The decoded envelope value carries its own `url`:

```ts
const [unwrapped, setUnwrapped] = useState<{ url: string; data: string } | null>(null);
const decoded = unwrapped !== null && unwrapped.url === url ? unwrapped.data : null;
```

so a URL change needs no reset, and the effect only ever sets state from an async
fetch callback.

**Do not "fix" this by reading a `useRef` during render.** That was tried and
reverted: a ref does not trigger a re-render, so after the fetch resolved the tile
would have sat on its skeleton forever and the photo would never appear. If you
see a ref read in render here, it is a bug.

---

## 6. Two traps in this repo, both already paid for

1. **PowerShell `Set-Content` without `-Encoding UTF8` double-encodes source
   files.** It corrupted `dictionaries.ts` and six others, leaving literal `â€¦`
   in rendered output while every gate stayed green. After any bulk edit:
   ```powershell
   node -e "const fs=require('fs'),p=require('path');(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory())w(f);else if(/\.(ts|tsx|css|md)$/.test(e.name)){const s=fs.readFileSync(f,'utf8');if(s.includes('\u00e2\u20ac')||s.includes('\u00c2'))console.log('MOJIBAKE',f);}}})('src')"
   ```
2. **`void promise` is not a rejection handler.** Every refused action logged an
   unhandled rejection while all gates stayed green. Use
   `.catch(reportFailure)` and let the mutation's own `isError` do the reporting.

---

## 7. Rules that are not negotiable here

- **Only `web/` is ever changed.** The backend, `packages/*`, the database and
  root config are read-only. A backend problem is a finding to write down, never
  a fix to make.
- **Never substitute data for a failure.** A 404 is a not-found state, a 5xx is
  an inline error with a retry. See `services/catalogue-api-honesty.test.ts`,
  which pins this.
- **Never compute a price the API prices.** `POST /bookings/quote` and
  `POST /bookings` share one `PricingService.price()`.
- **All copy lives in `src/lib/dictionaries.ts`,** and `ur` is typed as
  `typeof en` — add both languages in the same commit or typecheck fails.
- **Money is integer paisa.** Use `money()`. Never `pricePaisa / 100` inline.
- **No fabricated testimonials, statistics, reviews or trust claims.**

---

## 8. Where the rest of the truth lives

| File | What it answers |
|---|---|
| `docs/HANDOVER.md` | this file — current state and what to do next |
| `docs/integrated.md` | which of the 165 API endpoints are wired, and which are not |
| `docs/PROJECT_PROGRESS.md` | module status, how to run, conventions, design rules |
| `docs/backend_requirement.md` | genuine backend blockers only |
| `docs/FINAL_VERIFICATION_REPORT.md` | the full pass, including what was reverted |

**On mock data:** modules 1–3 (auth, search/catalogue/places, booking) read the
real API. **Modules 5–8 — provider portal, verification agent, Finance,
Administration — still read `src/lib/data.ts`.** If you are starting Finance,
that mock layer has to be replaced, not extended.

**Messages, specifically:** booking chat (`/bookings/:id/messages`) is on the real
API. Customer notifications and complaints (`/notifications`, `/complaints`) are
still mock. `integrated.md` Module 4 has the per-endpoint split.

---

## 9. Order of work

1. Fix the 15 `booking-flow` failures — one root cause, highest priority (§4a).
2. Get `npm test` fully green, then commit the navbar + evidence-image work
   currently sitting uncommitted.
3. Re-verify the homepage in a browser — it was rolled back and nobody has looked
   at it since.
4. Run the UR/RTL pass. Every check so far has been English only.
5. *Then* Finance.