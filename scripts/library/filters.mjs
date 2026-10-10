// Pure checks used when building the reference library index.

// Only these licenses are allowed: no NC or ND, so paid features later stay safe.
export const LICENSES = {
  cc0: { name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', creditRequired: false },
  pd: { name: 'Public domain', url: 'https://creativecommons.org/publicdomain/mark/1.0/', creditRequired: false },
  'cc-by': { name: 'CC BY', url: 'https://creativecommons.org/licenses/by/4.0/', creditRequired: true },
  'cc-by-sa': { name: 'CC BY-SA', url: 'https://creativecommons.org/licenses/by-sa/4.0/', creditRequired: true },
};

// Turn a source's license label into one of the allowed codes, or null.
// Version numbers are kept in the display name ("CC BY-SA 3.0").
export function normalizeLicense(label, url = '') {
  const text = `${label ?? ''} ${url ?? ''}`.toLowerCase();
  if (!text.trim()) return null;
  if (/\bnc\b|non-?commercial|\bnd\b|no-?deriv/.test(text)) return null;
  if (/gfdl|all rights reserved|copyright(?!.*cc)/.test(text) && !/cc[ -]?by|cc0|public ?domain/.test(text)) return null;
  const version = (text.match(/(\d\.\d)/) ?? [])[1];
  const named = (code) => ({
    code,
    name: version && code.startsWith('cc-') ? `${LICENSES[code].name} ${version}` : LICENSES[code].name,
    url: url && /^https?:/.test(url) ? url : LICENSES[code].url,
  });
  if (/cc0|publicdomain\/zero|cc-zero/.test(text)) return named('cc0');
  if (/by[- ]?sa|by-sa/.test(text)) return named('cc-by-sa');
  if (/cc[- ]?by|licenses\/by\//.test(text)) return named('cc-by');
  if (/public ?domain|publicdomain\/mark|\bpd\b|no known copyright/.test(text)) return named('pd');
  return null;
}

// Things that aren't real subjects: documents, scans, flat art, and so on.
const BLOCKED_WORDS = [
  'document', 'manuscript', 'letter', 'map', 'certificate', 'label', 'page', 'book', 'scan',
  'newspaper', 'poster', 'postcard', 'stamp', 'coin', 'drawing', 'painting', 'print', 'etching',
  'engraving', 'lithograph', 'woodcut', 'photograph of', 'negative', 'chart', 'diagram', 'text',
  'textile fragment', 'specimen label', 'herbarium sheet', 'card', 'ticket', 'menu', 'leaflet',
];

// Identifiable people raise model-release questions; drawing references don't need them.
const PEOPLE_WORDS = [
  'portrait', 'headshot', 'astronaut', 'crew', 'ceremony', 'meeting', 'briefing', 'conference',
  'press', 'award', 'visit', 'employees', 'staff', 'team photo', 'group photo', 'selfie',
];

function wordMatch(text, words) {
  const t = ` ${text.toLowerCase()} `;
  return words.find((w) => new RegExp(`\\b${w.replace(/ /g, '\\s+')}s?\\b`).test(t)) ?? null;
}

// Returns null when the record is fine, or a short reason it was rejected.
export function rejectReason(record, { blockPeople = false } = {}) {
  if (!record.license) return 'license';
  if (!record.image?.display) return 'no-image';
  const text = [record.title, record.objectType, ...(record.tags ?? [])].filter(Boolean).join(' ');
  const blocked = wordMatch(text, BLOCKED_WORDS);
  if (blocked) return `blocked:${blocked}`;
  if (blockPeople) {
    const people = wordMatch(text, PEOPLE_WORDS);
    if (people) return `people:${people}`;
  }
  const { width, height } = record.image;
  if (width && height) {
    if (Math.min(width, height) < 500) return 'too-small';
    const ratio = width / height;
    if (ratio < 0.5 || ratio > 2) return 'aspect';
  }
  return null;
}

// Mix sources evenly, drop duplicates (same source object, or same image
// URL), and cap the total.
export function mixAndCap(lists, cap) {
  const seen = new Set();
  const out = [];
  const queues = lists.map((l) => [...l]);
  while (out.length < cap && queues.some((q) => q.length)) {
    for (const q of queues) {
      const r = q.shift();
      if (!r) continue;
      const keys = [r.id, r.image.display];
      if (keys.some((k) => seen.has(k))) continue;
      keys.forEach((k) => seen.add(k));
      out.push(r);
      if (out.length >= cap) break;
    }
  }
  return out;
}

export function stripHtml(html) {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// Tag sculpture of hands so they can be found as "hands".
export function autoTags(record) {
  const tags = new Set(record.tags ?? []);
  if (/\bhands?\b/i.test(record.title ?? '')) tags.add('hands');
  return [...tags];
}
