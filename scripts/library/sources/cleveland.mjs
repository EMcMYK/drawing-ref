// Cleveland Museum of Art Open Access API (no key).
// https://openaccess-api.clevelandart.org/  Only share_license_status = CC0.
import { getJson } from '../http.mjs';

const BASE = 'https://openaccess-api.clevelandart.org/api/artworks/';

export const name = 'Cleveland Museum of Art';

function toRecord(a, category) {
  const web = a.images?.web ?? {};
  return {
    id: `cma:${a.id}`,
    source: 'cma',
    sourceName: name,
    category,
    title: a.title || 'Untitled',
    creator: (a.creators ?? []).map((c) => c.description).filter(Boolean).join('; ') || a.culture?.[0] || '',
    date: a.creation_date || '',
    objectType: a.type || '',
    tags: [],
    license: a.share_license_status === 'CC0' ? { code: 'cc0', name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' } : null,
    credit: [a.creditline, 'Cleveland Museum of Art'].filter(Boolean).join(' · '),
    pageUrl: a.url,
    image: {
      display: web.url,
      full: a.images?.print?.url,
      width: Number(web.width) || undefined,
      height: Number(web.height) || undefined,
    },
  };
}

// query: { type: 'Sculpture' }
export async function fetchRecords(query, { want, accept, category, log, maxPages = 10 }) {
  const picked = [];
  for (let page = 0; page < maxPages && picked.length < want; page++) {
    const params = new URLSearchParams({ type: query.type, cc0: '1', has_image: '1', limit: '200', skip: String(page * 200) });
    const res = await getJson(`${BASE}?${params}`);
    if (page === 0) log(`cleveland ${query.type}: ${res.info?.total ?? 0} total`);
    for (const a of res.data ?? []) {
      const r = toRecord(a, category);
      if (accept(r)) picked.push(r);
      if (picked.length >= want) break;
    }
    if ((res.data ?? []).length < 200) break;
  }
  return picked;
}
