/**
 * Ventanas temporales sobre el registro de eventos.
 *
 * El registro es una lista plana de eventos fechados. Este módulo es la capa que
 * permite leerla por cualquier tramo: el día de hoy, las últimas 24 horas, la
 * semana, o un rango a medida.
 *
 * «Hoy» y «últimas 24 h» NO son lo mismo, y en una app de ayuno la diferencia
 * importa: a las 10:00, «hoy» empieza hace diez horas y se pierde la cena de
 * ayer, que es justo el evento que cerró el ayuno anterior. Por eso están los
 * dos, y el día natural no es el único modo.
 */

const H = 3600_000;
const DAY = 24 * H;

export function startOfLocalDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(ts, n) {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/**
 * Tramos predefinidos.
 *
 * `anchored: true` = alineado al día natural local. `false` = ventana rodante
 * que termina ahora mismo.
 */
export const TIMEFRAMES = {
  today: { id: 'today', labelKey: 'journal.frame.today', anchored: true, days: 1 },
  rolling24h: { id: 'rolling24h', labelKey: 'journal.frame.rolling24h', anchored: false, ms: DAY },
  rolling48h: { id: 'rolling48h', labelKey: 'journal.frame.rolling48h', anchored: false, ms: 2 * DAY },
  week: { id: 'week', labelKey: 'journal.frame.week', anchored: true, days: 7 },
  month: { id: 'month', labelKey: 'journal.frame.month', anchored: true, days: 30 },
};

export const TIMEFRAME_IDS = Object.keys(TIMEFRAMES);

/**
 * Convierte un tramo en un rango concreto `{ from, to }`, con `to` exclusivo.
 *
 * Acepta:
 *   - un id de TIMEFRAMES            → resolveWindow('today')
 *   - `{ from, to }` a medida        → resolveWindow({ from: a, to: b })
 *   - `{ dayTs }` para un día suelto → resolveWindow({ dayTs: martes })
 *
 * Los tramos anclados terminan al final del día de hoy, no en `now`, para que un
 * evento fechado más tarde hoy (o una comida anotada a futuro por error) no
 * desaparezca de la vista.
 */
export function resolveWindow(spec, now = Date.now()) {
  if (typeof spec === 'string') {
    const tf = TIMEFRAMES[spec];
    if (!tf) throw new RangeError(`Tramo desconocido: ${spec}`);
    return resolveWindow(tf, now);
  }

  if (spec?.dayTs != null) {
    const from = startOfLocalDay(spec.dayTs);
    return { from, to: addDays(from, 1), dayTs: from, id: 'day' };
  }

  if (spec?.from != null && spec?.to != null) {
    if (spec.to <= spec.from) throw new RangeError('El final del rango debe ir después del inicio');
    return { from: spec.from, to: spec.to, id: 'custom' };
  }

  if (spec?.anchored) {
    const endOfToday = addDays(startOfLocalDay(now), 1);
    return {
      from: addDays(endOfToday, -spec.days),
      to: endOfToday,
      labelKey: spec.labelKey,
      id: spec.id,
    };
  }

  if (spec?.ms != null) {
    return { from: now - spec.ms, to: now + 1, labelKey: spec.labelKey, id: spec.id };
  }

  throw new RangeError('No se puede interpretar el tramo');
}

/** Eventos dentro de la ventana, en orden cronológico. */
export function eventsInWindow(events, window) {
  return events
    .filter((e) => e.at >= window.from && e.at < window.to)
    .sort((a, b) => a.at - b.at);
}

/**
 * Ayunos que se solapan con la ventana, aunque empiecen antes o acaben después.
 *
 * Un 16:8 empezado a las 20:00 de ayer cae dentro de «hoy» aunque su `startedAt`
 * no lo esté; filtrarlo por la hora de inicio lo escondería justo el día en que
 * la persona lo estaba haciendo.
 */
export function sessionsInWindow(sessions, window, now = Date.now()) {
  return sessions
    .filter((s) => {
      const end = s.endedAt ?? now;
      return s.startedAt < window.to && end >= window.from;
    })
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** ¿Había un ayuno en curso en ese instante? Devuelve la sesión, o null. */
export function fastingAt(sessions, ts, now = Date.now()) {
  return sessions.find((s) => ts >= s.startedAt && ts < (s.endedAt ?? now)) ?? null;
}

/** Milisegundos ayunados dentro de la ventana, sumando solapes. */
export function fastedMsInWindow(sessions, window, now = Date.now()) {
  return sessions.reduce((sum, s) => {
    const start = Math.max(s.startedAt, window.from);
    const end = Math.min(s.endedAt ?? now, window.to);
    return sum + Math.max(0, end - start);
  }, 0);
}

/**
 * Resumen de la ventana: qué se registró, cuánto y de qué tipo.
 * Sólo aparecen los tipos que tienen algo — un resumen lleno de ceros no dice
 * nada y empuja a "rellenar huecos", que no es el objetivo.
 */
export function summariseWindow(events, window, { sessions = [], now = Date.now() } = {}) {
  const inWindow = eventsInWindow(events, window);
  const byKind = new Map();

  for (const e of inWindow) {
    if (!byKind.has(e.kind)) {
      byKind.set(e.kind, { kind: e.kind, count: 0, total: 0, hasValues: false, unit: e.unit, last: null });
    }
    const agg = byKind.get(e.kind);
    agg.count++;
    if (e.value != null) {
      agg.total += e.value;
      agg.hasValues = true;
      agg.unit = agg.unit ?? e.unit;
    }
    agg.last = e;
  }

  return {
    window,
    events: inWindow,
    count: inWindow.length,
    kinds: [...byKind.values()].sort((a, b) => b.count - a.count),
    sessions: sessionsInWindow(sessions, window, now),
    fastedMs: fastedMsInWindow(sessions, window, now),
  };
}

/**
 * Parte la ventana en días naturales, del más reciente al más antiguo.
 * Es la forma que necesita una vista de diario que cubra varios días.
 *
 * Los días vacíos se omiten por defecto; con `includeEmpty` se conservan, que es
 * lo que quiere una rejilla de constancia.
 */
export function splitByDay(events, window, { includeEmpty = false, now = Date.now() } = {}) {
  const inWindow = eventsInWindow(events, window);
  const days = [];

  const firstDay = startOfLocalDay(window.from);
  const lastDay = startOfLocalDay(window.to - 1);

  for (let dayTs = lastDay; dayTs >= firstDay; dayTs = addDays(dayTs, -1)) {
    const dayEnd = addDays(dayTs, 1);
    const dayEvents = inWindow.filter((e) => e.at >= dayTs && e.at < dayEnd);
    if (dayEvents.length === 0 && !includeEmpty) continue;
    days.push({ dayTs, events: dayEvents });
  }

  return days;
}

/** Posición 0..1 de un instante dentro de la ventana, para situarlo en un eje. */
export function positionInWindow(ts, window) {
  const span = Math.max(1, window.to - window.from);
  return Math.min(1, Math.max(0, (ts - window.from) / span));
}

/**
 * ¿Es hoy o ayer? La etiqueta se traduce en la UI; aquí sólo se decide cuál.
 * `now` se pasa siempre en vez de leer el reloj dentro, para poder probarlo con
 * fechas fijas.
 */
export function relativeDayKey(ts, now = Date.now()) {
  const today = startOfLocalDay(now);
  if (ts === today) return 'journal.today';
  if (ts === addDays(today, -1)) return 'journal.yesterday';
  return null;
}
