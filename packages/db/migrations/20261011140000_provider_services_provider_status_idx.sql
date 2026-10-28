-- SHM-092: index found by explaining the search query against the seeded 10,000-provider dataset.
--
-- Before this index, the plan for a location search was a nested loop that ran a **sequential scan of
-- provider_services once per candidate provider** — 188 loops, each visiting all 10,203 rows, to
-- check one provider's service. The existing indexes did not prevent it: `provider_services_pkey` is
-- on (provider_id, service_id) and cannot answer `status = 'APPROVED'`, and
-- `provider_services_service_idx` is on (service_id, status) but the planner was driving the join
-- from `providers`, so nothing narrowed the scan.
--
-- Measured on the same data, same query, same machine:
--
--   before   Execution Time: 31.7 ms    (188 × Seq Scan on provider_services, 438 buffers/loop)
--   after    Execution Time: 13.8 ms    (1 × Bitmap Heap Scan via provider_services_service_idx)
--
-- The index is (provider_id, status) rather than a plain (provider_id) so the per-provider probe can
-- also check the approval status without visiting the heap, which is the column the filter is on.
--
-- Not CONCURRENTLY, because migrations here run inside dbmate's transaction and CONCURRENTLY cannot
-- run in one. The table is small enough that the blocking window is a fraction of a second on a
-- fresh install and a moment on an existing one.

-- migrate:up
CREATE INDEX IF NOT EXISTS provider_services_provider_status_idx ON provider_services (provider_id, status);

-- migrate:down
DROP INDEX IF EXISTS provider_services_provider_status_idx;
