import { describe, expect, it } from 'vitest';
import { createSession, durationMs, formatTime } from '../src/references/session.js';

const imgs = ['a', 'b', 'c'].map((id) => ({ id }));
// Same "random" numbers every run.
const seq = (...xs) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

describe('durationMs', () => {
  it('uses the presets', () => {
    expect(durationMs('30')).toBe(30_000);
    expect(durationMs('300')).toBe(300_000);
  });

  it('reads custom minutes and keeps them in range', () => {
    expect(durationMs('custom', '2')).toBe(120_000);
    expect(durationMs('custom', 0.1)).toBe(15_000);
    expect(durationMs('custom', 500)).toBe(120 * 60_000);
  });

  it('rejects an empty or bad custom time', () => {
    expect(durationMs('custom', '')).toBeNull();
    expect(durationMs('custom', 'abc')).toBeNull();
    expect(durationMs('custom', -1)).toBeNull();
  });
});

describe('createSession', () => {
  it('moves on when the time is up', () => {
    const s = createSession(imgs, 1000, { now: 0, rand: seq(0.5) });
    const first = s.current;
    expect(s.tick(999)).toBe(false);
    expect(s.tick(1000)).toBe(true);
    expect(s.current).not.toBe(first);
    expect(s.shown).toBe(2);
    expect(s.remaining(1500)).toBe(500);
  });

  it('shows every image once before repeating, and never twice in a row', () => {
    const s = createSession(imgs, 1000, { now: 0, rand: seq(0.1, 0.9, 0.4) });
    const seen = [s.current];
    for (let t = 1; t < 9; t++) {
      s.next(t);
      seen.push(s.current);
    }
    expect(new Set(seen.slice(0, 3)).size).toBe(3);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
  });

  it('holds the time while paused', () => {
    const s = createSession(imgs, 1000, { now: 0 });
    s.pause(400);
    expect(s.paused).toBe(true);
    expect(s.tick(5000)).toBe(false);
    expect(s.remaining(5000)).toBe(600);
    s.resume(5000);
    expect(s.remaining(5100)).toBe(500);
    expect(s.tick(5600)).toBe(true);
  });

  it('starts a skipped-to image with the full time, even while paused', () => {
    const s = createSession(imgs, 1000, { now: 0 });
    s.pause(800);
    s.next(900);
    expect(s.paused).toBe(true);
    expect(s.remaining(2000)).toBe(1000);
  });

  it('works with a single image', () => {
    const s = createSession([{ id: 'x' }], 1000, { now: 0 });
    s.next(1);
    expect(s.current.id).toBe('x');
  });
});

describe('formatTime', () => {
  it('rounds up to whole seconds', () => {
    expect(formatTime(59_001)).toBe('1:00');
    expect(formatTime(5_000)).toBe('0:05');
    expect(formatTime(0)).toBe('0:00');
  });
});
