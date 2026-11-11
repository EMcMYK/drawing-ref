// The 3D object library: searchable objects (built by scripts/objects/build.py
// into public/objects/) that go into the still life like the basic shapes.
// Each object becomes one gray mesh, sized to the shapes, so it moves,
// stacks, turns, tips, scales and takes the light the same way.
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerGeometry } from './shapes.js';

export const PREFIX = 'obj:';
// Largest side of an object, in table units (the cube is 1).
export const OBJECT_SIZE = 1.2;

const base = () => import.meta.env?.BASE_URL ?? '/';

let catalogPromise = null;
let byId = new Map();

export function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch(`${base()}objects/index.json`)
      .then((r) => (r.ok ? r.json() : { objects: [] }))
      .then((d) => (Array.isArray(d.objects) ? d.objects : []))
      .catch(() => [])
      .then((list) => {
        byId = new Map(list.map((o) => [o.id, o]));
        return list;
      });
  }
  return catalogPromise;
}

export const shapeIdFor = (objectId) => PREFIX + objectId;
export const isLibraryShape = (shape) => typeof shape === 'string' && shape.startsWith(PREFIX);

export function objectInfo(shape) {
  return isLibraryShape(shape) ? byId.get(shape.slice(PREFIX.length)) ?? null : null;
}

export function searchObjects(list, query = '') {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((o) => {
    const hay = [o.name, o.group, o.family, ...(o.tags ?? [])].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// A short credit line, e.g. "Mug · CC BY 4.0".
export function creditLine(o) {
  return [o.name, o.license?.name].filter(Boolean).join(' · ');
}

// Copy an attribute into plain floats, so transforms aren't clipped by the
// compressed (normalised integer) formats the files use.
function toFloat(attr) {
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) {
    for (let k = 0; k < attr.itemSize; k++) out[i * attr.itemSize + k] = attr.getComponent(i, k);
  }
  return new THREE.BufferAttribute(out, attr.itemSize);
}

// All the parts of a loaded model as one geometry, base on y = 0, centred,
// with its largest side OBJECT_SIZE long.
export function mergeModel(root) {
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((node) => {
    if (!node.isMesh || !node.geometry?.attributes.position) return;
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', toFloat(node.geometry.attributes.position));
    if (node.geometry.index) g.setIndex(node.geometry.index.clone());
    g.applyMatrix4(node.matrixWorld);
    g = g.index ? g.toNonIndexed() : g;
    parts.push(g);
  });
  if (!parts.length) throw new Error('Model has no meshes');
  // Normals worked out here, not taken from the files: smooth across gentle
  // curves, crisp at edges sharper than 35°, like the built-in shapes.
  const geo = toCreasedNormals(mergeGeometries(parts), THREE.MathUtils.degToRad(35));
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  const size = box.getSize(new THREE.Vector3());
  const scale = OBJECT_SIZE / Math.max(size.x, size.y, size.z, 1e-6);
  const center = box.getCenter(new THREE.Vector3());
  geo.translate(-center.x, -box.min.y, -center.z);
  geo.scale(scale, scale, scale);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// The model loader is only fetched once someone adds an object.
let loader = null;
async function getLoader() {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ]);
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}
const loading = new Map();

// Load an object's model once and register it as a shape. Resolves to the
// shape id, or rejects if the object is unknown or its file is broken.
export function loadObjectShape(shape) {
  if (!loading.has(shape)) {
    const p = loadCatalog().then(async () => {
      const info = objectInfo(shape);
      if (!info) throw new Error(`Unknown object: ${shape}`);
      loader ??= getLoader();
      loader.catch(() => (loader = null));
      const gltf = await (await loader).loadAsync(`${base()}objects/${info.model}`);
      registerGeometry(shape, mergeModel(gltf.scene));
      return shape;
    });
    p.catch(() => loading.delete(shape));
    loading.set(shape, p);
  }
  return loading.get(shape);
}

// Load every library object a saved scene uses; drop the ones that fail.
export async function prepareObjects(objects) {
  const shapes = [...new Set(objects.map((o) => o.shape).filter(isLibraryShape))];
  const results = await Promise.allSettled(shapes.map(loadObjectShape));
  const failed = new Set(shapes.filter((_, i) => results[i].status === 'rejected'));
  return objects.filter((o) => !failed.has(o.shape));
}
