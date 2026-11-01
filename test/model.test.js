import { describe, expect, it } from 'vitest';
import { LIMITS, randomScene, sanitizeScene, singleShape } from '../src/still-life/model.js';
import { tipAngle } from '../src/still-life/shapes.js';
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

describe('one-shape starters and overlap setting', () => {
  it('builds a single shape of any kind', () => {
    for (const shape of ['cube', 'sphere', 'cylinder', 'cone', 'pyramid', 'egg']) {
      const objs = singleShape(shape);
      expect(objs).toHaveLength(1);
      expect(objs[0].shape).toBe(shape);
    }
  });

  it('keeps the overlap setting only when it is exactly true', () => {
    expect(sanitizeScene({ overlap: true }).overlap).toBe(true);
    expect(sanitizeScene({ overlap: 'yes' }).overlap).toBe(false);
  });
});

describe('tipAngle', () => {
  it('rolls cones and pyramids onto a sloping face, others a quarter turn', () => {
    expect(tipAngle('cube')).toBeCloseTo(Math.PI / 2);
    // Cone: radius 0.5, height 1.2, so the side is 67.4° from the base.
    expect((tipAngle('cone') * 180) / Math.PI).toBeCloseTo(112.6, 1);
    expect((tipAngle('pyramid') * 180) / Math.PI).toBeCloseTo(113.0, 1);
    // A taller cone has a steeper side, so it rolls less far.
    expect(tipAngle('cone', 1, 2)).toBeLessThan(tipAngle('cone'));
  });
});

describe('default view', () => {
  it('keeps the light ball inside the frame at eye level', async () => {
    const THREE = await import('three');
    const { CAMERA_PRESETS, LIGHT_RADIUS, defaultLight } = await import('../src/still-life/model.js');
    const { azimuth, elevation } = defaultLight();
    const el = THREE.MathUtils.degToRad(elevation);
    const az = THREE.MathUtils.degToRad(azimuth);
    const ball = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).multiplyScalar(
      LIGHT_RADIUS
    );
    // Wide desktop and narrower laptop shapes of the scene panel.
    for (const aspect of [1.25, 1.6, 2]) {
      const camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 100);
      camera.position.fromArray(CAMERA_PRESETS.eye.position);
      camera.lookAt(new THREE.Vector3().fromArray(CAMERA_PRESETS.eye.target));
      camera.updateMatrixWorld();
      // The ball's top edge (radius 0.22) must sit below the top of the frame.
      const top = ball.clone().add(new THREE.Vector3(0, 0.22, 0)).project(camera);
      expect(top.y).toBeLessThan(0.95);
      expect(Math.abs(ball.clone().project(camera).x)).toBeLessThan(0.95);
    }
  });
});
