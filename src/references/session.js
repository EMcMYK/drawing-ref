// A timed drawing session: shows references one after another, each for a
// fixed time. Pure logic; the clock (`now`) is passed in so it can be tested.

export const DURATIONS = [
  { id: '30', label: '30 s', ms: 30_000 },
  { id: '60', label: '1 min', ms: 60_000 },
  { id: '300', label: '5 min', ms: 300_000 },
  { id: 'custom', label: 'Custom' },
];

export const CUSTOM_LIMITS = { min: 0.25, max: 120 }; // minutes

export function durationMs(id, customMinutes) {
  const preset = DURATIONS.find((d) => d.id === id);
  if (preset?.ms) return preset.ms;
  const m = Number(customMinutes);
  if (!Number.isFinite(m) || m <= 0) return null;
  const clamped = Math.min(CUSTOM_LIMITS.max, Math.max(CUSTOM_LIMITS.min, m));
  return Math.round(clamped * 60_000);
}

function shuffled(list, rand) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Goes through the images in a random order without repeats; after the last
// one it reshuffles, never starting the new round on the image just shown.
export function createSession(images, ms, { now, rand = Math.random } = {}) {
  let order = shuffled(images, rand);
  let index = 0;
  let endsAt = now + ms;
  let pausedLeft = null;
  let shown = 1;

  return {
    get current() {
      return order[index] ?? null;
    },
    // The image after this one, when known, so it can load ahead of time.
    get upcoming() {
      return order[index + 1] ?? null;
    },
    get shown() {
      return shown;
    },
    get paused() {
      return pausedLeft !== null;
    },
    remaining(t) {
      return Math.max(0, pausedLeft ?? endsAt - t);
    },
    // Moves on when time is up. Returns true when the image changed.
    tick(t) {
      if (pausedLeft !== null || t < endsAt) return false;
      this.next(t);
      return true;
    },
    next(t) {
      const last = order[index];
      index++;
      if (index >= order.length) {
        order = shuffled(images, rand);
        if (order.length > 1 && order[0] === last) order.push(order.shift());
        index = 0;
      }
      shown++;
      endsAt = t + ms;
      if (pausedLeft !== null) pausedLeft = ms;
    },
    pause(t) {
      if (pausedLeft === null) pausedLeft = Math.max(0, endsAt - t);
    },
    resume(t) {
      if (pausedLeft === null) return;
      endsAt = t + pausedLeft;
      pausedLeft = null;
    },
  };
}

export function formatTime(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
