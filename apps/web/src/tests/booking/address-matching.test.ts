import { describe, expect, it } from 'vitest';
import { KNOWN_AREA_CENTROIDS } from '@/features/booking/address-step';
import type { Area } from '@/features/places/api';

const sampleAreas: Area[] = [
  { id: 1, cityId: 1, name: 'Gulberg', lat: 31.325, lng: 74.240 },
  { id: 2, cityId: 1, name: 'Gulberg III', lat: 31.303, lng: 74.206 },
  { id: 3, cityId: 1, name: 'DHA Phase 5', lat: 31.347, lng: 74.249 },
  { id: 4, cityId: 1, name: 'DHA Phase 6', lat: 31.347, lng: 74.249 },
  { id: 5, cityId: 1, name: 'DHA Phase 7', lat: 31.347, lng: 74.249 },
  { id: 6, cityId: 1, name: 'Johar Town', lat: 31.340, lng: 74.223 },
  { id: 8, cityId: 1, name: 'Model Town', lat: 31.343, lng: 74.230 },
  { id: 11, cityId: 1, name: 'Cantt', lat: 31.300, lng: 74.243 },
];

describe('Lahore Area Matching & Real Geographic Centroids', () => {
  it('has true geographical centroids for all key Lahore areas', () => {
    expect(KNOWN_AREA_CENTROIDS['Gulberg']).toBeDefined();
    expect(KNOWN_AREA_CENTROIDS['Gulberg III']).toBeDefined();
    expect(KNOWN_AREA_CENTROIDS['Johar Town']).toBeDefined();
    expect(KNOWN_AREA_CENTROIDS['Model Town']).toBeDefined();
    expect(KNOWN_AREA_CENTROIDS['DHA Phase 5']).toBeDefined();
    expect(KNOWN_AREA_CENTROIDS['DHA Phase 7']).toBeDefined();

    // Verify Gulberg is near lat ~31.51, lng ~74.35 (not the fake 31.32)
    expect(KNOWN_AREA_CENTROIDS['Gulberg III'].lat).toBeCloseTo(31.5085, 2);
    expect(KNOWN_AREA_CENTROIDS['Gulberg III'].lng).toBeCloseTo(74.3486, 2);
  });

  it('correctly identifies Gulberg III as closest to Gulberg coordinates (31.5138, 74.3442)', () => {
    const userPoint = { lat: 31.5138, lng: 74.3442 };
    let closest = sampleAreas[0];
    let minDist = Infinity;

    for (const area of sampleAreas) {
      const coords = KNOWN_AREA_CENTROIDS[area.name];
      if (coords) {
        const dist = Math.hypot(coords.lat - userPoint.lat, coords.lng - userPoint.lng);
        if (dist < minDist) {
          minDist = dist;
          closest = area;
        }
      }
    }

    expect(closest.name).toBe('Gulberg III');
    expect(closest.name).not.toBe('DHA Phase 7');
  });

  it('identifies Johar Town as closest to Johar Town pin (31.4697, 74.2728)', () => {
    const userPoint = { lat: 31.4697, lng: 74.2728 };
    let closest = sampleAreas[0];
    let minDist = Infinity;

    for (const area of sampleAreas) {
      const coords = KNOWN_AREA_CENTROIDS[area.name];
      if (coords) {
        const dist = Math.hypot(coords.lat - userPoint.lat, coords.lng - userPoint.lng);
        if (dist < minDist) {
          minDist = dist;
          closest = area;
        }
      }
    }

    expect(closest.name).toBe('Johar Town');
  });
});
