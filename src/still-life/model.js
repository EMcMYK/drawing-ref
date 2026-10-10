// The still-life scene as plain data: what gets saved, restored and randomised.
import { SHADES, SHAPES } from './shapes.js';

export const LIMITS = {
  maxObjects: 12,
  size: [0.5, 2],
  height: [0.5, 2.5],
  intensity: [0, 3],
  elevation: [5, 89],
};

export const LIGHT_PRESETS = {
  classic: { label: 'Classic', azimuth: -45, elevation: 50 },
  side: { label: 'Side', azimuth: -90, elevation: 20 },
  back: { label: 'Back (rim)', azimuth: 165, elevation: 30 },
  top: { label: 'Top', azimuth: 0, elevation: 85 },
};

export const CAMERA_PRESETS = {
  eye: { label: 'Eye level', position: [0, 3.4, 8], target: [0, 0.4, 0] },
  high: { label: 'High', position: [0, 8, 6.5], target: [0, 0.3, 0] },
  low: { label: 'Low', position: [0, 0.6, 7.5], target: [0, 1, 0] },
};

let nextId = 1;
export function newId() {
  return `o${Date.now().toString(36)}${(nextId++).toString(36)}`;
}

export function newObject(shape, overrides = {}) {
  return {
    id: newId(),
    shape,
    x: 0,
    z: 0,
    y: 0,
    rotY: 0,
    tipped: false,
    size: 1,
    height: 1,
    shade: 'white',
    ...overrides,
  };
}

export function defaultLight() {
  return { ...LIGHT_PRESETS.classic, intensity: 1.6 };
}

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const shapeIds = new Set(SHAPES.map((s) => s.id));
const shadeIds = new Set(SHADES.map((s) => s.id));

// Turn untrusted saved data back into a valid scene, dropping anything broken.
export function sanitizeScene(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const objects = (Array.isArray(raw.objects) ? raw.objects : [])
    .filter((o) => o && shapeIds.has(o.shape))
    .slice(0, LIMITS.maxObjects)
    .map((o) =>
      newObject(o.shape, {
        x: num(o.x, 0),
        z: num(o.z, 0),
        y: num(o.y, 0),
        rotY: num(o.rotY, 0),
        tipped: o.tipped === true,
        size: clamp(num(o.size, 1), LIMITS.size),
        height: clamp(num(o.height, 1), LIMITS.height),
        shade: shadeIds.has(o.shade) ? o.shade : 'white',
      })
    );
  const l = raw.light ?? {};
  const fallback = defaultLight();
  const light = {
    azimuth: num(l.azimuth, fallback.azimuth),
    elevation: clamp(num(l.elevation, fallback.elevation), LIMITS.elevation),
    intensity: clamp(num(l.intensity, fallback.intensity), LIMITS.intensity),
  };
  const c = raw.camera;
  const vec = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  const camera = c && vec(c.position) && vec(c.target) ? { position: c.position, target: c.target } : null;
  return { objects, light, camera };
}

export const STARTER_SCENES = {
  cube: {
    label: 'Single cube',
    build: () => [newObject('cube', { rotY: 30 })],
  },
  pair: {
    label: 'Sphere and cube',
    build: () => [
      newObject('cube', { x: -0.7, rotY: 20 }),
      newObject('sphere', { x: 0.7, z: 0.4, size: 0.9 }),
    ],
  },
  group: {
    label: 'Group of five',
    build: () => [
      newObject('cube', { x: -1.4, z: -0.4, rotY: 35, height: 1.6 }),
      newObject('cylinder', { x: 0, z: -0.7, height: 1.4, shade: 'light' }),
      newObject('sphere', { x: 0.2, z: 0.7, size: 0.8 }),
      newObject('cone', { x: 1.4, z: -0.2 }),
      newObject('egg', { x: -0.9, z: 0.9, tipped: true, rotY: 60, size: 0.9 }),
    ],
  },
};

export function randomScene(rand = Math.random) {
  const count = 3 + Math.floor(rand() * 3);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const objects = Array.from({ length: count }, () =>
    newObject(pick(SHAPES).id, {
      x: (rand() * 2 - 1) * 2.2,
      z: (rand() * 2 - 1) * 1.2,
      rotY: Math.round(rand() * 24) * 15,
      size: 0.7 + rand() * 0.6,
      height: rand() < 0.3 ? 1 + rand() : 1,
      tipped: rand() < 0.15,
      shade: rand() < 0.75 ? 'white' : pick(SHADES).id,
    })
  );
  const light = {
    azimuth: Math.round((rand() * 360 - 180) / 5) * 5,
    elevation: 15 + Math.round(rand() * 60),
    intensity: 1.6,
  };
  return { objects, light };
}
