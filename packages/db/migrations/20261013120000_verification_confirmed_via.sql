-- SHM-095: record *how* a customer confirmed a job, not just that they did.
--
-- The customer's own confirmation already existed as an outcome — `LINK_CONFIRMED`, produced by the
-- one-tap `/v/:token` link we text them. The in-app form (FR-VC-14) reaches the same outcome through a
-- different transport: the customer is signed in, so there is no token and no OTP to send.
--
-- Both write `LINK_CONFIRMED` rather than a new enum value, deliberately. That outcome is already in
-- two places that money depends on — `trg_booking_status_guard` (a `PAYMENT_RELEASED` booking needs a
-- release-permitting verification row) and `trg_rating_requires_verification` (a rating needs a
-- rating-producing one) — and adding a seventh `verification_outcome` value would mean editing both
-- triggers, the enum mirrors in `packages/contracts` and `packages/domain`, and every reader of the
-- outcome, for a distinction that is about transport rather than about what was decided.
--
-- What still needed recording was *which* transport, so an auditor reading a released booking can
-- tell "a person called them" from "they tapped a button in the app". That is what this column is,
-- and it is nullable: null means an agent's call, which is every row that already exists.
--
-- The existing CHECK on `verification_calls` needs no change. `LINK_CONFIRMED` is already one of the
-- two outcomes exempt from the full-agent-questionnaire requirement (the other is `AUTO_RELEASED`),
-- because neither is an agent's verdict and neither is read out over a recorded call.

-- migrate:up
CREATE TYPE verification_confirmed_via AS ENUM ('LINK', 'IN_APP');

ALTER TABLE verification_calls
  ADD COLUMN confirmed_via verification_confirmed_via;

-- Only the two customer-driven outcomes can arrive through a transport; an agent's submission and the
-- 72-hour sweep leave it null. Said here rather than left to convention, because the column exists
-- precisely to be trusted by a reader who did not watch it being written.
ALTER TABLE verification_calls
  ADD CONSTRAINT verification_confirmed_via_matches_outcome
  CHECK (confirmed_via IS NULL OR outcome IN ('LINK_CONFIRMED', 'AUTO_RELEASED'));

-- migrate:down
ALTER TABLE verification_calls DROP CONSTRAINT verification_confirmed_via_matches_outcome;
ALTER TABLE verification_calls DROP COLUMN confirmed_via;
DROP TYPE verification_confirmed_via;
