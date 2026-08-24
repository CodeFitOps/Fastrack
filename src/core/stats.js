/**
 * Aggregates over completed fasts.
 *
 * The prototype's Stats screen was entirely hardcoded — "24 fasts completed",
 * "17:12 average", an "11 D" streak, a fixed 35-cell calendar array. None of it
 * derived from the history list. This module is that missing engine.
 *
 * Day attribution: a fast from 20:05 to 12:45 spans two calendar days, so
 * "hours fasted on Tuesday" is computed as the OVERLAP between the fast and that
 * day, not the fast's whole duration credited to its start date. Otherwise a
 * daily 16:8 rhythm reports 16h on every day and 0h on none, which is visibly
 * wrong on a weekly bar chart.
 *
 * All day boundaries are local, because "Tuesday" is a local idea. The stored
 * timestamps stay UTC epoch ms.
 */

const H = 3600_000;
const DAY = 86_400_000;

/** Local midnight starting the day that contains `ts`. */
export function startOfLocalDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local midnight `n` days before the day containing `ts`. */
export function addDays(ts, n) {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

function sessionEnd(session, now) {
  return session.endedAt ?? now;
}

/** Milliseconds of `session` that fall inside [dayStart, dayEnd). */
export function overlapMs(session, dayStart, dayEnd, now = Date.now()) {
  const start = Math.max(session.startedAt, dayStart);
  const end = Math.min(sessionEnd(session, now), dayEnd);
  return Math.max(0, end - start);
}

/** Total fasted ms on the local day containing `dayTs`. */
export function fastedMsOnDay(sessions, dayTs, now = Date.now()) {
  const dayStart = startOfLocalDay(dayTs);
  const dayEnd = addDays(dayStart, 1);
  return sessions.reduce((sum, s) => sum + overlapMs(s, dayStart, dayEnd, now), 0);
}

/**
 * Fasted hours for each of the last `days` local days, oldest first.
 * Shape matches the weekly bar chart.
 */
export function dailyTotals(sessions, { days = 7, now = Date.now() } = {}) {
  const today = startOfLocalDay(now);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayTs = addDays(today, -i);
    const ms = fastedMsOnDay(sessions, dayTs, now);
    out.push({
      dayTs,
      // Sin traducir a propósito: la UI formatea el día con el idioma elegido
      // a partir de `dayTs`. Este campo queda sólo para depuración.
      weekday: new Date(dayTs).toLocaleDateString('en', { weekday: 'short' }).toUpperCase(),
      ms,
      hours: ms / H,
    });
  }
  return out;
}

/** Only fasts that were actually finished count toward completion stats. */
const completed = (sessions) => sessions.filter((s) => s.endedAt != null);

export function durationMs(session) {
  return Math.max(0, session.endedAt - session.startedAt);
}

export function completedCount(sessions, { sinceMs = null, now = Date.now() } = {}) {
  const cutoff = sinceMs == null ? -Infinity : now - sinceMs;
  return completed(sessions).filter((s) => s.endedAt >= cutoff).length;
}

/** Mean completed duration, or null when there is nothing to average. */
export function averageDurationMs(sessions) {
  const done = completed(sessions);
  if (done.length === 0) return null;
  return done.reduce((sum, s) => sum + durationMs(s), 0) / done.length;
}

export function longestDurationMs(sessions) {
  const done = completed(sessions);
  if (done.length === 0) return null;
  return Math.max(...done.map(durationMs));
}

/**
 * Consecutive local days, counting back, on which a fast was completed.
 *
 * Today not yet having a completed fast does not break the streak — it is still
 * in progress. The streak only breaks on a day that has fully passed with
 * nothing logged. Counting today as a miss would show every streak collapsing to
 * zero each morning.
 */
export function currentStreakDays(sessions, { now = Date.now() } = {}) {
  const daysWithFast = new Set(
    completed(sessions).map((s) => startOfLocalDay(s.endedAt))
  );
  if (daysWithFast.size === 0) return 0;

  const today = startOfLocalDay(now);
  let cursor = daysWithFast.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (daysWithFast.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Distinct local days with any fasting time, within the last `days`. */
export function daysLogged(sessions, { days = 30, now = Date.now() } = {}) {
  const today = startOfLocalDay(now);
  let count = 0;
  for (let i = 0; i < days; i++) {
    if (fastedMsOnDay(sessions, addDays(today, -i), now) > 0) count++;
  }
  return count;
}

/**
 * Consistency grid. Levels match the prototype's legend:
 * 0 none · 1 under 16h · 2 16h and over · 3 24h and over.
 */
export function consistencyGrid(sessions, { days = 35, now = Date.now() } = {}) {
  const today = startOfLocalDay(now);
  const cells = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayTs = addDays(today, -i);
    const hours = fastedMsOnDay(sessions, dayTs, now) / H;
    let level = 0;
    if (hours >= 24) level = 3;
    else if (hours >= 16) level = 2;
    else if (hours > 0) level = 1;
    cells.push({ dayTs, hours, level });
  }
  return cells;
}

/** Everything the Stats screen needs, in one pass. */
export function summarise(sessions, { now = Date.now() } = {}) {
  const week = dailyTotals(sessions, { days: 7, now });
  const prevWeek = dailyTotals(sessions, { days: 14, now }).slice(0, 7);
  const weekMs = week.reduce((s, d) => s + d.ms, 0);
  const prevWeekMs = prevWeek.reduce((s, d) => s + d.ms, 0);

  return {
    week,
    weekMs,
    weekDeltaMs: weekMs - prevWeekMs,
    completedLast30: completedCount(sessions, { sinceMs: 30 * DAY, now }),
    averageMs: averageDurationMs(sessions),
    longestMs: longestDurationMs(sessions),
    streakDays: currentStreakDays(sessions, { now }),
    daysLogged: daysLogged(sessions, { days: 30, now }),
    grid: consistencyGrid(sessions, { days: 35, now }),
  };
}
