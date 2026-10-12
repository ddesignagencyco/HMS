# Runbook: restore drill, and how backups are stored

**Ticket:** SHM-093 · **Refs:** TRD §19, NFR-AV · **Last drilled: 11 Oct 2026**

A backup that has never been restored is not a backup; it is a file. This runbook is the procedure for
proving the backups work, and the record of the last time somebody did.

## Who runs it, and how often

| | |
|---|---|
| **Frequency** | Quarterly, and once before any release that touches migrations |
| **Who** | Whoever is on backend rota; the result goes in this file |
| **Where it runs** | A staging box, **never** production |
| **Time it takes** | ~15 minutes end to end (§5 has the measured numbers) |

Quarterly is chosen because it is the longest interval at which a quarterly obligation is still a
quarterly obligation. Twice as often costs almost nothing; half as often means a year of discovering
at once that none of them work.

## 1. Take a fresh backup

```bash
npm run db:backup
```

```
[backup] dumping...
[backup] verifying...
[backup] smart_home-2026-10-11T09-15-39-811Z.dump  5.5 MB  598 TOC entries  3.4s
[backup] sha256 1cb571b040c11a22…
[backup] done
```

Three files per backup, all in `backups/` (git-ignored — see "Where the backups live" below):

| File | Purpose |
|---|---|
| `*.dump` | The data. Custom format, gzip -9. |
| `*.sha256` | Lets `sha256sum -c` prove a copy arrived intact. |
| `*.manifest.json` | Size, checksum, duration, TOC sample, and **what the dump does not contain**. |

The manifest carries its own exclusions deliberately: someone who finds a backup file in six months
learns its limits from the file, rather than having to ask.

## 2. Verify the checksum

```bash
cd backups && sha256sum -c *.sha256
```

This is the check that catches the commonest failure of all — a truncated copy, a partial sync. It
costs a second and it is the difference between "the backup is corrupt" and "the backup was never
intact and we found out during an outage".

`npm run db:restore` performs this check itself and refuses to restore on a mismatch.

## 3. Restore somewhere harmless

**Never drill against the database the application is pointed at.** Restore into a scratch database
and run the application against *that*:

```bash
npm run db:restore -- --latest --target smart_home_drill
```

```
[restore] checksum verified
[restore] dropping and recreating "smart_home_drill"
[restore] restoring...
[restore] verifying
[restore] done
[restore]   restore took 6.0s
[restore]   tables         80
[restore]   users          12086
[restore]   bookings       1016
[restore]   ledger_accounts 1078
[restore]   audit_log      5327
```

The restore is verified by **shape, not by exit code**. `pg_restore` exits 0 on a partial restore
unless `--exit-on-error` is set, and a partial restore of a financial ledger is the worst plausible
outcome, so the script checks table count and PostGIS presence and fails if either is wrong.

Restoring over the configured database requires `--i-am-sure`. That flag exists because the failure
is unrecoverable and because the person most likely to type it is someone in a hurry who has just
read the wrong line of a runbook.

## 4. Prove the restored database works

**This is the drill. Everything before it is a file operation.**

```bash
cd apps/api
DATABASE_URL="postgresql://…@localhost:5433/smart_home_drill?schema=public" \
DIRECT_URL="postgresql://…@localhost:5433/smart_home_drill?schema=public" \
npm run test:integration
```

A restore that completes and produces a database the application cannot use is a failed drill, not a
successful one with a caveat. The suite is the cheapest available proof that the schema, the
constraints, the seed data and the application code all still agree with each other after a restore.

## 5. Recorded results

| Date | Backup size | TOC entries | Backup | Restore | Suite against restored DB | Result |
|---|---|---|---|---|---|---|
| **11 Oct 2026** | 5.5 MB | 598 | 3.4 s | 6.0 s | **612 / 612 passed** (50 files) | **Pass** |

Two timings worth recording because they differ from the intuition:

- **The restore took longer than the backup** (6.0 s vs 3.4 s), which is the opposite of the usual
  intuition. A dump is written sequentially and compressed; a restore decompresses, replays the table
  of contents and rebuilds every index. Plan restore time as *longer* than backup time when sizing an
  outage.
- **The suite took ~684 s against the restored database, against ~335 s normally — roughly 2×.** The
  drill database carried the 10 000-provider load dataset, so every search assertion ran against a
  realistically sized table instead of the handful the ordinary seed produces. This is a *good* sign:
  it means the drill exercised the restore at a scale worth testing. It is also why a drill against a
  production-shaped snapshot will need a longer window than one against an empty database, and that
  is the number to plan around.

## Where the backups live

`backups/` is **git-ignored**, deliberately. These files contain every customer record in the system —
names, CNICs, addresses, phone numbers, payment references — and a Git repository is the single worst
place to put that: it is replicated to every clone, it is in the history permanently, and deleting it
does not delete it.

| | |
|---|---|
| **Local** | `backups/`, pruned to `BACKUP_RETENTION` (default 7) on every run |
| **Offsite** | **Not yet configured.** This is a real gap — see below |
| **Retention** | Hourly for 24 h, daily for 30 d, monthly for 12 m — **not yet implemented** |

### Open gaps in this runbook

Recorded rather than glossed over, because a backup strategy that is wrong in one place and silent
about it is the kind that gets discovered during an outage.

1. **No offsite copy is configured.** The backup script writes to local disk, which is on the same
   machine as the database it protects. A disk failure takes both. Until this is fixed, this runbook
   documents a procedure that does not yet deliver disaster recovery — only recovery from application
   error. Needs: encrypted upload to object storage with a key held outside the same account.
2. **No tiered retention.** `BACKUP_RETENTION=7` prunes by count, so a nightly backup keeps seven
   nights and loses everything older. That is fine for "someone deleted a row yesterday" and useless
   for "someone deleted a row last March". Needs hourly/daily/monthly tiers.
3. **Object storage is not snapshotted.** Evidence photos and documents go through `ObjectStoragePort`,
   currently the **mock** adapter — which stores the bytes in the database, so they *are* in these
   dumps. As soon as a real S3 adapter ships (SHM-095/096), this script must also snapshot that bucket,
   and until then "we have a backup" is true of the database and false of the files.

## Cleanup

```bash
docker exec smart-home-postgis psql -U smart_home -c "DROP DATABASE IF EXISTS smart_home_drill WITH (FORCE);"
```

Leaving the drill database around is how the *next* drill restores into it by accident and concludes
everything is fine because the thing being compared was itself a restored copy.

## Rollback / disaster recovery

When the database itself is lost, this is the full procedure:

```bash
npm run db:restore -- --latest          # refuses without --i-am-sure
npm run db:restore -- --latest --i-am-sure
npm run db:flush-cache                  # the settings cache predates the restore and must go
npm run db:migrate                      # in case the dump is older than the schema
```

**Flush the settings cache.** It lives in Redis, is not backed up, and will otherwise serve
catalogue versions and settings from the *pre-loss* timeline — a state that never existed and has no
name. This is the single most likely step to be forgotten, and the symptom it produces (settings that
silently do not match the restored data) looks like a bug in the settings feature.

**Re-run migrations after restoring**, not before. Restoring an older dump into a newer schema is
correct and expected; the migrations are idempotent and will reconcile. Restoring a *newer* dump into
an older schema will fail loudly, which is the right outcome.

## When to escalate

Restoring is the decision with the least reversibility in this system, and the moment to stop and ask
rather than act is:

- **The database is lost and the cause is not yet known.** Restoring over the top of a database that
  still exists destroys whatever evidence caused the loss. Get whoever owns the platform to confirm
  the database is genuinely gone before restoring — unless it is actively on fire, in which case
  restore first and investigate afterwards.
- **You are choosing which backup to restore.** Picking the newest is usually right and occasionally
  catastrophic, because the newest backup can contain the corruption you are restoring *past*. If
  someone suspects data was deleted or corrupted before the last backup, that is an engineer's
  decision, not a responder's.
- **The restore fails, or restores cleanly but the data is wrong.** A failed restore is recoverable;
  restoring into a subtly wrong state is much harder to undo. If §4 does not pass cleanly, stop.
- **Any restoration touches money.** Ledger balances, captures and payouts come back exactly as they
  were — including any inconsistency that existed at the time. **The reconciliation must be re-run
  after every restore**, and drift found afterwards must be treated as real, not as an artefact of the
  restore. Get finance involved before declaring it recovered.
- **You are being asked to restore production outside business hours** on the strength of this
  document alone. This runbook is written for a drill. A production restore wants someone senior
  present who has read the result of the last one.
