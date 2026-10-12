-- SHM-090 / FR-RP-01..06: prepare the `report_runs` table that has been in the schema since
-- 0001 and has never had a row written to it.
--
-- The table was already there — the tracker's note that reports "need new tables" was wrong, and
-- building a second one alongside it would have left two half-used tables and no way to tell which
-- was the real one. So this adds only what an asynchronous run actually needs and the original
-- definition does not have.
--
--   started_at   a QUEUED run that never started is indistinguishable from one that is about to;
--                without this, "how long has this been stuck" has no answer.
--   row_count    how much data the report covered, so a report over 3 rows is visibly not the
--                month someone asked for.
--   total_paisa  the headline figure, computed once at build time so a viewer does not have to
--                re-derive it, and so the XLSX and the PDF cannot disagree about it.

-- migrate:up
ALTER TABLE report_runs
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS row_count   int,
  ADD COLUMN IF NOT EXISTS total_paisa bigint;

-- A period is a real range: a report over no days is a mistake worth naming rather than rendering.
ALTER TABLE report_runs DROP CONSTRAINT IF EXISTS report_runs_period_ordered;
ALTER TABLE report_runs ADD CONSTRAINT report_runs_period_ordered CHECK (period_end > period_start);

-- The worker takes QUEUED runs oldest-first; without this the queue is a scan.
CREATE INDEX IF NOT EXISTS report_runs_status_created_idx ON report_runs (status, created_at);

-- Asking twice re-opens the run you already have instead of producing a second copy of the same
-- numbers with a different timestamp. Only open runs are protected: once one is DONE or FAILED the
-- same request must be allowed through, or a failed report could never be retried.
CREATE UNIQUE INDEX IF NOT EXISTS report_runs_open_unique
  ON report_runs (requested_by, type, period_start, period_end)
  WHERE status IN ('QUEUED', 'RUNNING');

-- migrate:down
DROP INDEX IF EXISTS report_runs_open_unique;
DROP INDEX IF EXISTS report_runs_status_created_idx;
ALTER TABLE report_runs DROP CONSTRAINT IF EXISTS report_runs_period_ordered;
ALTER TABLE report_runs
  DROP COLUMN IF EXISTS started_at,
  DROP COLUMN IF EXISTS row_count,
  DROP COLUMN IF EXISTS total_paisa;