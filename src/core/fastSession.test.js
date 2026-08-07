import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROTOCOLS,
  startFast,
  endFast,
  isRunning,
  isOpenEnded,
  elapsedMs,
  remainingMs,
  progress,
  isComplete,
  overtimeMs,
  goalReachedAt,
  formatDuration,
} from './fastSession.js';

const H = 3600_000;
const T0 = Date.UTC(2026, 2, 7, 20, 0, 0); // 8pm, evening before a US DST shift

test('a fast started then read 18h later reports 18h, with no ticking in between', () => {
  // Simulates the app being force-quit at minute 1 and reopened the next day.
  const s = startFast({ targetMs: PROTOCOLS['16:8'], now: T0 });
  assert.equal(elapsedMs(s, T0 + 18 * H), 18 * H);
});

test('a device reboot mid-fast loses nothing, because state is two timestamps', () => {
  const s = startFast({ targetMs: PROTOCOLS['16:8'], now: T0 });
  const rehydrated = JSON.parse(JSON.stringify(s)); // what storage round-trips
  assert.deepEqual(rehydrated, s);
  assert.equal(elapsedMs(rehydrated, T0 + 10 * H), 10 * H);
});

test('DST transition does not add or remove an hour', () => {
  // 2026-03-08 02:00 local US clocks jump forward. Epoch ms are unaffected.
  const s = startFast({ targetMs: PROTOCOLS['16:8'], now: T0 });
  const sixteenHoursLater = T0 + 16 * H;
  assert.equal(elapsedMs(s, sixteenHoursLater), 16 * H);
  assert.equal(formatDuration(elapsedMs(s, sixteenHoursLater)), '16:00:00');
});

test('a backwards clock adjustment shows zero, never a negative timer', () => {
  const s = startFast({ targetMs: PROTOCOLS['16:8'], now: T0 });
  assert.equal(elapsedMs(s, T0 - 5 * H), 0);
  assert.equal(progress(s, T0 - 5 * H), 0);
  assert.equal(formatDuration(elapsedMs(s, T0 - 5 * H)), '00:00:00');
});

test('an ended fast stops growing', () => {
  const s = endFast(startFast({ targetMs: PROTOCOLS['16:8'], now: T0 }), T0 + 16 * H);
  assert.equal(elapsedMs(s, T0 + 40 * H), 16 * H);
  assert.equal(isRunning(s), false);
});

test('ending is idempotent and cannot land before the start', () => {
  const s = startFast({ targetMs: PROTOCOLS['16:8'], now: T0 });
  const ended = endFast(s, T0 + 3 * H);
  assert.equal(endFast(ended, T0 + 9 * H).endedAt, T0 + 3 * H);
  assert.equal(endFast(s, T0 - H).endedAt, T0); // clock skew clamped
});

test('progress clamps at 1 but overtime keeps counting', () => {
  const s = startFast({ targetMs: PROTOCOLS['16:8'], now: T0 });
  const at20h = T0 + 20 * H;
  assert.equal(progress(s, at20h), 1);
  assert.equal(remainingMs(s, at20h), 0);
  assert.equal(isComplete(s, at20h), true);
  assert.equal(overtimeMs(s, at20h), 4 * H);
});

test('goalReachedAt gives the timestamp a local notification should fire at', () => {
  const s = startFast({ targetMs: PROTOCOLS['18:6'], now: T0 });
  assert.equal(goalReachedAt(s), T0 + 18 * H);
});

test('formatDuration does not wrap hours at 24', () => {
  assert.equal(formatDuration(30 * H + 61_000), '30:01:01');
  assert.equal(formatDuration(0), '00:00:00');
});

test('an invalid target is rejected at creation, not discovered later', () => {
  assert.throws(() => startFast({ targetMs: 0, now: T0 }), RangeError);
  assert.throws(() => startFast({ targetMs: NaN, now: T0 }), RangeError);
});

/* ---- open-ended (FREE-FORM) fasts ---- */

test('FREE-FORM runs with no target instead of silently becoming a 16h fast', () => {
  const s = startFast({ targetMs: null, now: T0 });
  assert.equal(isOpenEnded(s), true);
  assert.equal(progress(s, T0 + 30 * H), null);
  assert.equal(remainingMs(s, T0 + 30 * H), null);
  assert.equal(overtimeMs(s, T0 + 30 * H), null);
  assert.equal(isComplete(s, T0 + 99 * H), false);
  assert.equal(goalReachedAt(s), null); // nothing to schedule an alert for
});

test('an open-ended fast still tracks elapsed time normally', () => {
  const s = startFast({ targetMs: null, now: T0 });
  assert.equal(formatDuration(elapsedMs(s, T0 + 41 * H + 300_000)), '41:05:00');
});
