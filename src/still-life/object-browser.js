// The object library browser: a pop-over with category filters, search and
// paging, like the References tab. Picking an object asks to confirm
// ("Add Paintbrush?") before it goes into the scene.
import { groupsOf, loadCatalog, loadObjectShape, searchObjects, shapeIdFor } from './objects.js';

const PAGE = 60;
const base = () => import.meta.env?.BASE_URL ?? '/';
const safeUrl = (u) => (/^https:\/\//i.test(String(u ?? '')) ? u : null);

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null));
  return node;
}

function link(text, href) {
  const url = safeUrl(href);
  return url ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', textContent: text }) : text;
}

// `canAdd()` says whether the scene has room; `add(shape)` puts it in.
export function createObjectBrowser({ canAdd, add }) {
  const dialog = el('dialog', { className: 'object-browser' });
  dialog.setAttribute('aria-label', 'Object library');
  dialog.innerHTML = `
    <div class="ob-head">
      <h2>Objects</h2>
      <button type="button" class="ob-close" aria-label="Close">✕</button>
    </div>
    <div class="ob-bar">
      <div class="chips" role="radiogroup" aria-label="Category"></div>
      <input type="search" class="ob-search" placeholder="Search: cup, vase, lamp…" aria-label="Search objects" autocomplete="off" />
    </div>
    <p class="ob-status" role="status"></p>
    <div class="ob-grid"></div>
    <button type="button" class="ob-more" hidden>Show more</button>
    <div class="ob-confirm" hidden role="alertdialog" aria-modal="true" aria-labelledby="ob-confirm-title">
      <div class="ob-confirm-card">
        <img alt="" />
        <h3 id="ob-confirm-title"></h3>
        <p class="ob-confirm-credit"></p>
        <p class="ob-confirm-error" hidden></p>
        <div class="row">
          <button type="button" data-c="cancel">Cancel</button>
          <button type="button" class="primary" data-c="ok">Add</button>
        </div>
      </div>
    </div>`;
  document.body.append(dialog);

  const $ = (s) => dialog.querySelector(s);
  const state = { catalog: [], group: 'all', query: '', shown: PAGE, pending: null };

  function renderChips() {
    const groups = [{ id: 'all', label: 'All', count: state.catalog.length }, ...groupsOf(state.catalog)];
    $('.chips').replaceChildren(
      ...groups.map((g) => {
        const b = el('button', { type: 'button', className: 'chip' }, `${g.label} `, el('span', { textContent: g.count }));
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(g.id === state.group));
        b.dataset.group = g.id;
        return b;
      })
    );
  }

  function results() {
    const inGroup = state.group === 'all' ? state.catalog : state.catalog.filter((o) => o.group === state.group);
    return searchObjects(inGroup, state.query);
  }

  function renderGrid() {
    const found = results();
    const page = found.slice(0, state.shown);
    $('.ob-grid').replaceChildren(
      ...page.map((o) => {
        const b = el(
          'button',
          { type: 'button', className: 'object-card', title: o.name },
          o.thumb ? el('img', { src: `${base()}objects/${o.thumb}`, alt: '', loading: 'lazy' }) : null,
          el('span', { textContent: o.name })
        );
        b.dataset.object = o.id;
        return b;
      })
    );
    $('.ob-more').hidden = found.length <= state.shown;
    $('.ob-status').textContent = found.length
      ? `${found.length} object${found.length === 1 ? '' : 's'}${canAdd() ? '' : ' · The scene is full (12). Delete something to add more.'}`
      : 'Nothing matches. Try another word or category.';
  }

  function showConfirm(o) {
    state.pending = o;
    const box = $('.ob-confirm');
    const img = box.querySelector('img');
    img.hidden = !o.thumb;
    if (o.thumb) img.src = `${base()}objects/${o.thumb}`;
    box.querySelector('h3').textContent = `Add ${o.name}?`;
    box.querySelector('.ob-confirm-credit').replaceChildren(
      link(o.license?.name ?? 'CC BY 4.0', o.license?.url),
      ` · ${o.credit ?? ''}`
    );
    box.querySelector('.ob-confirm-error').hidden = true;
    const ok = box.querySelector('[data-c="ok"]');
    ok.disabled = !canAdd();
    ok.textContent = canAdd() ? 'Add' : 'Scene is full';
    box.hidden = false;
    ok.focus();
  }

  function hideConfirm() {
    state.pending = null;
    $('.ob-confirm').hidden = true;
  }

  async function confirmAdd() {
    const o = state.pending;
    if (!o) return;
    const ok = $('.ob-confirm [data-c="ok"]');
    ok.disabled = true;
    ok.textContent = 'Adding…';
    try {
      const shape = await loadObjectShape(shapeIdFor(o.id));
      add(shape);
      hideConfirm();
      dialog.close();
    } catch {
      const err = $('.ob-confirm-error');
      err.textContent = 'Could not load this object. Try again, or pick another one.';
      err.hidden = false;
      ok.disabled = false;
      ok.textContent = 'Try again';
    }
  }

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) return dialog.close(); // click on the backdrop
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.classList.contains('ob-close')) dialog.close();
    else if (btn.dataset.group) {
      state.group = btn.dataset.group;
      state.shown = PAGE;
      renderChips();
      renderGrid();
    } else if (btn.dataset.object) {
      const o = state.catalog.find((x) => x.id === btn.dataset.object);
      if (o) showConfirm(o);
    } else if (btn.classList.contains('ob-more')) {
      state.shown += PAGE;
      renderGrid();
    } else if (btn.dataset.c === 'cancel') hideConfirm();
    else if (btn.dataset.c === 'ok') confirmAdd();
  });

  $('.ob-search').addEventListener('input', (e) => {
    state.query = e.target.value;
    state.shown = PAGE;
    renderGrid();
  });

  // Esc closes the confirm first, then the browser.
  dialog.addEventListener('cancel', (e) => {
    if (!$('.ob-confirm').hidden) {
      e.preventDefault();
      hideConfirm();
    }
  });
  dialog.addEventListener('close', hideConfirm);

  return {
    async open() {
      state.catalog = await loadCatalog();
      renderChips();
      renderGrid();
      if (!dialog.open) dialog.showModal();
      $('.ob-search').focus();
    },
    get element() {
      return dialog;
    },
  };
}
