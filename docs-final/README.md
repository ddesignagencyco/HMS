# Doc of record — Smart Home Maintenance Services

This is the **only** documentation folder in this repo. There used to be three
(`smart-home-docs/`, `docs/`, and this one) because requirements and architecture had been
written twice from two different SRS drafts that never got reconciled — an AI agent had to
read both, notice they disagreed, and work out which one was actually right before it could
trust either. That happened at least twice in this project's history. Then, for one day,
there were two folders plus this one, because a single file (`schema.sql`) and a pile of
genuinely-historical documents were still sitting in the old locations. Now there's one.

## The rule going forward

- **Everything current lives here, flat, at the top level of this folder.** If you're an AI
  agent or a developer picking this project back up: start here, don't go looking anywhere
  else, and don't create anywhere else to look.
- **When something here needs to change, edit it in place.** Don't create a second copy, a
  "v2" file, or a new folder. If a document genuinely needs a fresh full rewrite, replace the
  file's content — don't leave the old content behind for someone to find and disagree with
  later.
- **Superseded or genuinely historical material goes in `archive/`, never back at the top
  level and never in a new top-level folder.** It's there so nothing is lost, not so it can
  be mistaken for current guidance.

## Files here

| File | What it is | Status |
|---|---|---|
| `SRS.md` | Software Requirements Specification, v2.1 | **Doc of record.** 145 functional requirement ids. |
| `TRD.md` | Technical Requirements & Design — architecture, stack, module map, state machine, ledger, verification engine, API catalogue, security, testing, CI/CD, ADRs, risks | **Doc of record.** Has a §0 "Implementation status" section — read that first, since most of this document describes the target design, not what's built yet. |
| `ERD.md` | Entity-relationship diagrams, by domain | **Doc of record.** Physical schema itself is `schema.sql`, this folder. |
| `schema.sql` | Canonical PostgreSQL 16 + PostGIS schema: 73 tables, enums, constraints, triggers, views | **Doc of record. Source of truth for the data model.** `packages/db/migrations/0001_init.sql` must be exactly what the migrations build — CI enforces it (job `migration-fidelity`, via `db:check-schema`, which builds the schema twice and compares the resulting catalogues). Schema changes are **additive migrations**; never rewrite a migration that has already been applied. `packages/db/README.md` documents the edit workflow; `packages/contracts/test/enum-mirror.test.ts` imports this file directly. Edit this file first, then regenerate the migration. |
| `PROGRESS_TRACKER.md` | Live, ticket-by-ticket (`SHM-###`) build-progress tracker for both BE and FE | **Doc of record. Update this continuously as tickets move** — it's the most granular truth about what's actually done. |
| `TASKS_BACKEND.md` | Backend task board, by phase and module, with SRS FR-id traceability | **Doc of record.** Coarser-grained than `PROGRESS_TRACKER.md`; if the two disagree, trust `PROGRESS_TRACKER.md`. Has a "Platform migration" section logging the Fastify→Express move and both consolidation passes, and an appendix reconciling every FR id across both SRS versions. |
| `TASKS_FRONTEND.md` | Frontend task board, by phase, screen-by-screen against the SRS | **Doc of record.** No frontend code exists yet - this is 100% forward-looking. |
| `API_HANDOFF.md` | The API contract for frontend developers: conventions (auth, idempotency, errors, status codes), the booking and verification flows, per-screen notes, and what is **not** built yet | **Doc of record for the frontend. Update it in the same change as any API work.** Includes `api-handoff-index.md`. |
| `api-handoff-index.md` | Every operation, grouped by screen area | **Generated - do not edit.** Regenerate with `npm run api:handoff --workspace @smart-home/api`. |

### The API handoff rule

**If you add, change or remove an endpoint, `API_HANDOFF.md` changes in the same commit.**

1. `npm run api:handoff --workspace @smart-home/api` — rewrites `api-handoff-index.md`
   from the live application. It prints `N of N operations`; a non-zero "ungrouped"
   count means the generator's group table needs a new entry.
2. Hand-edit the relevant section of `API_HANDOFF.md` for the screen the endpoint serves —
   especially any request field, the response shape, and the status code it returns.
3. If the set of endpoints changed, also run `npm run api:surface --workspace @smart-home/api`
   and **read the diff** of `apps/api/test/api-surface.baseline.json` before committing.
4. Confirm the new endpoint answers over real HTTP, not only in tests.

No test enforces this, deliberately: it is a rule the team keeps rather than a check that
fails the build. The index is generated from the running app precisely so step 1 is cheap
and mechanical, and the checks that matter most (the booking flow, the verification loop,
the money release) are spelled out in prose because they cannot be read off a path.

## `archive/` — superseded, kept for reference, never current

Nothing has been deleted — only relocated. Deleting would lose real content in a git-tracked
repo where that's needlessly destructive; a dedicated folder is enough to stop anyone reading
the wrong copy by accident. Contents:

- **From the original doc pack (`smart-home-docs/`):** `00_README.md` (its index), `02_TRD.md`
  (superseded by `TRD.md` here), `05_CURSOR_BUILD_PROMPT.md` and `06_cursor_rules/`
  (tool-specific prompt files for a Cursor-driven build that isn't how this project was
  actually built).
- **From the later, since-superseded set (`docs/`):** `TRD_Smart_Home_Maintenance.md`,
  `ERD_Smart_Home_Maintenance.md`, `schema.prisma` (a 50-model alternate design that was never
  adopted — the schema actually running is the 73-table `schema.sql` in this folder),
  `OPENCODE_BUILD_PROMPT.md`, `SRS_Smart_Home_Maintenance_Services.pdf` (SRS v2.0 — an
  *earlier* draft than `SRS.md`'s v2.1, despite "2.0 < 2.1" suggesting the opposite:
  `SRS.md` came later and added 15 requirements v2.0 never had), `BACKEND_CONTINUATION_REPORT.md`
  and `PROJECT_OVERVIEW_REPORT.md` (point-in-time handoff/status snapshots, already stale on
  other facts too — they still mention Turborepo, Fastify and Pino, all since removed).

See `TASKS_BACKEND.md`'s "Platform migration" section and its FR-id reconciliation appendix
in this folder for the full forensics of how the original split happened, if you want the
detail.
