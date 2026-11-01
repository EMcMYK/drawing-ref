import { describe, expect, it } from 'vitest';
import {
  autoTags,
  cleanCreator,
  cleanDate,
  mixAndCap,
  normalizeLicense,
  rejectReason,
  stripHtml,
  wikimediaCredit,
} from '../scripts/library/filters.mjs';

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

  it('treats concert photos as photos of people', () => {
    const gig = { ...ok, title: 'Violin player, Bardentreffen festival 2014' };
    expect(rejectReason(gig, { blockPeople: true })).toMatch(/^people/);
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

describe('cleanCreator', () => {
  it('drops "Creator:" template prefixes', () => {
    expect(cleanCreator('Creator:Joseph Bradbury')).toBe('Joseph Bradbury');
    expect(cleanCreator('Creator:Lorenz Hauslaib Creator:Steffan Cuntz')).toBe('Lorenz Hauslaib, Steffan Cuntz');
  });

  it('removes markup, links and usage notes', () => {
    expect(cleanCreator('<a href="//commons.wikimedia.org/wiki/User:X">Jebulon</a>')).toBe('Jebulon');
    expect(cleanCreator('JJ Harrison ( https://www.jjharrison.com.au/ )')).toBe('JJ Harrison');
    expect(cleanCreator('Julian Herzog ( Website )')).toBe('Julian Herzog');
    expect(cleanCreator('Photo by and (c)2008 Derek Ramsey ( Ram-Man ). Co-attribution must be given.')).toBe(
      'Derek Ramsey (Ram-Man)'
    );
    expect(cleanCreator('This Photo was taken by Wolfgang Moroder . Feel free to use my photos, but please...')).toBe(
      'Wolfgang Moroder'
    );
    expect(cleanCreator('Feel free to use my photos, but please mention me as the author')).toBe('');
  });

  it('cuts gallery markup listing other files', () => {
    expect(
      cleanCreator('Agnes Monkelbaan Staande geranium wit. (actm.) 03.jpg Staande geranium wit. (actm.) 04.jpg &lt;/gallery&gt;', {
        title: 'Staande geranium wit. (actm.) 02',
      })
    ).toBe('Agnes Monkelbaan');
  });

  it('keeps initials and repeated names tidy', () => {
    expect(cleanCreator('A.-K. D.')).toBe('A.-K. D.');
    expect(cleanCreator('Dominicus Johannes Bergsma.')).toBe('Dominicus Johannes Bergsma');
    expect(cleanCreator('Unknown author Unknown author')).toBe('Unknown author');
  });

  it('always leaves a credit line', () => {
    expect(wikimediaCredit('Jebulon')).toBe('Jebulon · Wikimedia Commons');
    expect(wikimediaCredit('')).toMatch(/Wikimedia Commons/);
  });
});

describe('cleanDate', () => {
  it('keeps whole dates instead of cutting them off', () => {
    expect(cleanDate('Taken on 1 March 2012, 10:22:33')).toBe('1 March 2012');
    expect(cleanDate('between 1700 and 1750')).toBe('between 1700 and 1750');
    expect(cleanDate('2012-03-01 10:22:33')).toBe('2012-03-01');
    expect(cleanDate('1598 date QS:P571,+1598-00-00T00:00:00Z/9')).toBe('1598');
    expect(cleanDate('Unknown date')).toBe('');
  });
});

describe('stripHtml', () => {
  it('removes escaped tags too', () => {
    expect(stripHtml('a &lt;/gallery&gt; b')).toBe('a b');
  });
});
