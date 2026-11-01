import { describe, expect, it } from 'vitest';
import { creditLine, filterImages, needsCredit, pickRandom } from '../src/references/library.js';

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
