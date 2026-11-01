// Drawing aids shown on top of a picture: a grid, grayscale and a mirror flip.
// Used on reference photos and on the 3D still-life view. Each place keeps
// its own settings, remembered in this browser.

export const GRID_SIZES = [0, 3, 4]; // 0 = no grid
const DEFAULTS = { grid: 0, gray: false, flip: false };

export function nextGrid(grid) {
  const i = GRID_SIZES.indexOf(grid);
  return GRID_SIZES[(i + 1) % GRID_SIZES.length];
}

export function normalize(state) {
  return {
    grid: GRID_SIZES.includes(state?.grid) ? state.grid : DEFAULTS.grid,
    gray: state?.gray === true,
    flip: state?.flip === true,
  };
}

// CSS for the picture itself. The grid is a separate layer (gridSvg).
export function pictureStyle({ gray, flip }) {
  return { filter: gray ? 'grayscale(1)' : '', transform: flip ? 'scaleX(-1)' : '' };
}

// Grid lines at every 1/n of the width and height, drawn twice (dark under
// light) so they show on both pale and dark pictures.
export function gridSvg(n) {
  if (!n) return '';
  const lines = [];
  for (let i = 1; i < n; i++) {
    const p = `${((i / n) * 100).toFixed(4)}%`;
    lines.push(`<line x1="${p}" y1="0" x2="${p}" y2="100%"/>`, `<line x1="0" y1="${p}" x2="100%" y2="${p}"/>`);
  }
  const set = lines.join('');
  return `<svg width="100%" height="100%" aria-hidden="true">
    <g stroke="rgba(0,0,0,0.35)" stroke-width="2.5">${set}</g>
    <g stroke="rgba(255,255,255,0.9)" stroke-width="1">${set}</g>
  </svg>`;
}

const storageKey = (scope) => `drawing-ref:overlays:${scope}:v1`;

export function loadOverlays(scope) {
  try {
    return normalize(JSON.parse(localStorage.getItem(storageKey(scope)) ?? '{}'));
  } catch {
    return normalize({});
  }
}

function saveOverlays(scope, state) {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(state));
  } catch {
    // Storage blocked: settings just reset on reload.
  }
}

// Three toggle buttons. `apply(state)` is called now and on every change.
export function mountOverlayToolbar(root, scope, apply) {
  let state = loadOverlays(scope);
  root.classList.add('overlay-tools');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Drawing aids');
  root.innerHTML = `
    <button type="button" data-o="grid" title="Grid (G)"></button>
    <button type="button" data-o="gray" title="Grayscale (B)">Grayscale</button>
    <button type="button" data-o="flip" title="Flip (F)">Flip</button>`;

  const render = () => {
    const grid = root.querySelector('[data-o="grid"]');
    grid.textContent = state.grid ? `Grid ${state.grid}×${state.grid}` : 'Grid';
    grid.setAttribute('aria-pressed', String(state.grid > 0));
    root.querySelector('[data-o="gray"]').setAttribute('aria-pressed', String(state.gray));
    root.querySelector('[data-o="flip"]').setAttribute('aria-pressed', String(state.flip));
    apply(state);
  };

  const toggle = (what) => {
    state = normalize({
      ...state,
      grid: what === 'grid' ? nextGrid(state.grid) : state.grid,
      gray: what === 'gray' ? !state.gray : state.gray,
      flip: what === 'flip' ? !state.flip : state.flip,
    });
    saveOverlays(scope, state);
    render();
  };

  root.addEventListener('click', (e) => {
    const what = e.target.closest('[data-o]')?.dataset.o;
    if (what) toggle(what);
  });
  render();
  return { toggle };
}

// Shortcut keys, ignored while typing in a field.
export const OVERLAY_KEYS = { g: 'grid', b: 'gray', f: 'flip' };
export function overlayKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.target.closest?.('input, select, textarea')) return null;
  return OVERLAY_KEYS[e.key.toLowerCase()] ?? null;
}
