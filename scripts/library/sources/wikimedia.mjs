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

// query: { categories: ['Category:...'] }
export async function fetchRecords(query, { want, accept, category, log, maxPages = 6 }) {
  const picked = [];
  for (const cat of query.categories) {
    let cont = {};
    let seen = 0;
    for (let page = 0; page < maxPages && picked.length < want; page++) {
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        formatversion: '2',
        generator: 'categorymembers',
        gcmtitle: cat,
        gcmtype: 'file',
        gcmlimit: '50',
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
        const r = toRecord(p, category);
        if (r && accept(r)) picked.push(r);
        if (picked.length >= want) break;
      }
      if (!res.continue) break;
      cont = { gcmcontinue: res.continue.gcmcontinue, continue: res.continue.continue };
    }
    log(`wikimedia ${cat}: ${seen} files seen`);
    if (picked.length >= want) break;
  }
  return picked;
}
