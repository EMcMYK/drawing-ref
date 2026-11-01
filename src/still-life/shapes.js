import * as THREE from 'three';

// The six drawing-class forms. Every geometry sits with its base on y = 0 so
// height scaling grows it upward from the table.

function egg() {
  const points = [];
  const steps = 32;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI;
    const y = (1 - Math.cos(t)) / 2; // 0 at the bottom, 1 at the top
    // Wider near the bottom, narrower at the top.
    const r = Math.sin(t) * 0.38 * (1 - 0.18 * (y - 0.4));
    points.push(new THREE.Vector2(Math.max(r, 0.0001), y * 1.1));
  }
  return new THREE.LatheGeometry(points, 48);
}

const BUILDERS = {
  cube: () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  sphere: () => new THREE.SphereGeometry(0.5, 48, 32).translate(0, 0.5, 0),
  cylinder: () => new THREE.CylinderGeometry(0.4, 0.4, 1, 48).translate(0, 0.5, 0),
  cone: () => new THREE.ConeGeometry(0.5, 1.2, 48).translate(0, 0.6, 0),
  // Flat faces: split the shared corners so each face gets its own normal,
  // otherwise the four sides are shaded as if they were a smooth cone.
  pyramid: () => {
    const geo = new THREE.ConeGeometry(0.6, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0).toNonIndexed();
    geo.computeVertexNormals();
    return geo;
  },
  egg,
};

export const SHAPES = [
  { id: 'cube', label: 'Cube' },
  { id: 'sphere', label: 'Sphere' },
  { id: 'cylinder', label: 'Cylinder' },
  { id: 'cone', label: 'Cone' },
  { id: 'pyramid', label: 'Pyramid' },
  { id: 'egg', label: 'Egg' },
];

export const SHADES = [
  { id: 'white', label: 'White', color: 0xf2efe9 },
  { id: 'light', label: 'Light gray', color: 0xb8b6b2 },
  { id: 'mid', label: 'Mid gray', color: 0x8c8a85 },
  { id: 'dark', label: 'Dark gray', color: 0x5a5854 },
];

const geometryCache = new Map();

export function geometryFor(shape) {
  if (!BUILDERS[shape]) throw new Error(`Unknown shape: ${shape}`);
  if (!geometryCache.has(shape)) geometryCache.set(shape, BUILDERS[shape]());
  return geometryCache.get(shape);
}

// How far to roll a shape (about its local Z axis) so that it lies on its
// side. Cones and pyramids roll past 90° until a sloping face is flat on the
// table; everything else rolls a quarter turn. `size` and `height` are the
// object's scale factors, since they change the slope.
const SLOPED = {
  cone: { radius: 0.5, height: 1.2 },
  // Four-sided cone turned 45°, so its faces point along X and Z: the
  // distance from the centre to a face is the radius times cos 45°.
  pyramid: { radius: 0.6 * Math.SQRT1_2, height: 1 },
};

export function tipAngle(shape, size = 1, height = 1) {
  const s = SLOPED[shape];
  if (!s) return Math.PI / 2;
  const r = s.radius * size;
  const h = s.height * size * height;
  return Math.PI - Math.atan2(h, r);
}

export function shadeColor(shade) {
  return (SHADES.find((s) => s.id === shade) ?? SHADES[0]).color;
}
