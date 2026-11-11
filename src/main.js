import './styles/app.css';
import { StillLife } from './still-life/still-life.js';
import { buildPanel } from './still-life/panel.js';
import { loadSaved, saveSoon } from './still-life/persist.js';
import { STARTER_SCENES } from './still-life/model.js';
import { isLibraryShape, prepareObjects } from './still-life/objects.js';
import { mountReferences } from './references/references.js';
import { gridSvg, mountOverlayToolbar, overlayKey, pictureStyle } from './overlays/overlays.js';

const startReferences = mountReferences(document.getElementById('mode-references'));

// Tabs: the 3D still life and the reference library.
const tabs = document.querySelectorAll('[role="tab"]');
tabs.forEach((tab) =>
  tab.addEventListener('click', () => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (tab.id === 'tab-references') startReferences();
  })
);

let panel = { refresh() {}, refreshView() {} };
const stillLife = new StillLife(document.getElementById('viewport'), {
  onChange: (s) => {
    panel.refresh();
    saveSoon(s.toJSON());
  },
  onView: () => panel.refreshView(),
});
panel = buildPanel(document.getElementById('panel'), stillLife);
const { refresh } = panel;

// Drawing aids over the 3D view. Flip mirrors the screen only.
const viewport = document.getElementById('viewport');
const grid3d = Object.assign(document.createElement('div'), { className: 'grid-layer' });
const tools3d = document.createElement('div');
viewport.append(grid3d, tools3d);
const aids3d = mountOverlayToolbar(tools3d, 'still-life', (state) => {
  grid3d.innerHTML = gridSvg(state.grid);
  stillLife.renderer.domElement.style.filter = pictureStyle(state).filter;
  stillLife.setMirrored(state.flip);
});
window.addEventListener('keydown', (e) => {
  const what = !document.getElementById('mode-still-life').hidden && overlayKey(e);
  if (!what) return;
  aids3d.toggle(what);
  e.preventDefault();
});

// A saved scene can hold library objects, whose models load first; any that
// fail to load (removed from the library, offline) are left out.
const saved = loadSaved();
if (saved && saved.objects.length) {
  const hasLibrary = saved.objects.some((o) => isLibraryShape(o.shape));
  stillLife.loadScene({ ...saved, objects: saved.objects.filter((o) => !isLibraryShape(o.shape)) });
  if (hasLibrary) {
    prepareObjects(saved.objects).then((objects) => {
      stillLife.loadScene({ ...saved, objects });
      refresh();
    });
  }
} else stillLife.loadScene({ objects: STARTER_SCENES.pair.build() });
refresh();

// Handy for debugging and browser tests.
window.__stillLife = stillLife;
