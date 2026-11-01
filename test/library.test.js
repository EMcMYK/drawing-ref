import { describe, expect, it } from 'vitest';
import { BROKEN, byLine, createBrokenTracker, creditLine, filterImages, needsCredit, pickRandom } from '../src/references/library.js';

const img = (id, extra = {}) => ({
  id,
  title: `Title ${id}`,
  sourceName: 'Cleveland Museum of Art',
  tags: [],
  license: { code: 'cc0', name: 'CC0 1.0' },
  image: { display: `https://x/${id}.jpg` },
  ...extra,
});

describe('filterImages', () => {
  const list = [
    img('a', { title: 'Marble hand', tags: ['hands'] }),
    img('b', { title: 'Bronze horse', license: { code: 'cc-by', name: 'CC BY' } }),
    img('c', { title: 'Helmet' }),
  ];

  it('searches title and tags, all words', () => {
    expect(filterImages(list, { query: 'hands' }).map((i) => i.id)).toEqual(['a']);
    expect(filterImages(list, { query: 'bronze horse' }).map((i) => i.id)).toEqual(['b']);
    expect(filterImages(list, { query: 'bronze helmet' })).toEqual([]);
  });

  it('can hide images that need credit', () => {
    expect(filterImages(list, { license: 'no-credit' }).map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('skips broken images', () => {
    expect(filterImages(list, { broken: new Map([['c', 1]]) }).map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('pickRandom', () => {
  it('never repeats the current image when there is a choice', () => {
    const list = [img('a'), img('b')];
    for (let i = 0; i < 20; i++) expect(pickRandom(list, 'a').id).toBe('b');
  });

  it('handles empty lists', () => {
    expect(pickRandom([])).toBeNull();
  });
});

describe('credit', () => {
  it('knows which licenses need credit', () => {
    expect(needsCredit(img('a'))).toBe(false);
    expect(needsCredit(img('b', { license: { code: 'cc-by-sa' } }))).toBe(true);
  });

  it('builds a one-line credit', () => {
    expect(creditLine(img('a', { creator: 'Unknown' }))).toBe('Title a · Unknown · Cleveland Museum of Art · CC0 1.0');
  });
});

describe('byLine', () => {
  it('does not repeat a creator the credit already names', () => {
    expect(byLine({ creator: 'Jebulon', date: '2012', credit: 'Jebulon · Wikimedia Commons' })).toBe('2012');
    expect(byLine({ creator: 'Unknown', date: 'c. 1700', credit: 'Gift of X · The Met' })).toBe('Unknown, c. 1700');
  });
});

describe('createBrokenTracker', () => {
  const HOUR = 3_600_000;
  const memory = () => {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m };
  };
  const pic = (id, source = 'wmc') => ({ id, source });
  // A visit at a given hour: a fresh tracker on the same storage.
  const visit = (storage, hour, online = true) => createBrokenTracker({ storage, now: () => hour * HOUR, online: () => online });

  it('hides a failed image for the rest of the visit, but not the next one', () => {
    const storage = memory();
    const t = visit(storage, 0);
    t.fail(pic('a'));
    expect(t.has('a')).toBe(true);
    expect(visit(storage, 1).has('a')).toBe(false);
  });

  it('hides an image only after it fails on several visits spread over time', () => {
    const storage = memory();
    for (let i = 0; i < BROKEN.strikes; i++) {
      expect(visit(storage, i * 7).has('a')).toBe(false);
      visit(storage, i * 7).fail(pic('a'));
    }
    expect(visit(storage, BROKEN.strikes * 7).has('a')).toBe(true);
    // ...and gives it another chance later.
    expect(visit(storage, BROKEN.strikes * 7 + BROKEN.days * 24).has('a')).toBe(false);
  });

  it('counts quick reloads as one failure', () => {
    const storage = memory();
    for (let i = 0; i < 10; i++) visit(storage, i * 0.1).fail(pic('a'));
    expect(visit(storage, 2).has('a')).toBe(false);
  });

  it('remembers nothing when many images from one source fail (blocker or outage)', () => {
    const storage = memory();
    for (let v = 0; v < 5; v++) {
      const t = visit(storage, v * 24);
      t.ok(pic('m1', 'met'));
      for (let i = 0; i < 60; i++) t.fail(pic(`w${i}`));
      expect(t.anyDown).toBe(true);
    }
    const later = visit(storage, 200);
    expect(later.has('w0')).toBe(false);
    expect(later.has('w59')).toBe(false);
  });

  it('remembers nothing while offline', () => {
    const storage = memory();
    for (let v = 0; v < 5; v++) visit(storage, v * 24, false).fail(pic('a'));
    expect(visit(storage, 200).has('a')).toBe(false);
  });

  it('forgets the old, over-eager list', () => {
    const storage = memory();
    storage.setItem('drawing-ref:broken-images:v2', JSON.stringify({ a: Date.now() }));
    const t = createBrokenTracker({ storage });
    expect(t.has('a')).toBe(false);
    expect(storage.getItem('drawing-ref:broken-images:v2')).toBeNull();
  });

  it('works with filterImages', () => {
    const t = visit(memory(), 0);
    t.fail(pic('b'));
    expect(filterImages([img('a'), img('b')], { broken: t }).map((i) => i.id)).toEqual(['a']);
  });
});
