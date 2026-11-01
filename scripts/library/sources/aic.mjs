// Art Institute of Chicago API (no key). https://api.artic.edu/docs/
// Only is_public_domain = true. Images hotlinked from their IIIF server.
import { getJson } from '../http.mjs';

const BASE = 'https://api.artic.edu/api/v1/artworks/search';
const FIELDS = 'id,title,artist_display,date_display,image_id,thumbnail,credit_line,artwork_type_title,classification_titles,is_public_domain,term_titles';

export const name = 'Art Institute of Chicago';

function toRecord(a, iiif, category) {
  const w = a.thumbnail?.width;
  const h = a.thumbnail?.height;
  // Display at 843 px wide (their recommended, best-cached size).
  const dispW = w ? Math.min(843, w) : 843;
  const dispH = w && h ? Math.round((h / w) * dispW) : undefined;
  return {
    id: `aic:${a.id}`,
    source: 'aic',
    sourceName: name,
    category,
    title: a.title || 'Untitled',
    creator: (a.artist_display || '').split('\n')[0],
    date: a.date_display || '',
    objectType: [a.artwork_type_title, ...(a.classification_titles ?? [])].join(' '),
    tags: (a.term_titles ?? []).slice(0, 6),
    license: a.is_public_domain ? { code: 'cc0', name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' } : null,
    credit: [a.credit_line, 'Art Institute of Chicago'].filter(Boolean).join(' · '),
    pageUrl: `https://www.artic.edu/artworks/${a.id}`,
    image: {
      thumb: `${iiif}/${a.image_id}/full/400,/0/default.jpg`,
      display: `${iiif}/${a.image_id}/full/843,/0/default.jpg`,
      width: dispW,
      height: dispH,
    },
  };
}

// query: { type: 'Sculpture' } (artwork_type_title)
export async function fetchRecords(query, { want, accept, category, log, maxPages = 15 }) {
  const picked = [];
  for (let page = 1; page <= maxPages && picked.length < want; page++) {
    const params = new URLSearchParams({ fields: FIELDS, limit: '100', page: String(page) });
    params.append('query[bool][must][][term][is_public_domain]', 'true');
    params.append('query[bool][must][][term][artwork_type_title.keyword]', query.type);
    params.append('query[bool][must][][exists][field]', 'image_id');
    const res = await getJson(`${BASE}?${params}`);
    if (page === 1) log(`aic ${query.type}: ${res.pagination?.total ?? 0} total`);
    const iiif = res.config?.iiif_url ?? 'https://www.artic.edu/iiif/2';
    for (const a of res.data ?? []) {
      if (!a.image_id) continue;
      const r = toRecord(a, iiif, category);
      if (accept(r)) picked.push(r);
      if (picked.length >= want) break;
    }
    if ((res.data ?? []).length < 100) break;
  }
  return picked;
}
