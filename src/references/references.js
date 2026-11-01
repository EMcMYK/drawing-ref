// The References tab: browse the library by category, search, filter by
// license, and open an image large with its credit.
import { byLine, createBrokenTracker, creditLine, filterImages, loadCategory, loadIndex, needsCredit, pickRandom } from './library.js';

const PAGE = 60;
// When an image fails in the viewer it moves on to the next one, but only
// this many times in a row, so a blocked source can't spin through the list.
const MAX_SKIPS = 3;
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
      <div class="viewer-stage"><img alt="" /><p class="viewer-error" hidden></p></div>
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
  const broken = createBrokenTracker();
  const state = { categories: [], category: null, images: [], filtered: [], shown: 0, current: null, query: '', license: 'all', skips: 0, pos: 0 };
  const BLOCKED_NOTE = " Some images aren't loading: an ad blocker or the image site may be the cause.";

  function showCount() {
    status.textContent = state.filtered.length
      ? `${state.filtered.length} images${broken.anyDown ? `.${BLOCKED_NOTE}` : ''}`
      : state.images.length
        ? `No images match. Try another word or license setting.${broken.anyDown ? BLOCKED_NOTE : ''}`
        : 'No images in this category yet.';
    // The chip shows what this category can actually show right now.
    const chip = chips.querySelector(`[data-cat="${CSS.escape(state.category ?? '')}"] span`);
    if (chip && state.images.length) chip.textContent = state.images.filter((i) => !broken.has(i.id)).length;
  }

  const findImage = (id) => state.images.find((i) => i.id === id) ?? { id, source: '' };

  const markBroken = (img) => {
    broken.fail(img);
    state.filtered = state.filtered.filter((i) => i.id !== img.id);
    showCount();
  };

  function applyFilters() {
    state.filtered = filterImages(state.images, { query: state.query, license: state.license, broken });
    state.shown = 0;
    grid.innerHTML = '';
    showCount();
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
      const btn = el.closest('.thumb');
      el.addEventListener('load', () => broken.ok(findImage(btn.dataset.id)));
      el.addEventListener('error', () => {
        markBroken(findImage(btn.dataset.id));
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

  // delta: which way to move on if this image fails (+1, -1, or 0 for random).
  function open(img, { delta = 0, auto = false } = {}) {
    if (!img) return;
    if (!auto) state.skips = 0;
    state.current = img;
    const at = state.filtered.findIndex((x) => x.id === img.id);
    if (at >= 0) state.pos = at;
    const pic = viewer.querySelector('img');
    const error = viewer.querySelector('.viewer-error');
    pic.hidden = false;
    error.hidden = true;
    pic.onload = () => broken.ok(img);
    pic.onerror = () => {
      if (state.current !== img) return;
      markBroken(img);
      if (state.skips < MAX_SKIPS && state.filtered.length) {
        state.skips++;
        open(delta ? neighbour(delta) : pickRandom(state.filtered, img.id), { delta, auto: true });
      } else {
        pic.hidden = true;
        error.hidden = false;
        error.textContent = broken.anyDown
          ? "This image couldn't load. An ad blocker or the image site may be blocking it."
          : "This image couldn't load. Try the arrows or Random.";
      }
    };
    pic.src = safeUrl(img.image.display);
    pic.alt = img.title;
    viewer.querySelector('.viewer-title').textContent = img.title;
    const by = byLine(img);
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

  // The image next to the current one. If the current one has just been
  // dropped (it failed to load), its old place in the list is used.
  function neighbour(delta) {
    const list = state.filtered;
    const n = list.length;
    if (!n) return null;
    const i = list.findIndex((x) => x.id === state.current?.id);
    const target = i >= 0 ? i + delta : delta > 0 ? state.pos : state.pos - 1;
    return list[((target % n) + n) % n];
  }

  function step(delta) {
    if (state.current) open(neighbour(delta), { delta });
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
