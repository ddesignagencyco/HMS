-- SHM-092: the search query, explained at load.
--
-- Run against the seeded 10,000-provider dataset. The question is not "is it fast on my laptop with
-- 300 providers" — it is which plan Postgres picks once the table is the size production will be,
-- because the plan chosen for a small table is a sequential scan and will happily stay that way
-- until the day it stops fitting in memory.
\set ON_ERROR_STOP on
\timing on

EXPLAIN (ANALYZE, BUFFERS, COSTS, FORMAT TEXT)
SELECT p.user_id
FROM providers p
JOIN provider_services ps ON ps.provider_id = p.user_id AND ps.service_id = (SELECT id FROM services ORDER BY id LIMIT 1) AND ps.status = 'APPROVED'
WHERE p.status = 'APPROVED' AND p.offer_blocked_reason IS NULL AND p.base_location IS NOT NULL
  AND ST_DWithin(p.base_location, ST_SetSRID(ST_MakePoint(74.3587,31.5204), 4326)::geography, p.radius_m)
ORDER BY p.user_id
LIMIT 50;
