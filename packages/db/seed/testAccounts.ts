import { hash } from 'argon2';
import { developmentStaffPassword } from './staff.js';
import { execute, literal, single } from './support.js';

// Dev-only, stable across every reseed: a fully approved PROVIDER and a
// CUSTOMER with a saved address, both already verified, so Swagger testing
// of provider-only and customer-only endpoints never has to go through
// /auth/register + OTP verification first. Mirrors the superadmin pattern
// in staff.ts.

const PROVIDER_ID = '00000000-0000-4000-8000-000000000098';
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000097';

export const testAccountsPassword = developmentStaffPassword;

const seedUser = async (id: string, phone: string, email: string, firstName: string, lastName: string, passwordHash: string): Promise<void> => {
  await execute(
    `INSERT INTO users(id, phone_e164, email, password_hash, first_name, last_name, email_verified_at, phone_verified_at, locale)
     VALUES (${literal(id)}::uuid, ${literal(phone)}, ${literal(email)}, ${literal(passwordHash)},
       ${literal(firstName)}, ${literal(lastName)}, now(), now(), 'en')
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name`
  );
};

const seedTestProvider = async (passwordHash: string): Promise<void> => {
  await seedUser(PROVIDER_ID, '+923001000098', 'provider@smart-home.local', 'Test', 'Provider', passwordHash);
  await execute(`INSERT INTO user_roles(user_id, role_code) VALUES (${literal(PROVIDER_ID)}::uuid, 'PROVIDER') ON CONFLICT DO NOTHING`);

  const admin = await single<{ id: string }>(`SELECT id FROM users WHERE id = '00000000-0000-4000-8000-000000000001'`);
  if (admin === null) throw new Error('Admin staff user must be seeded before the test provider');

  const city = await single<{ id: number }>(`SELECT id FROM cities WHERE name = 'Lahore'`);
  if (city === null) throw new Error('Lahore must be seeded before the test provider');

  const area = await single<{ id: number }>(`SELECT id FROM areas WHERE city_id = ${city.id} AND name = 'Gulberg'`);
  if (area === null) throw new Error('Gulberg must be seeded before the test provider');

  const service = await single<{ id: number; minPricePaisa: bigint }>(`SELECT id, min_price_paisa as "minPricePaisa" FROM services WHERE slug = 'leak-repair'`);
  if (service === null) throw new Error('leak-repair must be seeded before the test provider');

  await execute(
    `INSERT INTO providers(user_id, status, bio, experience_years, qualification, city_id, base_address_text, base_location, radius_m, penalty_schedule_accepted_at, submitted_at, approved_at, approved_by)
     VALUES (${literal(PROVIDER_ID)}::uuid, 'APPROVED', 'Seeded test provider for API development.', 5, 'Licensed plumber', ${city.id},
       'Gulberg, Lahore', ST_SetSRID(ST_MakePoint(74.3587, 31.5204), 4326)::geography, 10000, now(), now(), now(), ${literal(admin.id)}::uuid)
     ON CONFLICT (user_id) DO UPDATE SET status = 'APPROVED', approved_at = now(), approved_by = EXCLUDED.approved_by`
  );

  await execute(
    `INSERT INTO provider_services(provider_id, service_id, status, price_paisa)
     VALUES (${literal(PROVIDER_ID)}::uuid, ${service.id}, 'APPROVED', ${service.minPricePaisa})
     ON CONFLICT (provider_id, service_id) DO UPDATE SET status = 'APPROVED', price_paisa = EXCLUDED.price_paisa`
  );

  await execute(`INSERT INTO provider_service_areas(provider_id, area_id) VALUES (${literal(PROVIDER_ID)}::uuid, ${area.id}) ON CONFLICT DO NOTHING`);

  await execute(`DELETE FROM provider_availability WHERE provider_id = ${literal(PROVIDER_ID)}::uuid`);
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    await execute(`INSERT INTO provider_availability(provider_id, weekday, start_time, end_time) VALUES (${literal(PROVIDER_ID)}::uuid, ${weekday}, '00:00', '23:59')`);
  }
};

const seedTestCustomer = async (passwordHash: string): Promise<void> => {
  await seedUser(CUSTOMER_ID, '+923001000097', 'customer@smart-home.local', 'Test', 'Customer', passwordHash);
  await execute(`INSERT INTO user_roles(user_id, role_code) VALUES (${literal(CUSTOMER_ID)}::uuid, 'CUSTOMER') ON CONFLICT DO NOTHING`);
  await execute(`INSERT INTO customers(user_id) VALUES (${literal(CUSTOMER_ID)}::uuid) ON CONFLICT DO NOTHING`);

  const city = await single<{ id: number }>(`SELECT id FROM cities WHERE name = 'Lahore'`);
  if (city === null) throw new Error('Lahore must be seeded before the test customer');
  const area = await single<{ id: number }>(`SELECT id FROM areas WHERE city_id = ${city.id} AND name = 'Gulberg'`);
  if (area === null) throw new Error('Gulberg must be seeded before the test customer');

  const existing = await single<{ id: string }>(`SELECT id FROM addresses WHERE customer_id = ${literal(CUSTOMER_ID)}::uuid AND archived_at IS NULL`);
  if (existing === null) {
    await execute(
      `INSERT INTO addresses(customer_id, label, line1, area_id, location, is_default)
       VALUES (${literal(CUSTOMER_ID)}::uuid, 'Home', 'House 1, Gulberg', ${area.id}, ST_SetSRID(ST_MakePoint(74.3587, 31.5204), 4326)::geography, true)`
    );
  }
};

export const seedTestAccounts = async (): Promise<void> => {
  const passwordHash = await hash(testAccountsPassword, { type: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  await seedTestProvider(passwordHash);
  await seedTestCustomer(passwordHash);
};

export const printTestAccountCredentials = (): void => {
  process.stdout.write('Development test accounts (same password as staff):\n');
  process.stdout.write(`  PROVIDER provider@smart-home.local  password: ${testAccountsPassword}  (approved, offers leak-repair in Gulberg)\n`);
  process.stdout.write(`  CUSTOMER customer@smart-home.local  password: ${testAccountsPassword}  (has a saved Gulberg address)\n`);
  process.stdout.write('\n');
};
