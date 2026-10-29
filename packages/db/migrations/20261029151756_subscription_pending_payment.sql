-- BE-005: a plan subscription is created PENDING_PAYMENT and only becomes ACTIVE when the gateway's capture webhook arrives,
-- exactly as an online booking waits in PENDING_PAYMENT. A customer who abandons the gateway therefore never holds a plan:
-- the checkout expiry sweep moves the subscription to EXPIRED along with its payment.
--
-- The new value is only added here, never used in this migration: Postgres does not allow a freshly added enum value to be used
-- in the transaction that created it, and nothing needs it until the application writes it.

-- migrate:up
ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'PENDING_PAYMENT';

-- migrate:down
-- An enum value cannot be dropped in place, so the type is rebuilt. A subscription still waiting for payment never became active, so it ends as EXPIRED.
UPDATE subscriptions SET status = 'EXPIRED' WHERE status::text = 'PENDING_PAYMENT';
ALTER TABLE subscriptions ALTER COLUMN status DROP DEFAULT;
ALTER TYPE subscription_status RENAME TO subscription_status_old;
CREATE TYPE subscription_status AS ENUM ('ACTIVE','CANCELLED','EXPIRED');
ALTER TABLE subscriptions ALTER COLUMN status TYPE subscription_status USING status::text::subscription_status;
ALTER TABLE subscriptions ALTER COLUMN status SET DEFAULT 'ACTIVE';
DROP TYPE subscription_status_old;
