// Re-cleans the library JSON already in public/library/ without fetching
// anything: tidies Wikimedia creators, credits and dates with the same rules
// the build uses, and drops images that appear in more than one category.
//   node scripts/library/clean.mjs [--dir public/library]
import { readFile, writeFile } from 'node:fs/promises';
import { cleanCreator, cleanDate, wikimediaCredit } from './filters.mjs';

const args = process.argv.slice(2);
const dir = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'public/library';

// Dates in older builds were cut to 10 characters ("Taken on 1",
// "circa 300 " that was "circa 300 BC"), so a 10-character date is only kept
// when it is clearly whole.
export function repairStoredDate(date) {
  if (!date) return '';
  if (date.length < 10) return cleanDate(date);
  if (/^\d{4}-\d\d-\d\d$/.test(date)) return date;
  // "circa 1700" is whole; "circa 1070" may have been "circa 1070 BC".
  const circa = date.match(/^circa (\d{4})$/);
  if (circa && circa[1] >= 1400 && circa[1] <= new Date().getFullYear()) return date;
  const year = date.match(/^(\d{4}) date ?$/);
  return year ? year[1] : '';
}

const index = JSON.parse(await readFile(`${dir}/index.json`, 'utf8'));
const seen = new Set();
const stats = { creators: 0, dates: 0, duplicates: 0 };
for (const cat of index.categories) {
  const file = `${dir}/${cat.id}.json`;
  const data = JSON.parse(await readFile(file, 'utf8'));
  data.images = data.images.filter((img) => {
    const keys = [img.id, img.image?.full ?? img.image?.display];
    if (keys.some((k) => k && seen.has(k))) {
      stats.duplicates++;
      return false;
    }
    keys.forEach((k) => k && seen.add(k));
    return true;
  });
  for (const img of data.images) {
    if (img.source !== 'wmc') continue;
    const creator = cleanCreator(img.creator, { title: img.title });
    const date = repairStoredDate(img.date);
    if (creator !== (img.creator ?? '')) stats.creators++;
    if (date !== (img.date ?? '')) stats.dates++;
    img.creator = creator || undefined;
    img.date = date || undefined;
    img.credit = wikimediaCredit(creator);
  }
  cat.count = data.images.length;
  await writeFile(file, JSON.stringify(data));
}
await writeFile(`${dir}/index.json`, JSON.stringify(index, null, 2));
console.log(stats);
