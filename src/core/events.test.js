import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_KINDS,
  createEvent,
  isBackdated,
  eventsBetween,
  eventsDuring,
  series,
  latest,
  positionInSession,
  groupByDay,
  totalFor,
  migrateSessionFields,
} from './events.js';

const H = 3600_000;
const T0 = new Date(2026, 6, 15, 20, 0, 0).getTime(); // 20:00 local

const session = { id: 's1', startedAt: T0, targetMs: 16 * H, endedAt: T0 + 16 * H };

test('un evento guarda la hora en que ocurrió, no en que se registró', () => {
  const at = T0 + 5 * H;
  const e = createEvent({ kind: 'ketones', value: 1.2, at, now: at + 3 * H });
  assert.equal(e.at, at);
  assert.equal(e.loggedAt, at + 3 * H);
  assert.equal(isBackdated(e), true);
});

test('registrar en el momento no ensucia la entrada con loggedAt', () => {
  const e = createEvent({ kind: 'ketones', value: 1.2, at: T0, now: T0 + 5_000 });
  assert.equal(e.loggedAt, undefined);
  assert.equal(isBackdated(e), false);
});

test('una comida se puede registrar sin ayuno activo', () => {
  // Es el caso normal: se come en la ventana de comer, no ayunando.
  const e = createEvent({ kind: 'meal', value: 620, label: 'Pollo y arroz', sessionId: null });
  assert.equal(e.sessionId, null);
  assert.equal(e.value, 620);
  assert.equal(e.unit, 'kcal');
});

test('un tipo desconocido se rechaza al crear', () => {
  assert.throws(() => createEvent({ kind: 'teletransporte' }), RangeError);
});

test('un valor fuera de rango se rechaza', () => {
  assert.throws(() => createEvent({ kind: 'ketones', value: 99 }), RangeError);
  assert.throws(() => createEvent({ kind: 'ketones', value: -1 }), RangeError);
  assert.throws(() => createEvent({ kind: 'ketones', value: NaN }), RangeError);
});

test('un evento sin valor es válido — una sensación no es un número', () => {
  const e = createEvent({ kind: 'mood', labelKey: 'mood.hungry' });
  assert.equal(e.value, undefined);
  assert.equal(e.labelKey, 'mood.hungry');
});

test('eventsDuring encuentra los eventos por ventana, no por sessionId', () => {
  const dentro = createEvent({ kind: 'ketones', value: 0.8, at: T0 + 3 * H, sessionId: null });
  const fuera = createEvent({ kind: 'meal', value: 500, at: T0 - 2 * H });
  const found = eventsDuring([dentro, fuera], session);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, dentro.id);
});

test('eventsDuring incluye el evento justo al cerrar el ayuno', () => {
  const alFinal = createEvent({ kind: 'meal', value: 700, at: session.endedAt });
  assert.equal(eventsDuring([alFinal], session).length, 1);
});

test('series devuelve puntos ordenados por hora', () => {
  const events = [
    createEvent({ kind: 'ketones', value: 1.8, at: T0 + 12 * H }),
    createEvent({ kind: 'ketones', value: 0.4, at: T0 + 2 * H }),
    createEvent({ kind: 'ketones', value: 1.1, at: T0 + 7 * H }),
    createEvent({ kind: 'mood', labelKey: 'mood.normal', at: T0 + 8 * H }),
  ];
  const s = series(events, 'ketones');
  assert.deepEqual(s.map((p) => p.value), [0.4, 1.1, 1.8]);
});

test('latest devuelve la última medición hasta un momento dado', () => {
  const events = [
    createEvent({ kind: 'ketones', value: 0.4, at: T0 + 2 * H }),
    createEvent({ kind: 'ketones', value: 1.8, at: T0 + 12 * H }),
  ];
  assert.equal(latest(events, 'ketones').value, 1.8);
  assert.equal(latest(events, 'ketones', { at: T0 + 5 * H }).value, 0.4);
  assert.equal(latest(events, 'weight'), null);
});

test('la posición en la sesión se mide contra el tiempo real, no el objetivo', () => {
  const mitad = createEvent({ kind: 'mood', labelKey: 'mood.normal', at: T0 + 8 * H });
  assert.equal(positionInSession(mitad, session), 0.5);

  // Ayuno pasado de objetivo: un evento al final sigue cayendo dentro del gráfico.
  const largo = { ...session, endedAt: T0 + 24 * H };
  const tarde = createEvent({ kind: 'mood', labelKey: 'mood.tired', at: T0 + 24 * H });
  assert.equal(positionInSession(tarde, largo), 1);
});

test('groupByDay agrupa por día local, el más reciente primero', () => {
  const events = [
    createEvent({ kind: 'water', value: 500, at: T0 }),
    createEvent({ kind: 'water', value: 300, at: T0 + 6 * H }), // pasa de medianoche
    createEvent({ kind: 'water', value: 250, at: T0 + 30 * H }),
  ];
  const days = groupByDay(events);
  assert.equal(days.length, 3);
  assert.ok(days[0].dayTs > days[1].dayTs);
});

test('totalFor suma sólo el tipo pedido', () => {
  const events = [
    createEvent({ kind: 'water', value: 500, at: T0 }),
    createEvent({ kind: 'water', value: 750, at: T0 + H }),
    createEvent({ kind: 'meal', value: 600, at: T0 + 2 * H }),
  ];
  assert.equal(totalFor(events, 'water'), 1250);
  assert.equal(totalFor(events, 'meal'), 600);
  assert.equal(totalFor(events, 'workout'), 0);
});

/* ---- migración desde el modelo anterior ---- */

test('los campos sueltos de una sesión antigua se convierten en eventos', () => {
  const vieja = { id: 's0', startedAt: T0, endedAt: T0 + 16 * H, kcal: 640, ketones: 1.4, water: '2.4L' };
  const events = migrateSessionFields(vieja);
  const kinds = events.map((e) => e.kind).sort();
  assert.deepEqual(kinds, ['ketones', 'meal', 'water']);
  assert.equal(events.every((e) => e.at === vieja.endedAt), true);
  assert.equal(events.every((e) => e.migrated === true), true);
  assert.equal(events.find((e) => e.kind === 'water').value, 2400);
});

test('la migración entiende ml además de litros', () => {
  const events = migrateSessionFields({ id: 's', startedAt: T0, endedAt: T0 + H, water: '800ml' });
  assert.equal(events[0].value, 800);
});

test('una cantidad de agua ininteligible se descarta en vez de inventarse', () => {
  const events = migrateSessionFields({ id: 's', startedAt: T0, endedAt: T0 + H, water: 'bastante' });
  assert.equal(events.length, 0);
});

test('una sesión sin campos extra no genera eventos', () => {
  assert.deepEqual(migrateSessionFields({ id: 's', startedAt: T0, endedAt: T0 + H }), []);
});

test('la escala de sensaciones incluye estados difíciles, no sólo buenos', () => {
  // Si sólo se pudieran registrar sensaciones positivas, el historial no
  // serviría para detectar que un protocolo sienta mal.
  const opciones = EVENT_KINDS.mood.optionKeys;
  for (const dificil of ['mood.hungry', 'mood.tired', 'mood.dizzy', 'mood.irritable']) {
    assert.ok(opciones.includes(dificil), `falta "${dificil}"`);
  }
});

test('una sensación guarda la clave, no el texto traducido', () => {
  // Guardar "Con hambre" ataría el registro al idioma en que se anotó.
  const e = createEvent({ kind: 'mood', labelKey: 'mood.hungry' });
  assert.equal(e.labelKey, 'mood.hungry');
  assert.equal(e.label, undefined);
});

test('el texto libre se guarda tal cual y no se traduce', () => {
  const e = createEvent({ kind: 'meal', value: 350, label: '2 huevos, medio aguacate' });
  assert.equal(e.label, '2 huevos, medio aguacate');
  assert.equal(e.labelKey, undefined);
});
