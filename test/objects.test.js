import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { OBJECT_SIZE, groupsOf, isLibraryShape, mergeModel, searchObjects, shapeIdFor } from '../src/still-life/objects.js';
import { sanitizeScene } from '../src/still-life/model.js';
import { geometryFor, registerGeometry } from '../src/still-life/shapes.js';

const catalog = [
  { id: 'coffee-mug-1', name: 'Coffee mug', group: 'cups and mugs', family: 'tableware', tags: ['coffee', 'mug'] },
  { id: 'desk-lamp-2', name: 'Desk lamp', group: 'lamps and candles', family: 'lighting', tags: ['lamp'] },
];

describe('object library', () => {
  it('searches names, groups and tags', () => {
    expect(searchObjects(catalog, '')).toHaveLength(2);
    expect(searchObjects(catalog, 'MUG').map((o) => o.id)).toEqual(['coffee-mug-1']);
    expect(searchObjects(catalog, 'lighting lamp').map((o) => o.id)).toEqual(['desk-lamp-2']);
    expect(searchObjects(catalog, 'chair')).toEqual([]);
  });

  it('lists categories with counts, in order', () => {
    expect(groupsOf([...catalog, { id: 'x', group: 'cups and mugs' }])).toEqual([
      { id: 'cups and mugs', label: 'Cups and mugs', count: 2 },
      { id: 'lamps and candles', label: 'Lamps and candles', count: 1 },
    ]);
  });

  it('keeps library objects in saved scenes, drops bad shape ids', () => {
    const scene = sanitizeScene({
      objects: [{ shape: shapeIdFor('coffee-mug-1') }, { shape: 'obj:../evil' }, { shape: 'cube' }],
    });
    expect(scene.objects.map((o) => o.shape)).toEqual(['obj:coffee-mug-1', 'cube']);
    expect(isLibraryShape('obj:coffee-mug-1')).toBe(true);
    expect(isLibraryShape('cube')).toBe(false);
  });

  it('merges a model into one geometry, base on the table, sized like the shapes', () => {
    const root = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2));
    a.position.set(5, 10, 0);
    const b = new THREE.Mesh(new THREE.SphereGeometry(1).toNonIndexed());
    b.position.set(5, 13, 0);
    root.add(a, b);
    root.scale.setScalar(0.01);
    const geo = mergeModel(root);
    const box = geo.boundingBox;
    const size = box.getSize(new THREE.Vector3());
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(OBJECT_SIZE, 5);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 5);
    expect(geo.attributes.normal).toBeTruthy();
  });

  it('serves registered objects as shapes', () => {
    const g = new THREE.BoxGeometry();
    registerGeometry('obj:test-1', g);
    expect(geometryFor('obj:test-1')).toBe(g);
    expect(() => geometryFor('obj:missing')).toThrow();
  });
});
