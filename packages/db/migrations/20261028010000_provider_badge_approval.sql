-- Provider tier badges (ELITE/PRO/TRUSTED) are computed automatically from verified-job
-- counts, but up to now the computation wrote straight to the public `tier_badge` column:
-- a rating landing at 2am could change what a customer sees on a provider's profile with no
-- human ever looking at it. These columns give the computed value somewhere to sit until an
-- admin approves it -- `tier_badge` itself only ever changes through that approval from here on.

-- migrate:up
ALTER TABLE providers
  ADD COLUMN pending_tier_badge text,
  ADD COLUMN badge_pending_since timestamptz,
  ADD COLUMN badge_approved_by uuid REFERENCES users(id),
  ADD COLUMN badge_approved_at timestamptz;

-- A pending badge is either absent or dated; the two always agree so a reader never has to
-- check both columns to know whether there is anything awaiting review.
ALTER TABLE providers
  ADD CONSTRAINT providers_badge_pending_consistent
  CHECK ((pending_tier_badge IS NULL) = (badge_pending_since IS NULL));

-- migrate:down
ALTER TABLE providers DROP CONSTRAINT providers_badge_pending_consistent;
ALTER TABLE providers
  DROP COLUMN pending_tier_badge,
  DROP COLUMN badge_pending_since,
  DROP COLUMN badge_approved_by,
  DROP COLUMN badge_approved_at;
