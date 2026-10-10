import { sanitizeScene } from './model.js';

const KEY = 'drawing-ref:still-life:v1';

// Browser storage can be missing or blocked (private windows, previews), so
// every access is guarded and the app works without it.
export function loadSaved() {
  try {
    const text = window.localStorage.getItem(KEY);
    return text ? sanitizeScene(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

let timer = null;
export function saveSoon(data) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      // Storage full or blocked: the scene just won't survive a reload.
    }
  }, 300);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pngFilename(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `still-life-${date}-${pad(now.getHours())}${pad(now.getMinutes())}.png`;
}
