// Loading and filtering the reference library index (built by
// scripts/library/build.mjs into public/library/).

const BROKEN_KEY = 'drawing-ref:broken-images:v2';
const NO_CREDIT = new Set(['cc0', 'pd']);

export async function loadIndex(base = import.meta.env?.BASE_URL ?? '/') {
  try {
    const res = await fetch(`${base}library/index.json`);
    if (!res.ok) return null;
    const index = await res.json();
    return Array.isArray(index.categories) ? index : null;
  } catch {
    return null;
  }
}

const categoryCache = new Map();
export async function loadCategory(id, base = import.meta.env?.BASE_URL ?? '/') {
  if (!categoryCache.has(id)) {
    categoryCache.set(
      id,
      fetch(`${base}library/${id}.json`)
        .then((r) => (r.ok ? r.json() : { images: [] }))
        .then((d) => (Array.isArray(d.images) ? d.images : []))
        .catch(() => {
          categoryCache.delete(id);
          return [];
        })
    );
  }
  return categoryCache.get(id);
}

export function needsCredit(image) {
  return !NO_CREDIT.has(image.license?.code);
}

// license: 'all' | 'no-credit'
export function filterImages(images, { query = '', license = 'all', broken = new Map() } = {}) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return images.filter((img) => {
    if (broken.has(img.id)) return false;
    if (license === 'no-credit' && needsCredit(img)) return false;
    if (!words.length) return true;
    const hay = [img.title, img.creator, img.sourceName, ...(img.tags ?? [])].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function pickRandom(list, avoidId, rand = Math.random) {
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  let pick;
  do pick = list[Math.floor(rand() * list.length)];
  while (pick.id === avoidId);
  return pick;
}

// A one-line credit, e.g. "Armor · Unknown · The Met · CC0 1.0".
export function creditLine(img) {
  return [img.title, img.creator, img.sourceName, img.license?.name].filter(Boolean).join(' · ');
}

// Images whose links have broken are remembered in this browser only, for
// 30 days, so a source that comes back gets another chance.
const BROKEN_DAYS = 30;

export function loadBroken(now = Date.now()) {
  try {
    const saved = JSON.parse(localStorage.getItem(BROKEN_KEY) ?? '{}');
    const cutoff = now - BROKEN_DAYS * 86_400_000;
    return new Map(Object.entries(saved).filter(([, t]) => t > cutoff));
  } catch {
    return new Map();
  }
}

export function saveBroken(map) {
  try {
    const recent = [...map].sort((a, b) => b[1] - a[1]).slice(0, 2000);
    localStorage.setItem(BROKEN_KEY, JSON.stringify(Object.fromEntries(recent)));
  } catch {
    // Storage blocked: broken images just reappear after a reload.
  }
}
