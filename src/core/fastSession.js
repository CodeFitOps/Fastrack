/**
 * Fasting session logic.
 *
 * Design rule: a session stores only absolute epoch timestamps. Elapsed time is
 * always DERIVED from (now - startedAt), never accumulated by a ticking counter.
 *
 * This is what makes the timer survive the app being backgrounded, force-quit,
 * or the device rebooting: there is no in-memory count to lose. A setInterval in
 * the UI exists only to trigger repaints, and dropping ticks costs nothing.
 *
 * Epoch milliseconds are UTC-based, so daylight-saving transitions and timezone
 * changes while travelling do not affect elapsed time. Only display formatting
 * is ever timezone-aware.
 */

export const PROTOCOLS = {
  '12:12': 12 * 3600_000,
  '14:10': 14 * 3600_000,
  '16:8': 16 * 3600_000,
  '18:6': 18 * 3600_000,
  '20:4': 20 * 3600_000,
  '24h': 24 * 3600_000,
};

/**
 * @typedef {Object} FastSession
 * @property {string} id
 * @property {number} startedAt  epoch ms
 * @property {number} targetMs   goal duration
 * @property {number|null} endedAt epoch ms, or null while running
 */

/**
 * `targetMs` of null means an open-ended fast (the FREE-FORM protocol): it runs
 * until stopped and has no goal, so progress and remaining time are undefined
 * rather than zero. Callers must branch on null instead of receiving a number
 * that silently means "16 hours".
 *
 * @returns {FastSession}
 */
export function startFast({ targetMs, startedAt, now = Date.now(), id = cryptoId() }) {
  if (targetMs !== null && (!Number.isFinite(targetMs) || targetMs <= 0)) {
    throw new RangeError('targetMs must be a positive number of ms, or null for an open-ended fast');
  }
  const begins = startedAt ?? now;
  const problem = validateStart(begins, now);
  if (problem) throw new RangeError(problem);
  return { id, startedAt: begins, targetMs, endedAt: null };
}

/** Cuánto atrás se admite fechar el inicio de un ayuno. */
export const MAX_BACKDATE_MS = 7 * 86_400_000;

/**
 * Comprueba una hora de inicio propuesta.
 *
 * Devuelve una clave de traducción con el problema, o null si vale.
 *
 * El futuro se rechaza: un ayuno que empieza dentro de dos horas no es un ayuno
 * en curso, es un plan, y la app no modela planes. El tope de siete días atrás
 * está para atajar el error de teclear la fecha mal — un ayuno real de más de
 * una semana existe, pero es tan raro que es mucho más probable que sea un
 * dedazo, y un inicio erróneo contamina las estadísticas en silencio.
 */
export function validateStart(startedAt, now = Date.now()) {
  if (!Number.isFinite(startedAt)) return 'fast.startInvalid';
  if (startedAt > now) return 'fast.startInFuture';
  if (now - startedAt > MAX_BACKDATE_MS) return 'fast.startTooOld';
  return null;
}

/**
 * Mueve la hora de inicio de un ayuno en curso.
 *
 * Devuelve una sesión nueva; no muta. Quien la llame debe reprogramar la alerta
 * de objetivo, porque el instante en que se cumple ha cambiado.
 */
export function adjustStart(session, startedAt, now = Date.now()) {
  const problem = validateStart(startedAt, now);
  if (problem) throw new RangeError(problem);
  if (session.endedAt !== null && startedAt > session.endedAt) {
    throw new RangeError('fast.startAfterEnd');
  }
  return { ...session, startedAt };
}

/** True when the fast has no goal to reach. */
export function isOpenEnded(session) {
  return session.targetMs === null;
}

/** @returns {FastSession} */
export function endFast(session, now = Date.now()) {
  if (session.endedAt !== null) return session;
  // Never record an end before the start, even if the device clock moved back.
  return { ...session, endedAt: Math.max(now, session.startedAt) };
}

export function isRunning(session) {
  return Boolean(session) && session.endedAt === null;
}

/**
 * Elapsed milliseconds. Clamped at zero so a backwards clock adjustment shows
 * 00:00:00 rather than a negative timer.
 */
export function elapsedMs(session, now = Date.now()) {
  const end = session.endedAt ?? now;
  return Math.max(0, end - session.startedAt);
}

/** Milliseconds left until the goal, or null for an open-ended fast. */
export function remainingMs(session, now = Date.now()) {
  if (isOpenEnded(session)) return null;
  return Math.max(0, session.targetMs - elapsedMs(session, now));
}

/** Progress toward the goal 0..1, clamped. Null for an open-ended fast. */
export function progress(session, now = Date.now()) {
  if (isOpenEnded(session)) return null;
  return Math.min(1, elapsedMs(session, now) / session.targetMs);
}

/** An open-ended fast is never "complete" — there is nothing to complete. */
export function isComplete(session, now = Date.now()) {
  if (isOpenEnded(session)) return false;
  return elapsedMs(session, now) >= session.targetMs;
}

/** Milliseconds fasted past the goal. Zero before completion, null if open-ended. */
export function overtimeMs(session, now = Date.now()) {
  if (isOpenEnded(session)) return null;
  return Math.max(0, elapsedMs(session, now) - session.targetMs);
}

/** Epoch ms at which the goal is reached, or null if there is no goal. */
export function goalReachedAt(session) {
  if (isOpenEnded(session)) return null;
  return session.startedAt + session.targetMs;
}

/** "16:32:05" — hours are unbounded, so a 30-hour fast reads "30:00:00". */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

const pad = (n) => String(n).padStart(2, '0');

function cryptoId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `fast_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
