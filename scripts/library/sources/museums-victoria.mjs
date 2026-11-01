// Museums Victoria Collections API (no key; a User-Agent header is required).
// https://collections.museumsvictoria.com.au/developers  Public Domain / CC BY only.
import { getJson } from '../http.mjs';
import { normalizeLicense } from '../filters.mjs';

const BASE = 'https://collections.museumsvictoria.com.au/api/search';

export const name = 'Museums Victoria';

function toRecord(item, category) {
  const media = (item.media ?? []).find(
    (m) => m.type === 'image' && normalizeLicense(m.licence?.shortName, m.licence?.uri)
  );
  if (!media) return null;
  const img = media.medium ?? media.large ?? {};
  return {
    id: `mv:${item.id}`,
    source: 'mv',
    sourceName: name,
    category,
    title: item.displayTitle || item.objectName || 'Untitled',
    creator: (media.creators ?? []).join('; '),
    date: '',
    objectType: [item.objectName, item.category, item.discipline].filter(Boolean).join(' '),
    tags: [],
    license: normalizeLicense(media.licence?.shortName, media.licence?.uri),
    credit: [media.rightsStatement, 'Museums Victoria'].filter(Boolean).join(' · '),
    pageUrl: `https://collections.museumsvictoria.com.au/${item.id}`,
    image: {
      thumb: media.small?.uri,
      display: img.uri,
      full: media.large?.uri,
      width: img.width,
      height: img.height,
    },
  };
}

// query: { query: 'violin' }
export async function fetchRecords(query, { want, accept, category, log, maxPages = 8 }) {
  const picked = [];
  for (let page = 1; page <= maxPages && picked.length < want; page++) {
    const params = new URLSearchParams({
      query: query.query,
      recordtype: 'item',
      hasimages: 'yes',
      imagelicence: 'public domain,cc by',
      perpage: '100',
      page: String(page),
      envelope: 'true',
    });
    const res = await getJson(`${BASE}?${params}`);
    const items = Array.isArray(res) ? res : res.response ?? [];
    if (page === 1) log(`museums victoria "${query.query}": ${res.headers?.['Total-Results'] ?? items.length} total`);
    for (const item of items) {
      const r = toRecord(item, category);
      if (r && accept(r)) picked.push(r);
      if (picked.length >= want) break;
    }
    if (items.length < 100) break;
  }
  return picked;
}
