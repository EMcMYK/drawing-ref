// NASA Image and Video Library (no key). https://images.nasa.gov/docs/
// NASA media is generally not copyrighted; credit NASA, no logos or implied
// endorsement. Photos of people are filtered out.
import { getJson } from '../http.mjs';

const BASE = 'https://images-api.nasa.gov/search';

export const name = 'NASA';

function toRecord(item, category) {
  const d = item.data?.[0] ?? {};
  const link = (item.links ?? []).find((l) => l.render === 'image') ?? {};
  // Some items credit a third party in their metadata; those aren't NASA's to give.
  const thirdParty = /©|copyright|courtesy of/i.test(`${d.description ?? ''} ${d.photographer ?? ''} ${d.secondary_creator ?? ''}`);
  return {
    id: `nasa:${d.nasa_id}`,
    source: 'nasa',
    sourceName: name,
    category,
    title: d.title || d.nasa_id,
    creator: d.photographer || d.secondary_creator || `NASA ${d.center ?? ''}`.trim(),
    date: (d.date_created || '').slice(0, 4),
    objectType: '',
    tags: (d.keywords ?? []).slice(0, 8),
    license: thirdParty ? null : { code: 'pd', name: 'Public domain (NASA)', url: 'https://www.nasa.gov/nasa-brand-center/images-and-media/' },
    credit: `NASA${d.center ? ` / ${d.center}` : ''}`,
    pageUrl: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`,
    image: {
      display: link.href,
      full: link.href?.replace(/~(medium|small|thumb)\./, '~orig.'),
      width: link.width,
      height: link.height,
    },
  };
}

// query: { q }
export async function fetchRecords(query, { want, accept, category, log, maxPages = 5 }) {
  const picked = [];
  for (let page = 1; page <= maxPages && picked.length < want; page++) {
    const params = new URLSearchParams({ q: query.q, media_type: 'image', page_size: '100', page: String(page) });
    const res = await getJson(`${BASE}?${params}`);
    if (page === 1) log(`nasa "${query.q}": ${res.collection?.metadata?.total_hits ?? 0} total`);
    const items = res.collection?.items ?? [];
    for (const item of items) {
      const r = toRecord(item, category);
      if (accept(r, { blockPeople: true })) picked.push(r);
      if (picked.length >= want) break;
    }
    if (items.length < 100) break;
  }
  return picked;
}
