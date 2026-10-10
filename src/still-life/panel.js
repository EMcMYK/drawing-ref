// The control panel beside (or below, on phones) the 3D view.
import { CAMERA_PRESETS, LIGHT_PRESETS, LIMITS, STARTER_SCENES } from './model.js';
import { SHADES, SHAPES } from './shapes.js';
import { downloadBlob, pngFilename } from './persist.js';

const html = String.raw;

function slider(name, label, [min, max], step) {
  return html`<label class="field">
    <span>${label} <output data-out="${name}"></output></span>
    <input type="range" name="${name}" min="${min}" max="${max}" step="${step}" />
  </label>`;
}

export function buildPanel(root, stillLife) {
  root.innerHTML = html`
    <section class="group">
      <h2>Add a shape</h2>
      <div class="tray">
        ${SHAPES.map((s) => html`<button type="button" data-add="${s.id}">${s.label}</button>`).join('')}
      </div>
      <p class="hint" data-count></p>
    </section>

    <section class="group" data-selected hidden>
      <h2>Selected shape</h2>
      <div class="row">
        <button type="button" data-act="rotL" title="Rotate left (Q)">⟲ Rotate</button>
        <button type="button" data-act="rotR" title="Rotate right (E)">Rotate ⟳</button>
        <button type="button" data-act="tip">Tip over</button>
      </div>
      ${slider('size', 'Size', LIMITS.size, 0.05)}
      ${slider('height', 'Height', LIMITS.height, 0.05)}
      <div class="field">
        <span>Shade</span>
        <div class="swatches">
          ${SHADES.map(
            (s) => html`<button type="button" class="swatch" data-shade="${s.id}" title="${s.label}"
              aria-label="${s.label}" style="--swatch:#${s.color.toString(16).padStart(6, '0')}"></button>`
          ).join('')}
        </div>
      </div>
      <div class="row">
        <button type="button" data-act="dup">Duplicate</button>
        <button type="button" data-act="del" class="danger">Delete</button>
      </div>
    </section>

    <section class="group">
      <h2>Light</h2>
      <p class="hint">Drag the yellow ball in the scene, or use the sliders.</p>
      <div class="row wrap">
        ${Object.entries(LIGHT_PRESETS)
          .map(([k, p]) => html`<button type="button" data-light="${k}">${p.label}</button>`)
          .join('')}
      </div>
      ${slider('azimuth', 'Direction', [-180, 180], 1)}
      ${slider('elevation', 'Height', LIMITS.elevation, 1)}
      ${slider('intensity', 'Brightness', LIMITS.intensity, 0.05)}
    </section>

    <section class="group">
      <h2>View</h2>
      <div class="row wrap">
        ${Object.entries(CAMERA_PRESETS)
          .map(([k, p]) => html`<button type="button" data-cam="${k}">${p.label}</button>`)
          .join('')}
      </div>
    </section>

    <section class="group">
      <h2>Quick start</h2>
      <div class="row wrap">
        <button type="button" data-act="random">Random set-up</button>
        ${Object.entries(STARTER_SCENES)
          .map(([k, s]) => html`<button type="button" data-starter="${k}">${s.label}</button>`)
          .join('')}
      </div>
    </section>

    <section class="group">
      <button type="button" class="primary" data-act="png">Save PNG</button>
      <p class="hint">Saves exactly what you see, at high resolution. Nothing is uploaded.</p>
    </section>
  `;

  const q = (sel) => root.querySelector(sel);
  const input = (name) => q(`input[name="${name}"]`);
  const out = (name) => q(`[data-out="${name}"]`);

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const { add, act, shade, light, cam, starter } = btn.dataset;
    if (add) stillLife.addShape(add);
    else if (shade) stillLife.updateSelected({ shade });
    else if (light) stillLife.applyLightPreset(light);
    else if (cam) stillLife.setCameraPreset(cam);
    else if (starter) stillLife.loadScene({ objects: STARTER_SCENES[starter].build() });
    else if (act === 'rotL') stillLife.rotateSelected(-15);
    else if (act === 'rotR') stillLife.rotateSelected(15);
    else if (act === 'tip') stillLife.tipSelected();
    else if (act === 'dup') stillLife.duplicateSelected();
    else if (act === 'del') stillLife.deleteSelected();
    else if (act === 'random') stillLife.randomize();
    else if (act === 'png') {
      btn.disabled = true;
      try {
        const blob = await stillLife.toPng();
        if (blob) downloadBlob(blob, pngFilename());
      } finally {
        btn.disabled = false;
      }
    }
  });

  root.addEventListener('input', (e) => {
    const { name, value } = e.target;
    const v = Number(value);
    if (name === 'size' || name === 'height') stillLife.updateSelected({ [name]: v });
    else if (['azimuth', 'elevation', 'intensity'].includes(name)) stillLife.setLight({ [name]: v });
  });

  // Keep the panel in step with the scene.
  return function refresh() {
    const sel = stillLife.selected;
    q('[data-selected]').hidden = !sel;
    if (sel) {
      for (const name of ['size', 'height']) {
        input(name).value = sel[name];
        out(name).textContent = `${sel[name].toFixed(2)}×`;
      }
      root.querySelectorAll('[data-shade]').forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.shade === sel.shade))
      );
    }
    const { azimuth, elevation, intensity } = stillLife.light;
    input('azimuth').value = azimuth;
    out('azimuth').textContent = `${Math.round(azimuth)}°`;
    input('elevation').value = elevation;
    out('elevation').textContent = `${Math.round(elevation)}°`;
    input('intensity').value = intensity;
    out('intensity').textContent = intensity.toFixed(2);
    const n = stillLife.objects.length;
    q('[data-count]').textContent = `${n} of ${LIMITS.maxObjects} shapes. Click a shape to select it; drag to move or stack.`;
    root.querySelectorAll('[data-add]').forEach((b) => (b.disabled = n >= LIMITS.maxObjects));
  };
}
