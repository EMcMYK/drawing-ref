// Builds the reference library index: one JSON file per category plus an
// index.json, written to public/library/. Run with:
//   node scripts/library/build.mjs [--only animals,plants] [--scale 0.1]
import { mkdir, writeFile } from 'node:fs/promises';
import { CATEGORIES, CAP_PER_CATEGORY, MIN_PER_CATEGORY } from './categories.mjs';
import { autoTags, mixAndCap, rejectReason } from './filters.mjs';
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
const today = new Date().toISOString().slice(0, 10);

const log = (...m) => console.log(...m);

async function buildCategory(cat) {
  const lists = [];
  const rejected = {};
  const perSource = {};
  for (const [sourceId, query, want] of cat.sources) {
    const source = SOURCES[sourceId];
    const accept = (r, opts) => {
      const reason = rejectReason(r, opts);
      if (reason) {
        const key = reason.split(':')[0];
        rejected[key] = (rejected[key] ?? 0) + 1;
        return false;
      }
      return true;
    };
    try {
      const records = await source.fetchRecords(query, {
        want: Math.max(1, Math.round(want * scale)),
        accept,
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
  const images = mixAndCap(lists, Math.round(CAP_PER_CATEGORY * scale)).map((r) => ({
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
  return { images, perSource, rejected };
}

await mkdir(outDir, { recursive: true });
const summary = [];
for (const cat of CATEGORIES) {
  if (only && !only.has(cat.id)) continue;
  log(`\n== ${cat.label} ==`);
  const { images, perSource, rejected } = await buildCategory(cat);
  await writeFile(`${outDir}/${cat.id}.json`, JSON.stringify({ category: cat.id, label: cat.label, generated: today, images }));
  summary.push({ id: cat.id, label: cat.label, count: images.length, perSource, rejected });
  log(`-> ${images.length} images`, perSource, 'rejected:', rejected);
}

await writeFile(
  `${outDir}/index.json`,
  JSON.stringify(
    { generated: today, categories: summary.map(({ id, label, count }) => ({ id, label, count })) },
    null,
    2
  )
);

// A markdown table for the GitHub Actions job summary.
const lines = [
  '| Category | Images | By source | Rejected |',
  '|---|---|---|---|',
  ...summary.map(
    (s) =>
      `| ${s.label} | ${s.count}${s.count < MIN_PER_CATEGORY * scale ? ' ⚠️' : ''} | ${Object.entries(s.perSource).map(([k, v]) => `${k}: ${v}`).join(', ')} | ${Object.entries(s.rejected).map(([k, v]) => `${k}: ${v}`).join(', ') || '–'} |`
  ),
];
await writeFile('library-summary.md', lines.join('\n') + '\n');
log('\n' + lines.join('\n'));
