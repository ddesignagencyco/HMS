# Smart Home Maintenance Service

An online marketplace that connects home owners with local tradesmen, such as
electricians, plumbers and air conditioner technicians, and manages the whole job
from the first search to the final payment.

Think of it as "a taxi app, but for home repairs", with one big difference:
**we never pay the tradesman just because they say the job is finished.**

---

## The big idea

Many marketplaces simply trust the worker. We do not. When a job is done:

1. The platform **keeps the customer's money safe** (this is called holding money in escrow).
2. A member of our staff **calls the customer** to check the work was really done and is good.
3. Only after the customer confirms does the platform **release the money** to the tradesman.
4. If something goes wrong, there is a complaint, dispute, penalty and appeal process.

Ratings can only be left for jobs that were checked this way. The database itself
enforces this rule, not only the code.

## Who uses it

| Person | What they do |
|---|---|
| **Customer** | A home owner who needs something fixed. Searches, books, pays and rates. |
| **Provider** | The tradesman. Sets prices and working hours, accepts jobs, does the work and uploads photos. |
| **Verification agent** | Staff member who phones customers to confirm a job was done. |
| **Finance officer** | Staff member who handles refunds, payouts and money checks. |
| **Administrator** | Approves tradesmen, settles disputes and changes system settings. |

## Where it is meant to run first

One city (Lahore, Pakistan), six service categories, English and Urdu, Pakistani
rupees, Pakistan time. All money is stored as whole paisa (integers), never as
decimal numbers, so there are no rounding errors.

---

## What is in this repository

| Folder | What it holds |
|---|---|
| `apps/api` | The backend server (the part customers' and providers' apps talk to). |
| `apps/worker` | The background worker. It runs timed jobs such as reminders and nightly money checks. |
| `packages/contracts` | Shared names, types and error codes. |
| `packages/db` | The database setup: tables, starter data and the database client. |
| `packages/domain` | Pure business rules with no framework, such as the booking steps, money and working hours. |
| `packages/config` | Shared code-style settings. |
| `infra` | Local services started with Docker (database, Redis, file storage). |
| `docs-final` | The full documentation: requirements, technical design, database design and the progress tracker. |

Main tools: TypeScript, NestJS (server), PostgreSQL with PostGIS (database and map
distances), Redis (fast storage and job queues), Zod (input checking), Vitest (tests).

## Current status

The **backend** is being built phase by phase. The foundation, onboarding, booking,
job execution, verification and money parts are built and pass their tests. Complaints
are built and tested. Penalties, appeals and the full notification system are in
progress. Reports, maintenance plans and the production release are not started.
**There is no frontend yet.** The exact, up-to-date state is in
`docs-final/PROGRESS_TRACKER.md`.

Payments, SMS, email, maps and phone calls currently use **fake stand-ins ("mocks")**,
so you can run and try everything locally without any real accounts.

---

## Run the project on your computer

### What you need first

- **Node.js 22 or newer** (`node --version` to check)
- **npm** (comes with Node.js)
- **Docker Desktop**, open and running

### First-time setup

Run these from the project's top folder, in order.

```bash
# 1. Install all the code dependencies
npm install

# 2. Create your settings file (the defaults work for local use)
cp .env.example .env

# 3. Start the database and Redis in Docker
npm run infra:up

# 4. Create all the database tables
npm run db:migrate

# 5. Generate the database client code from those tables
npm run db:generate --workspace @smart-home/db

# 6. Fill the database with starter data (cities, services, staff accounts...)
npm run db:seed

# 7. Build every package
npm run build
```

### Start the server

```bash
npm run dev
```

The server now runs at **http://localhost:3000**.

- Interactive API documentation (try every endpoint in the browser): **http://localhost:3000/api/docs**
- Health check: **http://localhost:3000/health/ready**

In a **second terminal**, start the background worker (needed for timed jobs):

```bash
npm run dev:worker
```

### Test accounts

After seeding, every account below uses the password `DevPassword!2026`
(for local development only).

| Role | Email |
|---|---|
| Administrator | `admin@smart-home.local` |
| Finance officer | `finance@smart-home.local` |
| Verification agent | `agent1@smart-home.local` or `agent2@smart-home.local` |
| Provider (already approved) | `provider@smart-home.local` |

Sign in with `POST /api/v1/auth/login`, copy the `accessToken`, then click
**Authorize** at the top of the API documentation page and paste it in.
Staff accounts may also ask for a one-time code from an authenticator app.

Text messages are not really sent. In development they appear in the built-in
development inbox, so you can read one-time codes there.

### Try a rule that depends on the time of day

Verification calls are only allowed between 08:00 and 22:00. To pretend it is a
certain time:

```bash
npm run dev:at --workspace @smart-home/api -- 10:30
```

---

## Everyday commands

### Running and building

| Command | What it does |
|---|---|
| `npm run dev` | Start the server with automatic restart when you edit code. |
| `npm run dev:worker` | Start the background worker. |
| `npm run build` | Build every package. |
| `npm run start --workspace @smart-home/api` | Run the built server (after `npm run build`). |
| `npm run start:worker` | Run the built worker. |

### Checking the code

| Command | What it does |
|---|---|
| `npm test` | Run the quick tests. No Docker needed. |
| `npm run test:integration` | Run the full tests against the real database and Redis. Docker must be running. |
| `npm run lint` | Check code style and our custom safety rules. |
| `npm run typecheck` | Check the types. |
| `npm run format` | Automatically tidy the formatting. |

### Database

| Command | What it does |
|---|---|
| `npm run db:migrate` | Apply any new database changes. |
| `npm run db:status` | Show which database changes have been applied. |
| `npm run db:seed` | Load the starter data. |
| `npm run db:reset` | **Erases everything**, then rebuilds and reseeds the database. |
| `npm run db:studio` | Open a web page to browse the database. |

### Docker services

| Command | What it does |
|---|---|
| `npm run infra:up` | Start the database and Redis. |
| `npm run infra:ps` | Show whether they are running and healthy. |
| `npm run infra:down` | Stop them **and delete their data**. |
| `npm run infra:objects` | Also start the local file storage service. |

---

## If something goes wrong

- **"Cannot connect to the Docker API"**: open Docker Desktop and wait until it says it is running.
- **Port 5432 or 6379 is already used**: change `POSTGRES_HOST_PORT` or `REDIS_HOST_PORT` in `.env`, and update `DATABASE_URL` or `REDIS_URL` to match.
- **Server fails at startup about settings**: your `.env` is missing a value. Compare it with `.env.example`.
- **Want a clean start**: `npm run db:reset`.
- **Known limit**: the four file storage buckets cannot be created locally yet. This is recorded as a blocker in the progress tracker.

## More documentation

All in `docs-final/`: `SRS.md` (what the product must do), `TRD.md` (how it is built),
`ERD.md` and `schema.sql` (the database), `TASKS_BACKEND.md`, `TASKS_FRONTEND.md` and
`PROGRESS_TRACKER.md` (the work plan and status).
