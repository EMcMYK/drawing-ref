// The References tab: browse the library by category, search, filter by
// license, and open an image large with its credit.
import {
  creditLine,
  filterImages,
  loadBroken,
  loadCategory,
  loadIndex,
  needsCredit,
  pickRandom,
  saveBroken,
} from './library.js';

const PAGE = 60;
// Only http(s) links from the index are ever used.
const safeUrl = (u) => (/^https?:\/\//i.test(String(u ?? '')) ? u : '#');
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function mountReferences(root) {
  root.innerHTML = `
    <div class="refs-bar">
      <div class="chips" role="radiogroup" aria-label="Category"></div>
      <div class="refs-controls">
        <input type="search" class="refs-search" placeholder="Search this category" aria-label="Search this category" />
        <select class="refs-license" aria-label="License">
          <option value="all">All licenses</option>
          <option value="no-credit">No credit needed</option>
        </select>
        <button type="button" class="primary refs-random">Random</button>
      </div>
    </div>
    <p class="refs-status" role="status"></p>
    <div class="refs-grid"></div>
    <button type="button" class="refs-more" hidden>Show more</button>
    <div class="viewer" hidden role="dialog" aria-modal="true" aria-label="Reference image">
      <div class="viewer-stage"><img alt="" /></div>
      <div class="viewer-info">
        <div class="viewer-text">
          <h2 class="viewer-title"></h2>
          <p class="viewer-credit"></p>
        </div>
        <div class="viewer-actions">
          <button type="button" data-v="prev" aria-label="Previous">←</button>
          <button type="button" data-v="random">Random</button>
          <button type="button" data-v="next" aria-label="Next">→</button>
          <button type="button" data-v="close">Close</button>
        </div>
      </div>
    </div>`;

  const $ = (s) => root.querySelector(s);
  const chips = $('.chips');
  const grid = $('.refs-grid');
  const status = $('.refs-status');
  const more = $('.refs-more');
  const viewer = $('.viewer');
  const broken = loadBroken();
  const state = { categories: [], category: null, images: [], filtered: [], shown: 0, current: null, query: '', license: 'all' };

  // Only remember a broken link when we're online; offline, everything fails.
  const markBroken = (id) => {
    state.filtered = state.filtered.filter((i) => i.id !== id);
    if (state.filtered.length) status.textContent = `${state.filtered.length} images`;
    if (!navigator.onLine) return;
    broken.set(id, Date.now());
    saveBroken(broken);
  };

  function applyFilters() {
    state.filtered = filterImages(state.images, { query: state.query, license: state.license, broken });
    state.shown = 0;
    grid.innerHTML = '';
    status.textContent = state.filtered.length
      ? `${state.filtered.length} images`
      : state.images.length
        ? 'No images match. Try another word or license setting.'
        : 'No images in this category yet.';
    showMore();
  }

  function showMore() {
    const next = state.filtered.slice(state.shown, state.shown + PAGE);
    grid.insertAdjacentHTML(
      'beforeend',
      next
        .map(
          (img) => `<button type="button" class="thumb" data-id="${esc(img.id)}" title="${esc(creditLine(img))}">
            <img src="${esc(safeUrl(img.image.thumb ?? img.image.display))}" alt="${esc(img.title)}" loading="lazy" referrerpolicy="no-referrer" />
          </button>`
        )
        .join('')
    );
    grid.querySelectorAll('img:not([data-wired])').forEach((el) => {
      el.dataset.wired = '1';
      el.addEventListener('error', () => {
        const btn = el.closest('.thumb');
        markBroken(btn.dataset.id);
        btn.remove();
      });
    });
    state.shown += next.length;
    more.hidden = state.shown >= state.filtered.length;
  }

  async function selectCategory(id) {
    state.category = id;
    chips.querySelectorAll('[role="radio"]').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.cat === id)));
    status.textContent = 'Loading…';
    grid.innerHTML = '';
    state.images = await loadCategory(id);
    if (state.category === id) applyFilters();
  }

  function open(img) {
    if (!img) return;
    state.current = img;
    const pic = viewer.querySelector('img');
    pic.src = safeUrl(img.image.display);
    pic.alt = img.title;
    pic.onerror = () => {
      markBroken(img.id);
      open(pickRandom(state.filtered, img.id));
    };
    viewer.querySelector('.viewer-title').textContent = img.title;
    const by = [img.creator, img.date].filter(Boolean).join(', ');
    viewer.querySelector('.viewer-credit').innerHTML = [
      by && esc(by),
      esc(img.credit),
      `<a href="${esc(safeUrl(img.license.url))}" target="_blank" rel="noopener">${esc(img.license.name)}</a>${needsCredit(img) ? ' (credit required)' : ''}`,
      `<a href="${esc(safeUrl(img.pageUrl))}" target="_blank" rel="noopener">View source</a>`,
    ]
      .filter(Boolean)
      .join(' · ');
    viewer.hidden = false;
    viewer.querySelector('[data-v="close"]').focus();
  }

  function step(delta) {
    const list = state.filtered;
    const i = list.findIndex((x) => x.id === state.current?.id);
    if (i < 0 || !list.length) return;
    open(list[(i + delta + list.length) % list.length]);
  }

  const close = () => {
    viewer.hidden = true;
    state.current = null;
  };

  chips.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-cat]');
    if (chip) selectCategory(chip.dataset.cat);
  });
  $('.refs-search').addEventListener('input', (e) => {
    state.query = e.target.value;
    applyFilters();
  });
  $('.refs-license').addEventListener('change', (e) => {
    state.license = e.target.value;
    applyFilters();
  });
  $('.refs-random').addEventListener('click', () => open(pickRandom(state.filtered)));
  more.addEventListener('click', showMore);
  grid.addEventListener('click', (e) => {
    const t = e.target.closest('.thumb');
    if (t) open(state.filtered.find((i) => i.id === t.dataset.id));
  });
  viewer.addEventListener('click', (e) => {
    const v = e.target.closest('[data-v]')?.dataset.v;
    if (v === 'close' || e.target === viewer) close();
    else if (v === 'prev') step(-1);
    else if (v === 'next') step(1);
    else if (v === 'random') open(pickRandom(state.filtered, state.current?.id));
  });
  window.addEventListener('keydown', (e) => {
    if (viewer.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else return;
    e.preventDefault();
  });

  // Load the index once, the first time the tab is shown.
  let started = false;
  return async function start() {
    if (started) return;
    started = true;
    status.textContent = 'Loading…';
    const index = await loadIndex();
    state.categories = (index?.categories ?? []).filter((c) => c.count > 0);
    if (!state.categories.length) {
      status.textContent = "The image library hasn't been built yet.";
      return;
    }
    chips.innerHTML = state.categories
      .map(
        (c) =>
          `<button type="button" role="radio" aria-checked="false" class="chip" data-cat="${esc(c.id)}">${esc(c.label)} <span>${c.count}</span></button>`
      )
      .join('');
    selectCategory(state.categories[0].id);
  };
}
