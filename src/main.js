import './styles/app.css';
import { StillLife } from './still-life/still-life.js';
import { buildPanel } from './still-life/panel.js';
import { loadSaved, saveSoon } from './still-life/persist.js';
import { STARTER_SCENES } from './still-life/model.js';

// Tabs: the 3D still life is live; the reference library comes next.
const tabs = document.querySelectorAll('[role="tab"]');
tabs.forEach((tab) =>
  tab.addEventListener('click', () => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
  })
);

let refresh = () => {};
const stillLife = new StillLife(document.getElementById('viewport'), {
  onChange: (s) => {
    refresh();
    saveSoon(s.toJSON());
  },
});
refresh = buildPanel(document.getElementById('panel'), stillLife);

const saved = loadSaved();
if (saved && saved.objects.length) stillLife.loadScene(saved);
else stillLife.loadScene({ objects: STARTER_SCENES.pair.build() });
refresh();

// Handy for debugging and browser tests.
window.__stillLife = stillLife;
