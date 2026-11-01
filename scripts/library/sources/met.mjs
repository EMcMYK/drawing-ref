// The Metropolitan Museum of Art Open Access API (no key).
// https://metmuseum.github.io/  Only objects with isPublicDomain = true (CC0).
import { getJson, mapLimit, seededShuffle } from '../http.mjs';

const BASE = 'https://collectionapi.metmuseum.org/public/collection/v1';

export const name = 'The Metropolitan Museum of Art';

function toRecord(o, category) {
  return {
    id: `met:${o.objectID}`,
    source: 'met',
    sourceName: name,
    category,
    title: o.title || o.objectName || 'Untitled',
    creator: o.artistDisplayName || o.culture || '',
    date: o.objectDate || '',
    objectType: [o.objectName, o.classification].filter(Boolean).join(' '),
    tags: (o.tags ?? []).map((t) => t.term).filter(Boolean).slice(0, 6),
    license: o.isPublicDomain ? { code: 'cc0', name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' } : null,
    credit: [o.creditLine, 'The Metropolitan Museum of Art'].filter(Boolean).join(' · '),
    pageUrl: o.objectURL,
    image: { display: o.primaryImageSmall, full: o.primaryImage },
  };
}

// query: { departmentId } or { search, classification: /regex/ }
export async function fetchRecords(query, { want, accept, category, log, maxObjects = 1500 }) {
  let ids = [];
  if (query.departmentId) {
    const res = await getJson(`${BASE}/objects?departmentIds=${query.departmentId}`);
    ids = res.objectIDs ?? [];
  } else {
    const res = await getJson(`${BASE}/search?hasImages=true&q=${encodeURIComponent(query.search)}`);
    ids = res.objectIDs ?? [];
  }
  log(`met ${JSON.stringify(query)}: ${ids.length} ids`);
  const picked = [];
  const pool = seededShuffle(ids, 7).slice(0, maxObjects);
  for (let i = 0; i < pool.length && picked.length < want; i += 40) {
    const batch = await mapLimit(pool.slice(i, i + 40), 6, async (id) => {
      try {
        return await getJson(`${BASE}/objects/${id}`);
      } catch {
        return null;
      }
    });
    for (const o of batch) {
      if (!o || !o.isPublicDomain || !o.primaryImageSmall) continue;
      if (query.classification && !query.classification.test(`${o.classification} ${o.objectName}`)) continue;
      const r = toRecord(o, category);
      if (accept(r)) picked.push(r);
      if (picked.length >= want) break;
    }
  }
  return picked;
}
