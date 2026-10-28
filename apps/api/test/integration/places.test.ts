import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { callApi, createTestApp } from './harness.js';

let app: NestExpressApplication;
let close: () => Promise<void>;

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
});

afterAll(async () => {
  await close();
});

describe('places: cities and areas', () => {
  it('lists the seeded active city for anonymous callers, with a point to search around', async () => {
    const response = await callApi<{ items: { id: number; name: string; lat: number | null; lng: number | null }[] }>(app, '/places/cities');
    expect(response.status).toBe(200);
    const lahore = response.body.items.find((item) => item.name === 'Lahore')!;
    // The centre is the mean of the city's area centroids, so a client with no
    // better point than "the city" has one to pass to /search/providers.
    expect(lahore.lat).toBeGreaterThan(30);
    expect(lahore.lat).toBeLessThan(32);
    expect(lahore.lng).toBeGreaterThan(73);
    expect(lahore.lng).toBeLessThan(75);
  });

  it('lists the areas within a city, each with its own centroid as usable lat/lng', async () => {
    const cities = await callApi<{ items: { id: number; name: string }[] }>(app, '/places/cities');
    const lahore = cities.body.items.find((item) => item.name === 'Lahore')!;

    const response = await callApi<{ items: { id: number; name: string; lat: number | null; lng: number | null }[] }>(app, `/places/cities/${lahore.id}/areas`);
    expect(response.status).toBe(200);
    expect(response.body.items.map((item) => item.name)).toContain('Gulberg');
    // Every seeded area has a centroid, so an area can become a search point and
    // an address point. A null would mean the area is listed but unusable.
    for (const area of response.body.items) {
      expect(area.lat, `${area.name} has no lat`).not.toBeNull();
      expect(area.lng, `${area.name} has no lng`).not.toBeNull();
    }
  });

  it('an area centroid is good enough to search providers with', async () => {
    const cities = await callApi<{ items: { id: number; name: string }[] }>(app, '/places/cities');
    const lahore = cities.body.items.find((item) => item.name === 'Lahore')!;
    const areas = await callApi<{ items: { name: string; lat: number; lng: number }[] }>(app, `/places/cities/${lahore.id}/areas`);
    const gulberg = areas.body.items.find((item) => item.name === 'Gulberg')!;

    const search = await callApi<{ items: unknown[] }>(app, `/search/providers?serviceSlug=leak-repair&lat=${gulberg.lat}&lng=${gulberg.lng}`);
    expect(search.status).toBe(200);
  });

  it('rejects an unknown city id with NOT_FOUND', async () => {
    const response = await callApi<{ code: string }>(app, '/places/cities/999999/areas');
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });
});
