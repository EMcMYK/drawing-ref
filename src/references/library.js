// Loading and filtering the reference library index (built by
// scripts/library/build.mjs into public/library/).

const BROKEN_KEY = 'drawing-ref:broken-images:v3';
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

// The "by" part of the viewer credit: creator and date, leaving out the
// creator when the stored credit already names them.
export function byLine(img) {
  const creator = img.creator && !String(img.credit ?? '').includes(img.creator) ? img.creator : '';
  return [creator, img.date].filter(Boolean).join(', ');
}

// A one-line credit, e.g. "Armor · Unknown · The Met · CC0 1.0".
export function creditLine(img) {
  return [img.title, img.creator, img.sourceName, img.license?.name].filter(Boolean).join(' · ');
}

// A failed image load is often not the image's fault: an ad blocker, a
// flaky connection or a source that is down for an hour. So an image is only
// hidden in later visits after it has failed on BROKEN.strikes separate
// visits at least BROKEN.gapHours apart, and only for BROKEN.days. When many
// images from one source fail in the same visit, that looks like a blocker or
// an outage, so nothing from that source is remembered for that visit.
export const BROKEN = { strikes: 3, gapHours: 6, days: 14, outageFails: 4, outageRate: 0.3, max: 2000 };
const OLD_BROKEN_KEYS = ['drawing-ref:broken-images', 'drawing-ref:broken-images:v1', 'drawing-ref:broken-images:v2'];

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createBrokenTracker({
  storage = browserStorage(),
  now = Date.now,
  online = () => globalThis.navigator?.onLine !== false,
} = {}) {
  const HOUR = 3_600_000;
  let saved = {};
  try {
    for (const k of OLD_BROKEN_KEYS) storage?.removeItem(k);
    saved = JSON.parse(storage?.getItem(BROKEN_KEY) ?? '{}') ?? {};
  } catch {
    saved = {};
  }
  // saved[id] = [strikes, lastStrikeTime]; old records drop off.
  const cutoff = now() - BROKEN.days * 24 * HOUR;
  for (const [id, rec] of Object.entries(saved)) {
    if (!Array.isArray(rec) || !(rec[1] > cutoff)) delete saved[id];
  }

  const failedNow = new Set(); // failed during this visit: hidden until reload
  const struck = new Map(); // id -> { source, before } for strikes made this visit
  const counts = new Map(); // source -> { ok, fail } this visit
  const down = new Set(); // sources that look blocked or down this visit

  const save = () => {
    try {
      const keep = Object.entries(saved)
        .sort((a, b) => b[1][1] - a[1][1])
        .slice(0, BROKEN.max);
      storage?.setItem(BROKEN_KEY, JSON.stringify(Object.fromEntries(keep)));
    } catch {
      // Storage blocked: nothing is remembered, which is fine.
    }
  };
  const tally = (source) => {
    if (!counts.has(source)) counts.set(source, { ok: 0, fail: 0 });
    return counts.get(source);
  };

  return {
    // Whether to leave an image out of the grid.
    has(id) {
      if (failedNow.has(id)) return true;
      const rec = saved[id];
      return !!rec && rec[0] >= BROKEN.strikes;
    },
    ok(img) {
      tally(img.source).ok++;
    },
    // Returns true when this looks like a blocker or outage for the source.
    fail(img) {
      failedNow.add(img.id);
      const c = tally(img.source);
      c.fail++;
      if (!down.has(img.source) && c.fail >= BROKEN.outageFails && c.fail / (c.ok + c.fail) >= BROKEN.outageRate) {
        down.add(img.source);
        // Take back this visit's strikes for that source.
        for (const [id, s] of struck) {
          if (s.source !== img.source) continue;
          if (s.before) saved[id] = s.before;
          else delete saved[id];
          struck.delete(id);
        }
        save();
      }
      if (down.has(img.source)) return true;
      if (!online() || struck.has(img.id)) return false;
      const rec = saved[img.id];
      if (rec && now() - rec[1] < BROKEN.gapHours * HOUR) return false;
      struck.set(img.id, { source: img.source, before: rec });
      saved[img.id] = [(rec?.[0] ?? 0) + 1, now()];
      save();
      return false;
    },
    get anyDown() {
      return down.size > 0;
    },
  };
}
