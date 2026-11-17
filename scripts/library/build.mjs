// Builds the reference library index: one JSON file per category plus an
// index.json, written to public/library/. Run with:
//   node scripts/library/build.mjs [--only animals,plants] [--scale 0.1] [--refresh 0.1]
// --refresh keeps the current images and adds new ones: each source looks
// for that share of its usual count in images the library doesn't have yet.
// Past the per-category cap the oldest images make room. If a source fails,
// the images already there stay.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { CATEGORIES, CAP_PER_CATEGORY, MIN_PER_CATEGORY } from './categories.mjs';
import { autoTags, mergeRefresh, mixAndCap, rejectReason } from './filters.mjs';
import * as aic from './sources/aic.mjs';
import * as cleveland from './sources/cleveland.mjs';
import * as inat from './sources/inat.mjs';
import * as met from './sources/met.mjs';
import * as museumsVictoria from './sources/museums-victoria.mjs';
import * as nasa from './sources/nasa.mjs';
import * as wikimedia from './sources/wikimedia.mjs';

const SOURCES = { aic, cleveland, inat, met, 'museums-victoria': museumsVictoria, nasa, wikimedia };

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), [])
);
const only = args.only ? new Set(args.only.split(',')) : null;
const scale = Number(args.scale ?? 1);
const outDir = args.out ?? 'public/library';
const refresh = args.refresh ? Number(args.refresh) : 0;
const today = new Date().toISOString().slice(0, 10);

async function readExisting(id) {
  try {
    const data = JSON.parse(await readFile(`${outDir}/${id}.json`, 'utf8'));
    return Array.isArray(data.images) ? data.images : [];
  } catch {
    return [];
  }
}

const log = (...m) => console.log(...m);

async function buildCategory(cat, existing = []) {
  const known = new Set(existing.map((r) => r.id));
  const lists = [];
  const rejected = {};
  const perSource = {};
  for (const [sourceId, query, want] of cat.sources) {
    const source = SOURCES[sourceId];
    const accept = (r, opts) => {
      const reason = known.has(r.id) ? 'already-in-library' : rejectReason(r, opts);
      if (reason) {
        const key = reason.split(':')[0];
        rejected[key] = (rejected[key] ?? 0) + 1;
        return false;
      }
      return true;
    };
    try {
      const records = await source.fetchRecords(query, {
        want: Math.max(1, Math.round(want * scale * (refresh || 1))),
        accept,
        refresh: refresh > 0,
        category: cat.id,
        log,
      });
      lists.push(records);
      perSource[source.name] = (perSource[source.name] ?? 0) + records.length;
    } catch (err) {
      log(`  ! ${sourceId} ${JSON.stringify(query)} failed: ${err.message}`);
      perSource[source.name] = perSource[source.name] ?? 0;
    }
  }
  const cap = Math.round(CAP_PER_CATEGORY * scale);
  const fresh = mixAndCap(lists, cap).map((r) => ({
    id: r.id,
    source: r.source,
    sourceName: r.sourceName,
    title: r.title,
    creator: r.creator || undefined,
    date: r.date || undefined,
    tags: autoTags(r),
    license: r.license,
    credit: r.credit,
    pageUrl: r.pageUrl,
    image: r.image,
    fetched: today,
  }));
  if (!refresh) return { images: fresh, perSource, rejected, added: fresh.length, dropped: 0 };
  return { ...mergeRefresh(existing, fresh, cap), perSource, rejected };
}

await mkdir(outDir, { recursive: true });
const summary = [];
for (const cat of CATEGORIES) {
  if (only && !only.has(cat.id)) continue;
  log(`\n== ${cat.label} ==`);
  const existing = refresh ? await readExisting(cat.id) : [];
  const { images, perSource, rejected, added, dropped } = await buildCategory(cat, existing);
  // A refresh that found nothing new leaves the file alone (no empty commit).
  if (!refresh || added > 0) {
    await writeFile(`${outDir}/${cat.id}.json`, JSON.stringify({ category: cat.id, label: cat.label, generated: today, images }));
  }
  summary.push({ id: cat.id, label: cat.label, count: images.length, perSource, rejected, added, dropped });
  log(`-> ${images.length} images (${added} new, ${dropped} dropped)`, perSource, 'rejected:', rejected);
}

// With --only, the other categories keep their entries in index.json.
let previous = [];
let previousDate = today;
try {
  const prev = JSON.parse(await readFile(`${outDir}/index.json`, 'utf8'));
  previous = prev.categories ?? [];
  previousDate = prev.generated ?? today;
} catch {
  // No index yet.
}
const counts = new Map(previous.map((c) => [c.id, c.count]));
summary.forEach((s) => counts.set(s.id, s.count));
await writeFile(
  `${outDir}/index.json`,
  JSON.stringify(
    {
      generated: refresh && !summary.some((s) => s.added > 0) ? previousDate : today,
      categories: CATEGORIES.filter((c) => counts.has(c.id)).map(({ id, label }) => ({ id, label, count: counts.get(id) })),
    },
    null,
    2
  )
);

// A markdown table for the GitHub Actions job summary.
const lines = [
  '| Category | Images | New | Dropped | New by source | Rejected |',
  '|---|---|---|---|---|---|',
  ...summary.map(
    (s) =>
      `| ${s.label} | ${s.count}${s.count < MIN_PER_CATEGORY * scale ? ' ⚠️' : ''} | ${s.added} | ${s.dropped} | ${Object.entries(s.perSource).map(([k, v]) => `${k}: ${v}`).join(', ')} | ${Object.entries(s.rejected).map(([k, v]) => `${k}: ${v}`).join(', ') || '–'} |`
  ),
];
await writeFile('library-summary.md', lines.join('\n') + '\n');
log('\n' + lines.join('\n'));
