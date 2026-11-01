import { describe, expect, it } from 'vitest';
import { gridSvg, nextGrid, normalize, overlayKey, pictureStyle } from '../src/overlays/overlays.js';

describe('overlays', () => {
  it('cycles the grid: off, 3×3, 4×4, off', () => {
    expect([nextGrid(0), nextGrid(3), nextGrid(4)]).toEqual([3, 4, 0]);
  });

  it('cleans up saved settings', () => {
    expect(normalize({ grid: 7, gray: 'yes', flip: true })).toEqual({ grid: 0, gray: false, flip: true });
    expect(normalize(null)).toEqual({ grid: 0, gray: false, flip: false });
  });

  it('turns settings into CSS', () => {
    expect(pictureStyle({ gray: true, flip: true })).toEqual({ filter: 'grayscale(1)', transform: 'scaleX(-1)' });
    expect(pictureStyle({ gray: false, flip: false })).toEqual({ filter: '', transform: '' });
  });

  it('draws n-1 lines each way, twice', () => {
    expect(gridSvg(0)).toBe('');
    expect(gridSvg(3).match(/<line/g)).toHaveLength(8);
    expect(gridSvg(3)).toContain('33.3333%');
  });

  it('maps shortcut keys, but not while typing', () => {
    const key = (k, extra = {}) => ({ key: k, target: { closest: () => null }, ...extra });
    expect(overlayKey(key('G'))).toBe('grid');
    expect(overlayKey(key('f'))).toBe('flip');
    expect(overlayKey(key('f', { metaKey: true }))).toBeNull();
    expect(overlayKey(key('b', { target: { closest: () => ({}) } }))).toBe(null);
  });
});
