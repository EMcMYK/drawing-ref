import { describe, expect, it } from 'vitest';
import { autoTags, mixAndCap, normalizeLicense, rejectReason } from '../scripts/library/filters.mjs';

describe('normalizeLicense', () => {
  it.each([
    ['CC0', 'cc0'],
    ['CC0 1.0', 'cc0'],
    ['Public domain', 'pd'],
    ['Public Domain Mark', 'pd'],
    ['cc-by', 'cc-by'],
    ['CC BY 4.0', 'cc-by'],
    ['CC BY-SA 3.0', 'cc-by-sa'],
    ['cc0', 'cc0'],
  ])('%s -> %s', (label, code) => {
    expect(normalizeLicense(label)?.code).toBe(code);
  });

  it.each(['CC BY-NC 4.0', 'cc-by-nc', 'CC BY-NC-ND', 'CC BY-ND 2.0', 'GFDL', 'All rights reserved', '', undefined])(
    'rejects %s',
    (label) => {
      expect(normalizeLicense(label)).toBeNull();
    }
  );

  it('reads the license from a URL', () => {
    expect(normalizeLicense('', 'https://creativecommons.org/licenses/by/4.0')?.code).toBe('cc-by');
    expect(normalizeLicense('', 'https://creativecommons.org/licenses/by-nc/4.0')).toBeNull();
  });

  it('keeps the version in the name', () => {
    expect(normalizeLicense('CC BY-SA 3.0').name).toBe('CC BY-SA 3.0');
  });
});

const ok = {
  title: 'Marble head',
  license: { code: 'cc0' },
  image: { display: 'https://x/y.jpg', width: 800, height: 1000 },
};

describe('rejectReason', () => {
  it('accepts a good record', () => {
    expect(rejectReason(ok)).toBeNull();
  });

  it('rejects documents, flat art and missing licenses', () => {
    expect(rejectReason({ ...ok, title: 'Letter to the editor' })).toMatch(/^blocked/);
    expect(rejectReason({ ...ok, objectType: 'Painting' })).toMatch(/^blocked/);
    expect(rejectReason({ ...ok, license: null })).toBe('license');
  });

  it('does not block words that only contain a blocked word', () => {
    expect(rejectReason({ ...ok, title: 'Mapleleaf vase' })).toBeNull();
    expect(rejectReason({ ...ok, title: 'Printed cotton dress' })).toBeNull();
  });

  it('rejects tiny and extreme images', () => {
    expect(rejectReason({ ...ok, image: { display: 'x', width: 300, height: 400 } })).toBe('too-small');
    expect(rejectReason({ ...ok, image: { display: 'x', width: 3000, height: 1000 } })).toBe('aspect');
  });

  it('blocks people only when asked', () => {
    const astro = { ...ok, title: 'Astronaut portrait' };
    expect(rejectReason(astro)).toBeNull();
    expect(rejectReason(astro, { blockPeople: true })).toMatch(/^people/);
  });
});

describe('mixAndCap', () => {
  const r = (id, url = id) => ({ id, image: { display: url } });
  it('interleaves sources, dedupes and caps', () => {
    const out = mixAndCap([[r('a1'), r('a2'), r('a3')], [r('b1'), r('a1')]], 4);
    expect(out.map((x) => x.id)).toEqual(['a1', 'b1', 'a2', 'a3']);
  });
});

describe('autoTags', () => {
  it('tags hands', () => {
    expect(autoTags({ title: 'Study of Hands', tags: [] })).toContain('hands');
    expect(autoTags({ title: 'Handle of a jug', tags: [] })).not.toContain('hands');
  });
});
