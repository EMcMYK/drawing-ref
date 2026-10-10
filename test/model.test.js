import { describe, expect, it } from 'vitest';
import { LIMITS, randomScene, sanitizeScene } from '../src/still-life/model.js';
import { pngFilename } from '../src/still-life/persist.js';

describe('sanitizeScene', () => {
  it('rejects junk', () => {
    expect(sanitizeScene(null)).toBeNull();
    expect(sanitizeScene('nope')).toBeNull();
  });

  it('drops unknown shapes and clamps values', () => {
    const s = sanitizeScene({
      objects: [
        { shape: 'cube', size: 99, height: -4, shade: 'purple' },
        { shape: 'teapot' },
      ],
      light: { azimuth: 10, elevation: 200, intensity: 'bright' },
    });
    expect(s.objects).toHaveLength(1);
    expect(s.objects[0].size).toBe(LIMITS.size[1]);
    expect(s.objects[0].height).toBe(LIMITS.height[0]);
    expect(s.objects[0].shade).toBe('white');
    expect(s.light.elevation).toBe(LIMITS.elevation[1]);
    expect(Number.isFinite(s.light.intensity)).toBe(true);
    expect(s.camera).toBeNull();
  });

  it('caps the number of shapes', () => {
    const objects = Array.from({ length: 40 }, () => ({ shape: 'sphere' }));
    expect(sanitizeScene({ objects }).objects).toHaveLength(LIMITS.maxObjects);
  });
});

describe('randomScene', () => {
  it('makes 3 to 5 shapes', () => {
    for (let i = 0; i < 20; i++) {
      const n = randomScene().objects.length;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
  });
});

describe('pngFilename', () => {
  it('stamps date and time', () => {
    expect(pngFilename(new Date(2026, 9, 10, 9, 5))).toBe('still-life-2026-10-10-0905.png');
  });
});
