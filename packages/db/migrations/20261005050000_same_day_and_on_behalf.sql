-- migrate:up
-- Same-day / next-hour booking, booking on behalf of someone else, and the
-- service common-faults list. The canonical shape of all of this now lives in
-- docs-final/schema.sql; this migration is the change, that file is the model.
--
-- bookings.on_behalf_* records who will actually receive the provider when a
-- customer books for someone who is not them. The booker's account still pays,
-- rates, disputes and is verified against -- these columns are only a door
-- address and a contact, so the provider is not left knocking for a stranger.
-- bookings.issue_option_id records the common fault the customer picked from
-- the service's list, if they used one.

CREATE TABLE service_issue_options (
  id         serial PRIMARY KEY,
  service_id int NOT NULL REFERENCES services(id),
  slug       text NOT NULL,
  label_en   text NOT NULL,
  label_ur   text NOT NULL,
  position   int NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  UNIQUE (service_id, slug),
  UNIQUE (service_id, position),
  -- An option is only ever a booking-time convenience, so it is never the sole
  -- evidence of what was reported: free text and photos carry that.
  CHECK (char_length(trim(label_en)) BETWEEN 1 AND 120)
);
CREATE INDEX service_issue_options_service_idx ON service_issue_options(service_id) WHERE is_active;

ALTER TABLE bookings
  ADD COLUMN is_on_behalf         boolean NOT NULL DEFAULT false,
  ADD COLUMN on_behalf_name       text,
  ADD COLUMN on_behalf_phone_e164 text,
  ADD COLUMN issue_option_id      int REFERENCES service_issue_options(id),
  -- An on-behalf-of booking must actually name and number the person, and a booking
  -- that is not on someone's behalf must not carry a contact for one.
  ADD CONSTRAINT bookings_on_behalf_consistent CHECK (
    (is_on_behalf AND on_behalf_name IS NOT NULL AND on_behalf_phone_e164 IS NOT NULL)
    OR (NOT is_on_behalf AND on_behalf_name IS NULL AND on_behalf_phone_e164 IS NULL)),
  ADD CONSTRAINT bookings_on_behalf_phone_e164 CHECK (on_behalf_phone_e164 IS NULL OR on_behalf_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT bookings_on_behalf_name CHECK (on_behalf_name IS NULL OR char_length(trim(on_behalf_name)) BETWEEN 1 AND 120);

-- migrate:down
DROP TABLE IF EXISTS service_issue_options;
ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_on_behalf_name,
  DROP CONSTRAINT IF EXISTS bookings_on_behalf_phone_e164,
  DROP CONSTRAINT IF EXISTS bookings_on_behalf_consistent,
  DROP COLUMN IF EXISTS issue_option_id,
  DROP COLUMN IF EXISTS on_behalf_phone_e164,
  DROP COLUMN IF EXISTS on_behalf_name,
  DROP COLUMN IF EXISTS is_on_behalf;