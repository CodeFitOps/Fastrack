/**
 * Registro de eventos con marca de tiempo.
 *
 * El modelo anterior guardaba `kcal`, `ketones` y `water` como campos sueltos de
 * la sesión: un valor por ayuno, sin hora. Eso sólo sirve si registras al
 * terminar. Aquí un evento es una entrada independiente con su propio `at`, así
 * que se puede ver a qué hora exacta se midió cada cosa.
 *
 * Decisión de diseño: los eventos NO cuelgan de la sesión.
 *
 * Una comida ocurre por definición fuera del ayuno, en la ventana de comer. Si
 * los eventos fueran hijos de una sesión, no habría dónde guardarla. Así que un
 * evento se guarda siempre, y lleva `sessionId` sólo si había un ayuno activo en
 * ese momento. Eso permite dos lecturas: la línea de tiempo de un ayuno concreto
 * y la línea de tiempo continua del día, que es la que enseña el patrón real —
 * cuándo comes, cuándo entrenas, cuándo suben las cetonas.
 */

/**
 * @typedef {Object} LogEvent
 * @property {string} id
 * @property {number} at            epoch ms — cuándo ocurrió, no cuándo se registró
 * @property {string} kind
 * @property {string|null} sessionId  ayuno activo en ese momento, si lo había
 * @property {number} [value]       magnitud, según el tipo
 * @property {string} [unit]
 * @property {string} [label]
 * @property {string} [note]
 * @property {number} [loggedAt]    cuándo se tecleó, si difiere de `at`
 */

/**
 * Tipos de evento.
 *
 * `numeric: true` significa que el valor entra en gráficas; los demás son
 * marcas en la línea de tiempo. `breaksFast` marca los que son incompatibles
 * con estar ayunando — sirve para avisar, no para bloquear: la persona sabe
 * mejor que la app lo que ha hecho.
 */
export const EVENT_KINDS = {
  meal: {
    labelKey: 'event.meal',
    numeric: true,
    unit: 'kcal',
    breaksFast: true,
    placeholderKey: 'event.meal.placeholder',
  },
  ketones: {
    labelKey: 'event.ketones',
    numeric: true,
    unit: 'mmol/L',
    step: 0.1,
    min: 0,
    max: 10,
    breaksFast: false,
  },
  glucose: {
    labelKey: 'event.glucose',
    numeric: true,
    unit: 'mg/dL',
    step: 1,
    min: 0,
    max: 500,
    breaksFast: false,
  },
  weight: {
    labelKey: 'event.weight',
    numeric: true,
    unit: 'kg',
    step: 0.1,
    min: 0,
    breaksFast: false,
  },
  water: {
    labelKey: 'event.water',
    numeric: true,
    unit: 'ml',
    step: 50,
    min: 0,
    breaksFast: false,
  },
  workout: {
    labelKey: 'event.workout',
    numeric: true,
    unit: 'min',
    step: 5,
    min: 0,
    breaksFast: false,
    placeholderKey: 'event.workout.placeholder',
  },
  mood: {
    labelKey: 'event.mood',
    numeric: false,
    breaksFast: false,
    // Escala corta y concreta. Incluye los estados difíciles a propósito: si
    // sólo se pudieran registrar sensaciones buenas, el historial dejaría de
    // servir para decidir si un protocolo sienta mal.
    // Se guarda la CLAVE, no el texto: así una sensación anotada en español
    // sigue leyéndose bien si luego se cambia la app a inglés.
    optionKeys: [
      'mood.energetic',
      'mood.focused',
      'mood.normal',
      'mood.hungry',
      'mood.tired',
      'mood.dizzy',
      'mood.irritable',
    ],
  },
  note: {
    labelKey: 'event.note',
    numeric: false,
    breaksFast: false,
    placeholderKey: 'event.note.placeholder',
  },
};

export const EVENT_KIND_IDS = Object.keys(EVENT_KINDS);

/**
 * Crea un evento.
 *
 * `at` por defecto es ahora, pero se puede pasar hacia atrás: si te acuerdas a
 * las 22:00 de que mediste cetonas a las 18:30, lo que importa para la gráfica
 * es 18:30. En ese caso se guarda también `loggedAt`, porque un valor anotado de
 * memoria tres horas después no merece la misma confianza que uno anotado en el
 * momento.
 *
 * @returns {LogEvent}
 */
export function createEvent({
  kind,
  at = Date.now(),
  value,
  label,
  labelKey,
  note,
  sessionId = null,
  now = Date.now(),
  id = eventId(),
}) {
  const def = EVENT_KINDS[kind];
  if (!def) throw new RangeError(`Tipo de evento desconocido: ${kind}`);

  if (def.numeric && value != null) {
    if (!Number.isFinite(value)) throw new RangeError(`${kind} necesita un valor numérico`);
    if (def.min != null && value < def.min) throw new RangeError(`${kind} por debajo del mínimo`);
    if (def.max != null && value > def.max) throw new RangeError(`${kind} por encima del máximo`);
  }

  const event = { id, kind, at, sessionId };
  if (value != null) {
    event.value = value;
    if (def.unit) event.unit = def.unit;
  }
  // `labelKey` para valores de una lista fija (sensaciones): se guarda la clave
  // y se traduce al mostrar, así un registro hecho en español sigue leyéndose
  // en inglés si se cambia el idioma. `label` para texto libre del usuario, que
  // no se traduce nunca.
  if (labelKey) event.labelKey = labelKey;
  if (label) event.label = label;
  if (note) event.note = note;
  // Sólo se anota si difiere de forma apreciable, para no ensuciar cada entrada.
  if (Math.abs(now - at) > 60_000) event.loggedAt = now;

  return event;
}

/** ¿Se registró bastante después de ocurrir? Útil para marcarlo en la UI. */
export function isBackdated(event) {
  return event.loggedAt != null;
}

/** Eventos dentro de [from, to), ordenados por hora ascendente. */
export function eventsBetween(events, from, to) {
  return events
    .filter((e) => e.at >= from && e.at < to)
    .sort((a, b) => a.at - b.at);
}

/**
 * Eventos que caen dentro de una sesión, por ventana temporal y no por
 * `sessionId`. Así aparecen también los registrados antes de que existiera este
 * modelo, o los que se fecharon hacia atrás dentro del ayuno.
 */
export function eventsDuring(events, session, now = Date.now()) {
  const end = session.endedAt ?? now;
  return eventsBetween(events, session.startedAt, end + 1);
}

/** Serie numérica de un tipo, lista para dibujar. Ordenada, sin huecos nulos. */
export function series(events, kind, { from = -Infinity, to = Infinity } = {}) {
  return events
    .filter((e) => e.kind === kind && e.value != null && e.at >= from && e.at < to)
    .sort((a, b) => a.at - b.at)
    .map((e) => ({ at: e.at, value: e.value }));
}

/** El valor más reciente de un tipo, o null. */
export function latest(events, kind, { at = Infinity } = {}) {
  const s = series(events, kind, { to: at });
  return s.length ? s[s.length - 1] : null;
}

/**
 * Posición de un evento dentro de una sesión, 0..1, para colocarlo en la línea
 * de tiempo. Se mide contra la duración real transcurrida, no contra el
 * objetivo, para que un ayuno pasado de objetivo no empuje eventos fuera del
 * gráfico.
 */
export function positionInSession(event, session, now = Date.now()) {
  const end = session.endedAt ?? now;
  const span = Math.max(1, end - session.startedAt);
  return Math.min(1, Math.max(0, (event.at - session.startedAt) / span));
}

/** Agrupa por día local, más reciente primero. Es la forma de la vista diaria. */
export function groupByDay(events) {
  const byDay = new Map();
  for (const e of events) {
    const d = new Date(e.at);
    d.setHours(0, 0, 0, 0);
    const key = d.getTime();
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(e);
  }
  return [...byDay.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([dayTs, list]) => ({ dayTs, events: list.sort((a, b) => a.at - b.at) }));
}

/** Suma de los valores de un tipo en un rango. Para "kcal de hoy", "agua de hoy". */
export function totalFor(events, kind, { from = -Infinity, to = Infinity } = {}) {
  return series(events, kind, { from, to }).reduce((sum, p) => sum + p.value, 0);
}

/**
 * Migración de los campos sueltos del modelo anterior.
 *
 * Las sesiones guardadas llevaban kcal/ketones/water sin hora. No se puede
 * inventar una, así que se fechan al final del ayuno y se marcan con
 * `migrated: true` — quedan en la línea de tiempo, pero se distinguen de una
 * medición real y no ensucian una gráfica de cetonas por horas.
 */
export function migrateSessionFields(session) {
  const out = [];
  const at = session.endedAt ?? session.startedAt;
  const base = { sessionId: session.id ?? null, at, now: at };

  if (session.kcal != null) {
    out.push({ ...createEvent({ kind: 'meal', value: Number(session.kcal), ...base }), migrated: true });
  }
  if (session.ketones != null) {
    out.push({ ...createEvent({ kind: 'ketones', value: Number(session.ketones), ...base }), migrated: true });
  }
  if (session.water != null) {
    const ml = typeof session.water === 'number' ? session.water : parseWater(session.water);
    if (ml != null) {
      out.push({ ...createEvent({ kind: 'water', value: ml, ...base }), migrated: true });
    }
  }
  if (session.note) {
    out.push({ ...createEvent({ kind: 'note', note: session.note, ...base }), migrated: true });
  }
  return out;
}

/** '2.4L' / '800ml' → mililitros. Devuelve null si no se entiende. */
function parseWater(text) {
  const m = String(text).trim().match(/^([\d.]+)\s*(l|ml)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return (m[2] ?? '').toLowerCase() === 'ml' ? n : n * 1000;
}

function eventId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `ev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
