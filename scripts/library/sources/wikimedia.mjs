// Wikimedia Commons API (no key). Files from hand-picked categories only (no
// live search proxying). License and author read per file from extmetadata.
import { getJson, seededShuffle } from '../http.mjs';
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

// Museum objects listed on Wikidata as a kind of `wikidata` (e.g. Q34379,
// musical instrument) that belong to a collection and have a photo.
async function wikidataFiles(classId, limit) {
  const sparql = `SELECT DISTINCT ?img WHERE {
    ?item wdt:P31/wdt:P279* wd:${classId}; wdt:P195 ?collection; wdt:P18 ?img.
  } LIMIT ${limit}`;
  const res = await getJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`, {
    headers: { Accept: 'application/sparql-results+json' },
  });
  return (res.results?.bindings ?? []).map((b) => `File:${decodeURIComponent(b.img.value.split('/').pop()).replace(/_/g, ' ')}`);
}

// query: { categories: ['Category:...'] } or { wikidata: 'Q...' }
export async function fetchRecords(query, { want, accept, category, log, maxPages = 6 }) {
  const picked = [];
  const seenIds = new Set();
  const take = (pages) => {
    for (const p of pages) {
      if (picked.length >= want) return;
      if (seenIds.has(p.pageid)) continue;
      seenIds.add(p.pageid);
      const r = toRecord(p, category);
      if (r && accept(r)) picked.push(r);
    }
  };
  const info = {
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '1024',
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|ObjectName|DateTimeOriginal',
  };

  if (query.wikidata) {
    const titles = seededShuffle(await wikidataFiles(query.wikidata, want * 4), 3);
    log(`wikidata ${query.wikidata}: ${titles.length} files`);
    for (let i = 0; i < titles.length && picked.length < want; i += 50) {
      const params = new URLSearchParams({ ...info, titles: titles.slice(i, i + 50).join('|') });
      const res = await getJson(`${BASE}?${params}`);
      take(res.query?.pages ?? []);
    }
    return picked;
  }

  for (const cat of query.categories) {
    let cont = {};
    let seen = 0;
    for (let page = 0; page < maxPages && picked.length < want; page++) {
      const params = new URLSearchParams({
        ...info,
        generator: 'categorymembers',
        gcmtitle: cat,
        gcmtype: 'file',
        gcmlimit: '50',
        ...cont,
      });
      const res = await getJson(`${BASE}?${params}`);
      const pages = res.query?.pages ?? [];
      seen += pages.length;
      take(pages);
      if (!res.continue) break;
      cont = { ...res.continue };
    }
    log(`wikimedia ${cat}: ${seen} files seen`);
    if (picked.length >= want) break;
  }
  return picked;
}
