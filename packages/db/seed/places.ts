import { execute, literal, single } from './support.js';

export const cityName = 'Lahore';
export const cityTimeZone = 'Asia/Karachi';

export const areaNames: readonly string[] = [
  'Gulberg',
  'Gulberg III',
  'DHA Phase 5',
  'DHA Phase 6',
  'DHA Phase 7',
  'Johar Town',
  'Faisal Town',
  'Model Town',
  'Bahria Town',
  'Bahria Town Phase 4',
  'Cantt',
  'Shalimar',
  'Green Town',
  'Samanabad',
  'Gulshan-e-Iqbal',
  'Askari 10',
  'PECHS',
  'Gulistan-e-Jauhar',
  'Wapda Town',
  'Shahdara',
  'Raiwind Road',
  'MMA Chowk',
  'Garden Town',
  'Muslim Town'
];

/**
 * BE-028: real-world APPROXIMATE centroids (WGS84), replacing the hash-derived points that put Gulberg about
 * 25 km from where it is. They are placed from general knowledge of Lahore's geography to roughly a few hundred
 * metres to a kilometre; they are NOT surveyed. Ops should confirm each against the real area boundary before
 * the numbers are relied on for fine distance ranking. The least certain are marked (low).
 */
export const areaCentroids: Readonly<Record<string, { lat: number; lng: number }>> = {
  Gulberg: { lat: 31.52, lng: 74.35 },
  'Gulberg III': { lat: 31.5125, lng: 74.3445 },
  'DHA Phase 5': { lat: 31.47, lng: 74.405 },
  'DHA Phase 6': { lat: 31.456, lng: 74.43 },
  'DHA Phase 7': { lat: 31.442, lng: 74.412 },
  'Johar Town': { lat: 31.4697, lng: 74.2728 },
  'Faisal Town': { lat: 31.4818, lng: 74.301 },
  'Model Town': { lat: 31.4826, lng: 74.3237 },
  'Bahria Town': { lat: 31.364, lng: 74.179 },
  'Bahria Town Phase 4': { lat: 31.372, lng: 74.196 },
  Cantt: { lat: 31.51, lng: 74.385 },
  Shalimar: { lat: 31.5822, lng: 74.3817 },
  'Green Town': { lat: 31.44, lng: 74.3 },
  Samanabad: { lat: 31.5373, lng: 74.3015 },
  'Gulshan-e-Iqbal': { lat: 31.516, lng: 74.292 },
  'Askari 10': { lat: 31.498, lng: 74.42 }, // (low)
  PECHS: { lat: 31.485, lng: 74.29 }, // (low)
  'Gulistan-e-Jauhar': { lat: 31.459, lng: 74.264 }, // (low)
  'Wapda Town': { lat: 31.439, lng: 74.269 },
  Shahdara: { lat: 31.6203, lng: 74.287 },
  'Raiwind Road': { lat: 31.43, lng: 74.25 },
  'MMA Chowk': { lat: 31.515, lng: 74.358 },
  'Garden Town': { lat: 31.503, lng: 74.325 },
  'Muslim Town': { lat: 31.523, lng: 74.33 }
};

const centroidOf = (name: string): { lat: string; lng: string } => {
  const point = areaCentroids[name];
  if (point === undefined) throw new Error('No centroid recorded for area ' + name);
  return { lat: point.lat.toFixed(6), lng: point.lng.toFixed(6) };
};

export const seedPlaces = async (): Promise<void> => {
  const city = await single<{ id: string }>(
    `INSERT INTO cities(name, timezone) VALUES (${literal(cityName)}, ${literal(cityTimeZone)})
     ON CONFLICT (name) DO UPDATE SET timezone = EXCLUDED.timezone RETURNING id`
  );
  if (city === null) throw new Error('City insert returned no row');
  for (const name of areaNames) {
    const centroid = centroidOf(name);
    await execute(
      `INSERT INTO areas(city_id, name, centroid)
       SELECT c.id, ${literal(name)}, ST_SetSRID(ST_MakePoint(${centroid.lng}, ${centroid.lat}), 4326)::geography
       FROM cities c WHERE c.id = '${city.id}'
         AND NOT EXISTS (SELECT 1 FROM areas a WHERE a.city_id = c.id AND a.name = ${literal(name)})`
    );
    // Re-seeding corrects areas that were first seeded with the old invented centroids.
    await execute(
      `UPDATE areas SET centroid = ST_SetSRID(ST_MakePoint(${centroid.lng}, ${centroid.lat}), 4326)::geography
       WHERE city_id = '${city.id}' AND name = ${literal(name)}`
    );
  }
};
