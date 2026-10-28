-- A service listed with a zero price is not a real offering -- it slipped through because
-- `base_price_paisa`/`min_price_paisa` only ever required >= 0. This tightens both to > 0
-- (every service must have a real value) and adds the missing non-negative guard on
-- `visit_fee_paisa`, which had no CHECK at all. `max_price_paisa` needs nothing new: the
-- existing `services_check` (min <= base <= max) already keeps it >= a now-positive base.
--
-- The data fix runs first so this migration can never fail on a legacy zero-priced row; it is
-- a no-op against today's seed data, which already carries real prices.

-- migrate:up
UPDATE services SET base_price_paisa = GREATEST(base_price_paisa, 1), min_price_paisa = GREATEST(min_price_paisa, 1)
  WHERE base_price_paisa = 0 OR min_price_paisa = 0;

ALTER TABLE services DROP CONSTRAINT IF EXISTS services_base_price_paisa_check;
ALTER TABLE services ADD CONSTRAINT services_base_price_paisa_check CHECK (base_price_paisa > 0);

ALTER TABLE services DROP CONSTRAINT IF EXISTS services_min_price_paisa_check;
ALTER TABLE services ADD CONSTRAINT services_min_price_paisa_check CHECK (min_price_paisa > 0);

ALTER TABLE services ADD CONSTRAINT services_visit_fee_paisa_check CHECK (visit_fee_paisa >= 0);

-- migrate:down
ALTER TABLE services DROP CONSTRAINT services_visit_fee_paisa_check;

ALTER TABLE services DROP CONSTRAINT services_min_price_paisa_check;
ALTER TABLE services ADD CONSTRAINT services_min_price_paisa_check CHECK (min_price_paisa >= 0);

ALTER TABLE services DROP CONSTRAINT services_base_price_paisa_check;
ALTER TABLE services ADD CONSTRAINT services_base_price_paisa_check CHECK (base_price_paisa >= 0);
