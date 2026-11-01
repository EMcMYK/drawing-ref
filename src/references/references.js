// The References tab: browse the library by category, search, filter by
// license, and open an image large with its credit.
import { byLine, createBrokenTracker, creditLine, filterImages, loadCategory, loadIndex, needsCredit, pickRandom } from './library.js';
import { CUSTOM_LIMITS, DURATIONS, createSession, durationMs, formatTime } from './session.js';
import { gridSvg, mountOverlayToolbar, overlayKey, pictureStyle } from '../overlays/overlays.js';

const PAGE = 60;
// When an image fails in the viewer it moves on to the next one, but only
// this many times in a row, so a blocked source can't spin through the list.
const MAX_SKIPS = 3;
const TIMER_KEY = 'drawing-ref:timer:v1';

function loadTimer() {
  try {
    const t = JSON.parse(localStorage.getItem(TIMER_KEY) ?? '{}');
    return { id: DURATIONS.some((d) => d.id === t.id) ? t.id : '60', custom: Number(t.custom) || 2 };
  } catch {
    return { id: '60', custom: 2 };
  }
}

function saveTimer(t) {
  try {
    localStorage.setItem(TIMER_KEY, JSON.stringify(t));
  } catch {
    // Storage blocked: the choice resets on reload.
  }
}
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
        <button type="button" class="refs-random">Random</button>
      </div>
      <div class="refs-session" role="group" aria-label="Timed session">
        <select class="refs-timer" aria-label="Time per image">
          ${DURATIONS.map((d) => `<option value="${d.id}">${d.label}</option>`).join('')}
        </select>
        <label class="refs-custom" hidden>
          <input type="number" min="${CUSTOM_LIMITS.min}" max="${CUSTOM_LIMITS.max}" step="0.5" aria-label="Minutes per image" />
          min
        </label>
        <button type="button" class="primary refs-start">Start session</button>
      </div>
    </div>
    <p class="refs-status" role="status"></p>
    <div class="refs-grid"></div>
    <button type="button" class="refs-more" hidden>Show more</button>
    <div class="viewer" hidden role="dialog" aria-modal="true" aria-label="Reference image">
      <div class="viewer-stage"><img alt="" /><div class="grid-layer"></div><p class="viewer-error" hidden></p></div>
      <div class="viewer-info">
        <div class="viewer-text">
          <h2 class="viewer-title"></h2>
          <p class="viewer-credit"></p>
        </div>
        <div class="viewer-tools"></div>
        <div class="viewer-actions" data-browse>
          <button type="button" data-v="prev" aria-label="Previous">←</button>
          <button type="button" data-v="random">Random</button>
          <button type="button" data-v="next" aria-label="Next">→</button>
          <button type="button" data-v="close">Close</button>
        </div>
        <div class="viewer-actions" data-session hidden>
          <span class="countdown" role="timer" aria-label="Time left"></span>
          <button type="button" data-v="pause">Pause</button>
          <button type="button" data-v="skip">Skip</button>
          <button type="button" data-v="close">End</button>
        </div>
      </div>
    </div>`;

  const $ = (s) => root.querySelector(s);
  const chips = $('.chips');
  const grid = $('.refs-grid');
  const status = $('.refs-status');
  const more = $('.refs-more');
  const viewer = $('.viewer');
  const stage = viewer.querySelector('.viewer-stage');
  const pic = stage.querySelector('img');
  const gridLayer = stage.querySelector('.grid-layer');
  const countdown = viewer.querySelector('.countdown');
  const timerSelect = $('.refs-timer');
  const customField = $('.refs-custom');
  const customInput = customField.querySelector('input');
  const error = stage.querySelector('.viewer-error');
  const broken = createBrokenTracker();
  let session = null;
  let ticker = null;

  // The grid sits exactly over the picture, wherever it lands in the stage.
  const placeGrid = () => {
    Object.assign(gridLayer.style, {
      left: `${pic.offsetLeft}px`,
      top: `${pic.offsetTop}px`,
      width: `${pic.offsetWidth}px`,
      height: `${pic.offsetHeight}px`,
    });
  };
  pic.addEventListener('load', placeGrid);
  new ResizeObserver(placeGrid).observe(stage);
  const aids = mountOverlayToolbar(viewer.querySelector('.viewer-tools'), 'references', (o) => {
    Object.assign(pic.style, pictureStyle(o));
    gridLayer.innerHTML = gridSvg(o.grid);
  });

  const timer = loadTimer();
  timerSelect.value = timer.id;
  customInput.value = timer.custom;
  const showCustom = () => (customField.hidden = timerSelect.value !== 'custom');
  showCustom();
  const rememberTimer = () => {
    showCustom();
    saveTimer({ id: timerSelect.value, custom: Number(customInput.value) || timer.custom });
  };
  timerSelect.addEventListener('change', rememberTimer);
  customInput.addEventListener('change', rememberTimer);
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
    if (!session) showCount();
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
    pic.hidden = false;
    error.hidden = true;
    pic.onload = () => {
      state.skips = 0;
      broken.ok(img);
    };
    pic.onerror = () => {
      if (state.current !== img) return;
      markBroken(img);
      if (session) {
        // Several broken links in a row: stop rather than flash through them.
        if (++state.skips > MAX_SKIPS) {
          endSession(
            broken.anyDown
              ? "Session stopped: images aren't loading. An ad blocker or the image site may be blocking them."
              : "Session stopped: images aren't loading. Check your connection."
          );
          viewer.hidden = true;
          return;
        }
        session.next(performance.now());
        open(session.current, { auto: true });
        return;
      }
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
    if (session?.upcoming) new Image().src = safeUrl(session.upcoming.image.display);
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
    const wasHidden = viewer.hidden;
    viewer.hidden = false;
    if (wasHidden) viewer.querySelector(session ? '[data-v="pause"]' : '[data-browse] [data-v="close"]').focus();
  }

  function showTime() {
    const left = session.remaining(performance.now());
    countdown.textContent = formatTime(left);
    countdown.classList.toggle('ending', left <= 5_000 && !session.paused);
  }

  function startSession() {
    const ms = durationMs(timerSelect.value, customInput.value);
    if (!ms) {
      status.textContent = 'Enter how many minutes each image should show.';
      customInput.focus();
      return;
    }
    if (!state.filtered.length) return;
    session = createSession(state.filtered, ms, { now: performance.now() });
    viewer.querySelector('[data-browse]').hidden = true;
    viewer.querySelector('[data-session]').hidden = false;
    viewer.querySelector('[data-v="pause"]').textContent = 'Pause';
    viewer.hidden = true; // so open() moves focus into the session controls
    open(session.current);
    showTime();
    ticker = setInterval(() => {
      if (session.tick(performance.now())) open(session.current);
      showTime();
    }, 200);
  }

  function togglePause() {
    const now = performance.now();
    if (session.paused) session.resume(now);
    else session.pause(now);
    viewer.querySelector('[data-v="pause"]').textContent = session.paused ? 'Resume' : 'Pause';
    showTime();
  }

  function skip() {
    session.next(performance.now());
    open(session.current);
    showTime();
  }

  function endSession(message) {
    clearInterval(ticker);
    const count = session.shown;
    session = null;
    viewer.querySelector('[data-browse]').hidden = false;
    viewer.querySelector('[data-session]').hidden = true;
    countdown.classList.remove('ending');
    status.textContent = message ?? `Session ended after ${count} ${count === 1 ? 'image' : 'images'}.`;
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
    if (session) endSession();
    viewer.hidden = true;
    state.current = null;
    pic.removeAttribute('src');
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
  $('.refs-start').addEventListener('click', startSession);
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
    else if (v === 'pause') togglePause();
    else if (v === 'skip') skip();
  });
  window.addEventListener('keydown', (e) => {
    if (viewer.hidden) return;
    const aid = overlayKey(e);
    if (aid) aids.toggle(aid);
    else if (e.key === 'Escape') close();
    else if (session && e.key === ' ' && !e.target.closest('button')) togglePause();
    else if (session && e.key === 'ArrowRight') skip();
    else if (!session && e.key === 'ArrowLeft') step(-1);
    else if (!session && e.key === 'ArrowRight') step(1);
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
