// iNaturalist API (no key). https://api.inaturalist.org/v1/docs/
// Research-grade observations, photos licensed CC0 or CC BY only (the
// platform default is CC BY-NC, which we exclude). About 1 request a second.
import { getJson } from '../http.mjs';
import { normalizeLicense } from '../filters.mjs';

const BASE = 'https://api.inaturalist.org/v1/observations';

export const name = 'iNaturalist';

function toRecord(o, photo, category, extraTags = []) {
  const license = normalizeLicense(photo.license_code);
  const sized = (size) => photo.url?.replace('/square.', `/${size}.`);
  const dims = photo.original_dimensions ?? {};
  // "large" is 1024 px on the long side.
  const scale = dims.width && dims.height ? Math.min(1, 1024 / Math.max(dims.width, dims.height)) : 1;
  const taxon = o.taxon ?? {};
  return {
    id: `inat:${photo.id}`,
    source: 'inat',
    sourceName: name,
    category,
    title: taxon.preferred_common_name ? `${taxon.preferred_common_name} (${taxon.name})` : taxon.name || 'Unknown species',
    creator: o.user?.name || o.user?.login || '',
    date: (o.observed_on || '').slice(0, 4),
    objectType: '',
    tags: [...extraTags, taxon.iconic_taxon_name, taxon.name].filter(Boolean),
    license,
    credit: photo.attribution || `${o.user?.login ?? 'unknown'}, iNaturalist`,
    pageUrl: o.uri || `https://www.inaturalist.org/observations/${o.id}`,
    image: {
      thumb: sized('medium'),
      display: sized('large'),
      full: sized('original'),
      width: dims.width ? Math.round(dims.width * scale) : undefined,
      height: dims.height ? Math.round(dims.height * scale) : undefined,
    },
  };
}

// query: { taxonId, tags? }. A refresh starts at a random page of the
// top-voted photos (the API stops at 10,000 results, so page 50 at most) so
// each run finds photos the library doesn't have yet.
export async function fetchRecords(query, { want, accept, category, log, maxPages = 6, refresh = false, rand = Math.random }) {
  const picked = [];
  const first = refresh ? 1 + Math.floor(rand() * 25) : 1;
  for (let page = first; page < first + maxPages && page <= 50 && picked.length < want; page++) {
    const params = new URLSearchParams({
      taxon_id: String(query.taxonId),
      photo_license: 'cc0,cc-by',
      quality_grade: 'research',
      order_by: 'votes',
      per_page: '200',
      page: String(page),
    });
    const res = await getJson(`${BASE}?${params}`);
    if (page === first) log(`inat taxon ${query.taxonId} (from page ${first}): ${res.total_results ?? 0} total`);
    for (const o of res.results ?? []) {
      // One photo per observation: the first one with an allowed license.
      const photo = (o.photos ?? []).find((p) => normalizeLicense(p.license_code));
      if (!photo) continue;
      const r = toRecord(o, photo, category, query.tags);
      if (accept(r)) picked.push(r);
      if (picked.length >= want) break;
    }
    if ((res.results ?? []).length < 200) break;
  }
  return picked;
}
