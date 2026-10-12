// packages/db/seed/loadProviders.ts
//
// SHM-110 / FR-SR-07: the dataset the p95 claim and SHM-092's k6 run are measured against.
//
// Ten thousand *bookable* providers, not ten thousand rows. Each one has an approved account, a
// verified CNIC (so the `verifiedDocsOnly` filter has something true to filter on), an approved
// service binding, a service area and weekly availability. A provider missing any of those is
// invisible to `GET /search/providers`, so a generator that skipped them would produce a number that
// looks like a result and measures nothing.
//
// **No fabricated history.** A provider here has no completed bookings and no ratings, because both
// carry foreign keys into the verification and booking flow, and inventing rows would mean inventing
// money. That is not a gap — it is the harder case and the one worth load-testing: search has to
// serve ten thousand providers whose history signals all read "no data" without falling over or
// collapsing them onto one score.
//
// **Deterministic, and therefore idempotent.** Every attribute comes from `rngFor(index)` rather than
// `Math.random()`, and the id is derived from the index, so two runs on two machines produce the same
// ten thousand providers and a performance number is comparable across runs.
//
// **Upsert, never delete.** The first version cleared the previous run with `DELETE FROM users`,
// which the database refused — SHM-012's delete guard, working exactly as it should, since a user
// account is never meant to vanish. That turned out to be the better design anyway: because the ids
// are deterministic, a second run updates the same ten thousand providers rather than churning a
// hundred thousand rows. Re-running with a *smaller* count parks the surplus (inactive provider,
// deactivated account) rather than deleting it, so shrinking never orphans anything.
//
// Batched, because one ten-thousand-row INSERT is slower to reason about when it goes wrong.

import { execute, literal, prisma, rows } from './support.js';

const BATCH = 250;

/** Reserved domain, deliberately not resolvable: nothing here is a real account. */
const EMAIL_DOMAIN = 'load-test.invalid';

const firstNames = ['Ali', 'Bilal', 'Usman', 'Hamza', 'Zain', 'Faisal', 'Imran', 'Kashif', 'Adeel', 'Waqar', 'Noman', 'Junaid', 'Asad', 'Tariq', 'Shahid', 'Rehan'];
const lastNames = ['Ahmed', 'Khan', 'Malik', 'Hussain', 'Raza', 'Iqbal', 'Sheikh', 'Chaudhry', 'Siddiqui', 'Qureshi', 'Farooq', 'Nawaz', 'Yousaf', 'Baig'];

type Rng = { next: () => number; int: (min: number, max: number) => number; pick: <T>(items: readonly T[]) => T };

/** mulberry32 — small, fast, and reproducible from a seed, which is the whole requirement. */
const rngFor = (seed: number): Rng => {
  let state = seed;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T
  };
};

type World = {
  areas: { id: number; lat: number; lng: number }[];
  services: { id: number; minPrice: bigint; maxPrice: bigint }[];
};

const readWorld = async (): Promise<World> => {
  const areas = await rows<{ id: number; lat: number; lng: number }>(
    `SELECT id, ST_Y(centroid::geometry) as lat, ST_X(centroid::geometry) as lng FROM areas WHERE is_active ORDER BY id`
  );
  const services = await rows<{ id: number; minPrice: bigint; maxPrice: bigint }>(
    `SELECT id, min_price_paisa as "minPrice", max_price_paisa as "maxPrice" FROM services WHERE is_active ORDER BY id`
  );
  if (areas.length === 0 || services.length === 0) {
    throw new Error('seed:load needs the normal seed to have run first (no areas, or no services)');
  }
  return { areas, services };
};

export type LoadResult = { bookable: number; parked: number };

/**
 * Load accounts get their own id block, deliberately outside the seed's.
 *
 * The seeded accounts use `00000000-0000-4000-8000-0000000000NN`. The first version of this file
 * numbered its providers from the same block, and because the loader upserts on `id` it silently
 * **overwrote all seven seeded accounts** — staff and test logins included — every time it ran.
 * Nothing errored; the suite just started failing later with "Seeded admin has no TOTP secret".
 * The prefix below cannot collide with it, and `assertNoSeedCollision` proves it at load time rather
 * than trusting this comment to stay true.
 */
const LOAD_ID_PREFIX = '0f1a0000';
const providerId = (index: number): string => `${LOAD_ID_PREFIX}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;

/** Fails loudly rather than overwriting anything, if the seed's id block ever moves into ours. */
const assertNoSeedCollision = async (count: number): Promise<void> => {
  const ours = LOAD_ID_PREFIX;
  const clashing = await rows<{ n: number }>(
    `SELECT count(*)::int as n FROM users WHERE email NOT LIKE ${literal(`%@${EMAIL_DOMAIN}`)} AND id::text LIKE ${literal(`${ours}%`)}`
  );
  if ((clashing[0]?.n ?? 0) > 0) {
    throw new Error(
      `seed:load refused to run: ${clashing[0]?.n} non-load account(s) already hold ids in the ${ours} block. Change LOAD_ID_PREFIX rather than overwriting someone's account.`
    );
  }
  void count;
};

export const loadProviders = async (count: number): Promise<LoadResult> => {
  await assertNoSeedCollision(count);
  const world = await readWorld();

  for (let batchStart = 0; batchStart < count; batchStart += BATCH) {
    const size = Math.min(BATCH, count - batchStart);
    const users: string[] = [];
    const providers: string[] = [];
    const services: string[] = [];
    const areas: string[] = [];
    const availability: string[] = [];
    const documents: string[] = [];

    for (let offset = 0; offset < size; offset += 1) {
      const index = batchStart + offset;
      const rng = rngFor(index + 1);
      const id = providerId(index);
      const area = rng.pick(world.areas);
      const service = rng.pick(world.services);
      // Scattered around the area rather than stacked on its centroid: a thousand providers at
      // identical coordinates would make the distance term degenerate and the spatial index
      // meaningless, so the number measured would really be about a point query.
      const lat = area.lat + (rng.next() - 0.5) * 0.06;
      const lng = area.lng + (rng.next() - 0.5) * 0.06;

      // Seeded accounts occupy +9230010000xx, so load accounts start in the next block. Derived from
      // the index so it is stable across runs and cannot collide as the set grows past 10 000.
      users.push(
        `(${literal(id)}::uuid, ${literal(`+92300${String(2_000_000 + index)}`)}, ${literal(`load-${index}@${EMAIL_DOMAIN}`)}, '!', ${literal(rng.pick(firstNames))}, ${literal(rng.pick(lastNames))}, 'ACTIVE'::user_status, now(), now())`
      );
      providers.push(
        `(${literal(id)}::uuid, 'APPROVED'::provider_status, ${literal(`Load provider ${index}`)}, ${rng.int(0, 22)}, ${literal(`Area ${area.id}`)}, 1, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${rng.int(4000, 12000)}, now(), now(), now(), ${literal(`cnic-load-${index}`)})`
      );
      // Prices spread across the service's band in quarters. BigInt throughout: this is paisa, and
      // the project's own rule is that money never goes through a float.
      const quarter = BigInt(rng.int(0, 4));
      services.push(`(${literal(id)}::uuid, ${service.id}, 'APPROVED'::approval_status, ${service.minPrice + ((service.maxPrice - service.minPrice) * quarter) / 4n})`);
      areas.push(`(${literal(id)}::uuid, ${area.id})`);
      // 09:00–19:00 local, six days a week: the shape a real working day has, and the one
      // `availableToday` and the slot generator are tested against.
      for (let weekday = 0; weekday < 6; weekday += 1) {
        availability.push(`(${literal(id)}::uuid, ${weekday}, '09:00'::time, '19:00'::time)`);
      }
      documents.push(`(${literal(id)}::uuid, 'CNIC_FRONT'::document_type, ${literal(`load/${index}/cnic`)}, 'VERIFIED'::review_status, now(), now())`);
    }

    await execute(
      `INSERT INTO users(id, phone_e164, email, password_hash, first_name, last_name, status, phone_verified_at, created_at)
       VALUES ${users.join(', ')}
       ON CONFLICT (id) DO UPDATE SET phone_e164 = EXCLUDED.phone_e164, email = EXCLUDED.email, first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name, status = 'ACTIVE'::user_status, deactivated_at = NULL, anonymised_at = NULL`
    );
    await execute(
      `INSERT INTO providers(user_id, status, bio, experience_years, base_address_text, city_id, base_location, radius_m, created_at, updated_at, approved_at, cnic_hash)
       VALUES ${providers.join(', ')}
       ON CONFLICT (user_id) DO UPDATE SET status = 'APPROVED'::provider_status, bio = EXCLUDED.bio, experience_years = EXCLUDED.experience_years,
         base_address_text = EXCLUDED.base_address_text, base_location = EXCLUDED.base_location, radius_m = EXCLUDED.radius_m,
         approved_at = EXCLUDED.approved_at, offer_blocked_reason = NULL, rejection_reason = NULL`
    );
    await execute(
      `INSERT INTO provider_services(provider_id, service_id, status, price_paisa) VALUES ${services.join(', ')}
       ON CONFLICT (provider_id, service_id) DO UPDATE SET status = 'APPROVED'::approval_status, price_paisa = EXCLUDED.price_paisa`
    );
    await execute(`INSERT INTO provider_service_areas(provider_id, area_id) VALUES ${areas.join(', ')} ON CONFLICT DO NOTHING`);

    // `provider_availability` and `provider_documents` have no unique constraint to conflict on —
    // only a surrogate `id` — so an upsert has nothing to match against and a second run would
    // double every row. Re-running replaces them instead. Neither table carries an insert-only
    // guard (`audit_log` and `ledger_entries` do, and must), and the delete is scoped to this
    // batch's own ids, so nothing else can be touched by it.
    const batchIds = Array.from({ length: size }, (_, offset) => `${literal(providerId(batchStart + offset))}::uuid`).join(', ');
    await execute(`DELETE FROM provider_availability WHERE provider_id IN (${batchIds})`);
    await execute(`DELETE FROM provider_documents WHERE provider_id IN (${batchIds})`);
    await execute(`INSERT INTO provider_availability(provider_id, weekday, start_time, end_time) VALUES ${availability.join(', ')}`);
    await execute(
      `INSERT INTO provider_documents(provider_id, doc_type, storage_key, status, created_at, reviewed_at) VALUES ${documents.join(', ')}`
    );

    process.stdout.write(`  generated ${Math.min(batchStart + size, count)}/${count}\n`);
  }

  // Shrinking the set: park anything left over from a bigger previous run. Soft, never deleted —
  // an account with bookings must not disappear, and a parked provider simply stops appearing in
  // search, which is what "not in the load set" has to mean.
  const parked = await execute(
    `UPDATE providers SET status = 'DRAFT'::provider_status, updated_at = now()
      WHERE cnic_hash LIKE 'cnic-load-%' AND user_id::text NOT IN (${Array.from({ length: count }, (_, index) => literal(providerId(index))).join(', ')})`
  );
  if (parked > 0) process.stdout.write(`  parked ${parked} provider(s) left over from a larger previous run\n`);

  const total = await rows<{ n: number }>(
    `SELECT count(*)::int as n FROM providers p JOIN users u ON u.id = p.user_id
      WHERE p.status = 'APPROVED' AND u.status = 'ACTIVE' AND u.email LIKE ${literal(`%@${EMAIL_DOMAIN}`)}`
  );
  return { bookable: total[0]?.n ?? 0, parked };
};

export const disconnect = async (): Promise<void> => {
  await prisma.$disconnect();
};