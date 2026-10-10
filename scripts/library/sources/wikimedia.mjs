// Wikimedia Commons API (no key). Files from hand-picked categories only (no
// live search proxying). License and author read per file from extmetadata.
import { getJson } from '../http.mjs';
import { normalizeLicense, stripHtml } from '../filters.mjs';

const BASE = 'https://commons.wikimedia.org/w/api.php';

export const name = 'Wikimedia Commons';

function toRecord(page, category) {
  const info = page.imageinfo?.[0];
  if (!info) return null;
  const meta = info.extmetadata ?? {};
  const v = (k) => meta[k]?.value ?? '';
  const license = normalizeLicense(v('LicenseShortName'), v('LicenseUrl'));
  const title = stripHtml(v('ObjectName')) || page.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '');
  const artist = stripHtml(v('Artist'));
  return {
    id: `wmc:${page.pageid}`,
    source: 'wmc',
    sourceName: name,
    category,
    title,
    creator: artist,
    date: stripHtml(v('DateTimeOriginal')).slice(0, 10),
    objectType: '',
    tags: [],
    license,
    credit: [artist, 'Wikimedia Commons'].filter(Boolean).join(' · '),
    pageUrl: info.descriptionurl,
    image: {
      display: info.thumburl,
      full: info.url,
      width: info.thumbwidth,
      height: info.thumbheight,
    },
  };
}

// query: { categories: ['Category:...'] } or { search: ['violin', ...] }.
// A search only looks inside Commons' "Quality images", photos the community
// has reviewed for sharpness and lighting.
export async function fetchRecords(query, { want, accept, category, log, maxPages = 6 }) {
  const picked = [];
  const seenIds = new Set();
  const lists = query.search
    ? query.search.map((q) => ({ label: `search "${q}"`, gen: { generator: 'search', gsrnamespace: '6', gsrlimit: '50', gsrsearch: `incategory:Quality_images filetype:bitmap ${q}` } }))
    : query.categories.map((cat) => ({ label: cat, gen: { generator: 'categorymembers', gcmtitle: cat, gcmtype: 'file', gcmlimit: '50' } }));
  const perList = Math.ceil(want / lists.length);
  for (const { label, gen } of lists) {
    const start = picked.length;
    let cont = {};
    let seen = 0;
    for (let page = 0; page < maxPages && picked.length < want && picked.length - start < perList * 2; page++) {
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        formatversion: '2',
        ...gen,
        prop: 'imageinfo',
        iiprop: 'url|size|extmetadata',
        iiurlwidth: '1024',
        iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|ObjectName|DateTimeOriginal',
        ...cont,
      });
      const res = await getJson(`${BASE}?${params}`);
      const pages = res.query?.pages ?? [];
      seen += pages.length;
      for (const p of pages) {
        if (seenIds.has(p.pageid)) continue;
        seenIds.add(p.pageid);
        const r = toRecord(p, category);
        if (r && accept(r)) picked.push(r);
        if (picked.length >= want) break;
      }
      if (!res.continue) break;
      cont = { ...res.continue };
    }
    log(`wikimedia ${label}: ${seen} files seen, ${picked.length - start} kept`);
    if (picked.length >= want) break;
  }
  return picked;
}
