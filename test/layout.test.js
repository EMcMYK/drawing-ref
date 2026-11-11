import { describe, expect, it } from 'vitest';
import {
  TABLE,
  clampToTable,
  findFreeSpot,
  moveTo,
  settle,
  stackedOn,
} from '../src/still-life/layout.js';

const box = (id, x, z, extra = {}) => ({
  id,
  x,
  z,
  y: 0,
  halfX: 0.5,
  halfZ: 0.5,
  height: 1,
  ...extra,
});

describe('clampToTable', () => {
  it('keeps the whole footprint on the table', () => {
    const b = clampToTable(box('a', 100, -100));
    expect(b.x).toBe(TABLE.halfX - 0.5);
    expect(b.z).toBe(-(TABLE.halfZ - 0.5));
  });
});

describe('moveTo', () => {
  it('stacks an object dropped onto another', () => {
    const boxes = [box('a', 0, 0), box('b', 2, 0)];
    const moved = moveTo(boxes, 'b', 0.1, 0);
    expect(moved.find((b) => b.id === 'b').y).toBe(1);
  });

  it('pushes an object clear when it only clips the edge of another', () => {
    const boxes = [box('a', 0, 0), box('b', 2, 0)];
    const b = moveTo(boxes, 'b', 0.9, 0).find((b) => b.id === 'b');
    expect(b.y).toBe(0);
    expect(Math.abs(b.x)).toBeGreaterThanOrEqual(1);
  });

  it('carries the stack along when the bottom object moves', () => {
    let boxes = [box('a', 0, 0), box('b', 2, 0)];
    boxes = moveTo(boxes, 'b', 0, 0);
    boxes = moveTo(boxes, 'a', -2, 1);
    const b = boxes.find((b) => b.id === 'b');
    expect([b.x, b.y, b.z]).toEqual([-2, 1, 1]);
  });

  it('never moves an object off the table', () => {
    const b = moveTo([box('a', 0, 0)], 'a', 50, 50)[0];
    expect(b.x).toBeLessThanOrEqual(TABLE.halfX);
    expect(b.z).toBeLessThanOrEqual(TABLE.halfZ);
  });
});

describe('settle', () => {
  it('drops an object to the table when nothing is under it', () => {
    expect(settle([box('a', 0, 0, { y: 3 })])[0].y).toBe(0);
  });
});

describe('stackedOn', () => {
  it('finds everything resting on an object, all the way up', () => {
    const boxes = [box('a', 0, 0), box('b', 0, 0, { y: 1 }), box('c', 0, 0, { y: 2 })];
    expect(stackedOn(boxes, 'a').sort()).toEqual(['b', 'c']);
  });
});

describe('findFreeSpot', () => {
  it('uses the centre when the table is empty', () => {
    expect(findFreeSpot([], box('n', 0, 0))).toEqual({ x: 0, z: 0 });
  });

  it('avoids objects already on the table', () => {
    const spot = findFreeSpot([box('a', 0, 0)], box('n', 0, 0));
    const clear = Math.abs(spot.x) >= 1 || Math.abs(spot.z) >= 1;
    expect(clear).toBe(true);
  });
});

describe('moveTo with overlap on', () => {
  it('lets a shape pass into another instead of pushing or stacking', () => {
    const boxes = [box('a', 0, 0), box('b', 2, 0)];
    const b = moveTo(boxes, 'b', 0.2, 0, { overlap: true }).find((x) => x.id === 'b');
    expect(b.x).toBeCloseTo(0.2);
    expect(b.y).toBe(0);
  });

  it('still keeps the shape on the table', () => {
    const b = moveTo([box('b', 0, 0)], 'b', 99, 0, { overlap: true })[0];
    expect(b.x).toBeLessThanOrEqual(TABLE.halfX);
  });
});

describe('lift and shared bases', () => {
  const box = (id, x, z, y = 0, extra = {}) => ({ id, x, z, y, halfX: 0.5, halfZ: 0.5, height: 1, ...extra });

  it('things stacked on a lifted object rest on its raised top', () => {
    const base = box('a', 0, 0, 0, { lift: 1 });
    const onTop = box('b', 0, 0, 2);
    expect(stackedOn([base, onTop], 'a')).toEqual(['b']);
    const settled = settle([base, onTop]);
    expect(settled.find((b) => b.id === 'b').y).toBe(2);
  });

  it('moving a lifted base keeps it at the bottom of its stack', () => {
    const boxes = [box('a', 0, 0, 0, { lift: 1 }), box('b', 0, 0, 2)];
    const out = moveTo(boxes, 'a', 1, 0);
    expect(out.find((b) => b.id === 'a').y).toBe(0);
    expect(out.find((b) => b.id === 'b')).toMatchObject({ x: 1, y: 2 });
  });

  it('two things on the same base push apart instead of overlapping', () => {
    const base = { id: 'base', x: 0, z: 0, y: 0, halfX: 2, halfZ: 2, height: 1 };
    const left = box('l', -0.3, 0, 1, { halfX: 0.3, halfZ: 0.3 });
    const right = box('r', 1, 0, 1, { halfX: 0.3, halfZ: 0.3 });
    const out = moveTo([base, left, right], 'r', 0.1, 0);
    const r = out.find((b) => b.id === 'r');
    expect(r.y).toBe(1);
    expect(Math.abs(r.x - -0.3)).toBeGreaterThanOrEqual(0.6);
  });
});
