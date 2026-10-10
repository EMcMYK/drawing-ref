// Polite JSON fetching: identifies the app, spaces out requests per host,
// and retries briefly on rate limits and server errors.

export const USER_AGENT =
  'drawing-ref-library-builder/0.1 (+https://github.com/EMcMYK/drawing-ref)';

const lastCall = new Map();
const MIN_GAP_MS = {
  'api.inaturalist.org': 1100,
  'commons.wikimedia.org': 250,
  'api.artic.edu': 1000,
  'collectionapi.metmuseum.org': 60,
  'images-api.nasa.gov': 250,
  'collections.museumsvictoria.com.au': 300,
  'openaccess-api.clevelandart.org': 300,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitTurn(host) {
  const gap = MIN_GAP_MS[host] ?? 250;
  const prev = lastCall.get(host) ?? 0;
  const wait = prev + gap - Date.now();
  lastCall.set(host, Math.max(Date.now(), prev + gap));
  if (wait > 0) await sleep(wait);
}

export async function getJson(url, { headers = {}, retries = 3 } = {}) {
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt++) {
    await waitTurn(host);
    let res;
    try {
      res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Api-User-Agent': USER_AGENT,
          'AIC-User-Agent': USER_AGENT,
          Accept: 'application/json',
          ...headers,
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (res.ok) return res.json();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    const after = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 1500 * 2 ** attempt);
  }
}

// Run `fn` over items with limited concurrency, keeping order.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// Deterministic shuffle, so the same run picks the same sample.
export function seededShuffle(list, seed = 1) {
  const a = [...list];
  let s = seed >>> 0 || 1;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
