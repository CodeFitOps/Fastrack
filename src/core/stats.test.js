import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startOfLocalDay,
  addDays,
  fastedMsOnDay,
  dailyTotals,
  completedCount,
  averageDurationMs,
  longestDurationMs,
  currentStreakDays,
  daysLogged,
  consistencyGrid,
  summarise,
} from './stats.js';

const H = 3600_000;

/** A completed fast starting `startH` local hours into the day `dayOffset` days ago. */
function fastOn(dayOffset, startH, durationH, now) {
  const day = addDays(startOfLocalDay(now), -dayOffset);
  const startedAt = day + startH * H;
  return { id: `f${dayOffset}`, startedAt, endedAt: startedAt + durationH * H, targetMs: 16 * H };
}

// Fixed reference: midday, so day arithmetic never lands on a boundary.
const NOW = new Date(2026, 6, 15, 12, 0, 0).getTime();

test('a fast spanning midnight is split across both days, not credited to one', () => {
  // 20:00 for 16h → 4h on the start day, 12h on the next.
  const s = fastOn(1, 20, 16, NOW);
  const startDay = addDays(startOfLocalDay(NOW), -1);
  assert.equal(fastedMsOnDay([s], startDay, NOW), 4 * H);
  assert.equal(fastedMsOnDay([s], addDays(startDay, 1), NOW), 12 * H);
});

test('a fast wholly inside one day counts once', () => {
  const s = fastOn(1, 6, 10, NOW);
  assert.equal(fastedMsOnDay([s], addDays(startOfLocalDay(NOW), -1), NOW), 10 * H);
});

test('dailyTotals returns the last 7 days oldest-first', () => {
  const week = dailyTotals([fastOn(2, 8, 12, NOW)], { days: 7, now: NOW });
  assert.equal(week.length, 7);
  assert.ok(week[0].dayTs < week[6].dayTs);
  assert.equal(week[6].dayTs, startOfLocalDay(NOW)); // last cell is today
  assert.equal(week[4].hours, 12);
});

test('averages and longest ignore a fast still running', () => {
  const running = { id: 'r', startedAt: NOW - 40 * H, endedAt: null, targetMs: null };
  const sessions = [fastOn(1, 8, 16, NOW), fastOn(2, 8, 18, NOW), running];
  assert.equal(averageDurationMs(sessions), 17 * H);
  assert.equal(longestDurationMs(sessions), 18 * H); // not the 40h in progress
  assert.equal(completedCount(sessions), 2);
});

test('averages return null rather than NaN with no completed fasts', () => {
  assert.equal(averageDurationMs([]), null);
  assert.equal(longestDurationMs([]), null);
  assert.equal(currentStreakDays([], { now: NOW }), 0);
});

test('a streak counts consecutive days back', () => {
  const sessions = [fastOn(0, 2, 6, NOW), fastOn(1, 2, 6, NOW), fastOn(2, 2, 6, NOW)];
  assert.equal(currentStreakDays(sessions, { now: NOW }), 3);
});

test('today having no fast yet does not break the streak', () => {
  // Yesterday and the day before, nothing today. Still a live 2-day streak.
  const sessions = [fastOn(1, 2, 6, NOW), fastOn(2, 2, 6, NOW)];
  assert.equal(currentStreakDays(sessions, { now: NOW }), 2);
});

test('a fully missed day breaks the streak', () => {
  const sessions = [fastOn(1, 2, 6, NOW), fastOn(3, 2, 6, NOW)]; // day 2 missing
  assert.equal(currentStreakDays(sessions, { now: NOW }), 1);
});

test('a gap before today does not resurrect an older streak', () => {
  const sessions = [fastOn(5, 2, 6, NOW), fastOn(6, 2, 6, NOW), fastOn(7, 2, 6, NOW)];
  assert.equal(currentStreakDays(sessions, { now: NOW }), 0);
});

test('daysLogged counts distinct days, not fasts', () => {
  const twoOnOneDay = [fastOn(1, 2, 3, NOW), fastOn(1, 10, 3, NOW)];
  assert.equal(daysLogged(twoOnOneDay, { days: 30, now: NOW }), 1);
});

test('consistency levels follow the legend thresholds', () => {
  const sessions = [
    fastOn(1, 0, 25, NOW), // >= 24h on that day boundary
    fastOn(3, 0, 17, NOW), // 16h+
    fastOn(5, 0, 5, NOW),  // under 16h
  ];
  const grid = consistencyGrid(sessions, { days: 7, now: NOW });
  const byOffset = (n) => grid.find((c) => c.dayTs === addDays(startOfLocalDay(NOW), -n));
  assert.equal(byOffset(1).level, 3);
  assert.equal(byOffset(3).level, 2);
  assert.equal(byOffset(5).level, 1);
  assert.equal(byOffset(6).level, 0);
});

test('summarise compares this week against the previous one', () => {
  const sessions = [fastOn(1, 8, 10, NOW), fastOn(9, 8, 4, NOW)];
  const s = summarise(sessions, { now: NOW });
  assert.equal(s.weekMs, 10 * H);
  assert.equal(s.weekDeltaMs, 6 * H); // 10h this week vs 4h last
  assert.equal(s.grid.length, 35);
});

test('an empty history summarises without throwing', () => {
  const s = summarise([], { now: NOW });
  assert.equal(s.weekMs, 0);
  assert.equal(s.averageMs, null);
  assert.equal(s.streakDays, 0);
  assert.equal(s.grid.every((c) => c.level === 0), true);
});
