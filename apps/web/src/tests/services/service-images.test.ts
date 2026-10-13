import { describe, expect, it } from 'vitest';
import { getServicePhoto, SERVICE_IMAGE_MAP } from '@/lib/service-images';

describe('service images uniqueness guarantee', () => {
  const activeServiceSlugs = [
    'leak-repair',
    'blocked-drain',
    'new-fixture-install',
    'fault-finding',
    'switch-socket-repair',
    'washing-machine-repair',
    'ac-service',
    'refrigerator-repair',
    'furniture-repair',
    'door-window-repair',
    'interior-painting',
    'waterproofing-treatment',
    'deep-cleaning',
    'pest-control',
  ] as const;

  it('guarantees every active service maps to a valid Cloudinary image URL', () => {
    for (const slug of activeServiceSlugs) {
      const url = getServicePhoto(slug);
      expect(url).toBeDefined();
      expect(url).toMatch(/^https:\/\/res\.cloudinary\.com\//);
      expect(url).toContain('.jpg');
    }
  });

  it('guarantees NO TWO SERVICES share the same image (100% unique per service)', () => {
    const urls = activeServiceSlugs.map((slug) => getServicePhoto(slug));
    const uniqueUrls = new Set(urls);

    expect(uniqueUrls.size).toBe(activeServiceSlugs.length);
  });

  it('resolves direct service slug matches over category fallbacks', () => {
    // Both are plumbing, but must resolve to completely different images
    const leakRepair = getServicePhoto('leak-repair');
    const blockedDrain = getServicePhoto('blocked-drain');
    const newFixture = getServicePhoto('new-fixture-install');

    expect(leakRepair).not.toBe(blockedDrain);
    expect(leakRepair).not.toBe(newFixture);
    expect(blockedDrain).not.toBe(newFixture);

    expect(leakRepair).toContain('leak-repair');
    expect(blockedDrain).toContain('blocked-drain');
    expect(newFixture).toContain('new-fixture-install');
  });

  it('resolves distinct images for all carpentry services', () => {
    const furniture = getServicePhoto('furniture-repair');
    const door = getServicePhoto('door-window-repair');

    expect(furniture).not.toBe(door);
    expect(furniture).toContain('furniture-repair');
    expect(door).toContain('door-window-repair');
  });

  it('resolves distinct images for all electrical services', () => {
    const fault = getServicePhoto('fault-finding');
    const switchRepair = getServicePhoto('switch-socket-repair');

    expect(fault).not.toBe(switchRepair);
    expect(fault).toContain('fault-finding');
    expect(switchRepair).toContain('switch-socket-repair');
  });

  it('resolves distinct images for all appliance services', () => {
    const washer = getServicePhoto('washing-machine-repair');
    const ac = getServicePhoto('ac-service');
    const fridge = getServicePhoto('refrigerator-repair');

    expect(washer).not.toBe(ac);
    expect(washer).not.toBe(fridge);
    expect(ac).not.toBe(fridge);
  });
});
