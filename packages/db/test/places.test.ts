// BE-028: the seeded Lahore area centroids are real-world approximations, not hash noise.
import { describe, expect, it } from 'vitest';
import { areaCentroids, areaNames } from '../seed/places.js';

const kmBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number => {
  const toRad = (value: number): number => (value * Math.PI) / 180;
  const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

describe('seeded area centroids', () => {
  it('every seeded area has a centroid and every centroid is a seeded area', () => {
    expect(Object.keys(areaCentroids).sort()).toEqual([...areaNames].sort());
  });

  it('every centroid is inside greater Lahore (the old invented points were all in a 5 km box near 31.3, 74.2)', () => {
    const centre = { lat: 31.52, lng: 74.35 };
    for (const [name, point] of Object.entries(areaCentroids)) {
      expect(point.lat, name).toBeGreaterThan(31.3);
      expect(point.lat, name).toBeLessThan(31.7);
      expect(point.lng, name).toBeGreaterThan(74.1);
      expect(point.lng, name).toBeLessThan(74.5);
      expect(kmBetween(point, centre), name).toBeLessThan(30);
    }
  });

  it('well-known anchors are where they really are', () => {
    expect(kmBetween(areaCentroids['Gulberg']!, { lat: 31.52, lng: 74.35 })).toBeLessThan(1);
    expect(kmBetween(areaCentroids['Johar Town']!, { lat: 31.47, lng: 74.27 })).toBeLessThan(1);
    expect(kmBetween(areaCentroids['Model Town']!, { lat: 31.48, lng: 74.325 })).toBeLessThan(1);
    // Bahria Town is out on the Raiwind Road side, DHA to the south-east of Cantt, Shahdara north of the Ravi.
    expect(areaCentroids['Bahria Town']!.lat).toBeLessThan(areaCentroids['Gulberg']!.lat - 0.1);
    expect(areaCentroids['Shahdara']!.lat).toBeGreaterThan(areaCentroids['Gulberg']!.lat + 0.08);
  });

  it('no two areas share a point', () => {
    const seen = new Set(Object.values(areaCentroids).map(point => `${point.lat},${point.lng}`));
    expect(seen.size).toBe(Object.keys(areaCentroids).length);
  });
});
