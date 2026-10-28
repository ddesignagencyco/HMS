import { execute, literal } from './support.js';

type PlanServiceSeed = { service: string; visitsIncluded: number; intervalDays: number };

type PlanSeed = {
  nameEn: string;
  nameUr: string;
  description: string;
  priceRupees: number;
  durationMonths: number;
  services: readonly PlanServiceSeed[];
};

/**
 * Starter subscription plans for home maintenance (FR-PL-01). Each bundles visits to
 * plan-eligible services (`services.is_plan_eligible`) at a price below booking them
 * individually at `base_price_paisa` — the whole point of a plan being worth buying.
 */
export const plans: readonly PlanSeed[] = [
  {
    nameEn: 'Home Essentials',
    nameUr: 'ہوم ایسنشلز',
    description: 'Two AC services and one switch/socket check-up across the year — the basics covered at a lower price than booking each visit separately.',
    priceRupees: 5_200,
    durationMonths: 12,
    services: [
      { service: 'ac-service', visitsIncluded: 2, intervalDays: 180 },
      { service: 'switch-socket-repair', visitsIncluded: 1, intervalDays: 365 }
    ]
  },
  {
    nameEn: 'Home Care Plus',
    nameUr: 'ہوم کیئر پلس',
    description: 'Quarterly AC servicing plus washing machine and switch/socket visits twice a year — full-year home upkeep at a bundled price.',
    priceRupees: 14_500,
    durationMonths: 12,
    services: [
      { service: 'ac-service', visitsIncluded: 4, intervalDays: 90 },
      { service: 'washing-machine-repair', visitsIncluded: 2, intervalDays: 180 },
      { service: 'switch-socket-repair', visitsIncluded: 2, intervalDays: 180 }
    ]
  }
];

/**
 * `plans` has no natural unique key to upsert on (its id is a random uuid), so this
 * seeds idempotently by name instead of `ON CONFLICT`: a plan already seeded by name
 * is left alone rather than duplicated on a re-run. `plan_services` does have a real
 * primary key (`plan_id, service_id`), so those rows upsert normally once the plan exists.
 */
export const seedPlans = async (): Promise<void> => {
  for (const plan of plans) {
    await execute(
      `INSERT INTO plans(name_en, name_ur, description, price_paisa, duration_months, is_active)
       SELECT ${literal(plan.nameEn)}, ${literal(plan.nameUr)}, ${literal(plan.description)}, ${plan.priceRupees * 100}, ${plan.durationMonths}, true
       WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name_en = ${literal(plan.nameEn)})`
    );
    for (const item of plan.services) {
      await execute(
        `INSERT INTO plan_services(plan_id, service_id, visits_included, interval_days)
         SELECT p.id, s.id, ${item.visitsIncluded}, ${item.intervalDays}
         FROM plans p, services s WHERE p.name_en = ${literal(plan.nameEn)} AND s.slug = ${literal(item.service)}
         ON CONFLICT (plan_id, service_id) DO UPDATE SET visits_included = EXCLUDED.visits_included, interval_days = EXCLUDED.interval_days`
      );
    }
  }
};
