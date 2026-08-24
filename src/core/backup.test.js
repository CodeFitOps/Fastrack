import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_FORMAT,
  SUPPORTED_SCHEMA,
  buildBackup,
  serializeBackup,
  backupFilename,
  parseBackup,
  mergeBackup,
} from './backup.js';

const H = 3600_000;
const T0 = new Date(2026, 6, 15, 8, 0, 0).getTime();

const sesion = (id, offsetH, durH) => ({
  id,
  startedAt: T0 + offsetH * H,
  endedAt: T0 + (offsetH + durH) * H,
  targetMs: 16 * H,
});

const evento = (id, offsetH, kind = 'water', value = 500) => ({
  id,
  at: T0 + offsetH * H,
  kind,
  value,
  sessionId: null,
});

test('una copia lleva formato, esquema y fecha', () => {
  const b = buildBackup({ activeFast: null, history: [], events: [] }, { now: T0 });
  assert.equal(b.format, BACKUP_FORMAT);
  assert.equal(b.schema, SUPPORTED_SCHEMA);
  assert.equal(b.exportedAt, T0);
});

test('el ayuno en curso viaja en la copia', () => {
  // Cambiar de dispositivo a mitad de un ayuno de 20 h y perderlo sería el peor
  // momento posible.
  const activo = { id: 'run', startedAt: T0, targetMs: 20 * H, endedAt: null };
  const b = buildBackup({ activeFast: activo, history: [], events: [] });
  assert.equal(b.activeFast.id, 'run');
});

test('exportar e importar da exactamente lo mismo', () => {
  const original = buildBackup({
    activeFast: null,
    history: [sesion('a', 0, 16)],
    events: [evento('e1', 2)],
  }, { now: T0 });

  const { backup, error } = parseBackup(serializeBackup(original));
  assert.equal(error, undefined);
  assert.deepEqual(backup.history, original.history);
  assert.deepEqual(backup.events, original.events);
});

test('el nombre del fichero lleva fecha y hora, para no pisar copias', () => {
  assert.equal(backupFilename(T0), 'fastrack-20260715-0800.json');
});

/* ── validación ── */

test('un fichero que no es JSON se rechaza con un motivo', () => {
  assert.equal(parseBackup('esto no es json').error, 'backup.notJson');
});

test('un JSON que no es una copia se rechaza', () => {
  assert.equal(parseBackup('{"hola":1}').error, 'backup.wrongFormat');
  assert.equal(parseBackup('[1,2,3]').error, 'backup.notBackup');
  assert.equal(parseBackup('null').error, 'backup.notBackup');
});

test('una copia de una versión futura se rechaza en vez de importarse a medias', () => {
  const futura = JSON.stringify({ format: BACKUP_FORMAT, schema: 99, history: [], events: [] });
  assert.equal(parseBackup(futura).error, 'backup.tooNew');
});

test('las entradas corruptas se descartan sin tirar el resto', () => {
  const mezcla = JSON.stringify({
    format: BACKUP_FORMAT,
    schema: SUPPORTED_SCHEMA,
    history: [sesion('buena', 0, 16), { startedAt: 'ayer' }, null],
    events: [evento('ok', 1), { kind: 'water' }, { at: 5 }],
  });
  const { backup } = parseBackup(mezcla);
  assert.equal(backup.history.length, 1);
  assert.equal(backup.events.length, 1);
});

/* ── fusión ── */

test('importar añade lo que falta sin borrar lo que ya había', () => {
  const actual = { activeFast: null, history: [sesion('a', 0, 16)], events: [evento('e1', 1)] };
  const copia = { activeFast: null, history: [sesion('b', 24, 18)], events: [evento('e2', 25)] };

  const r = mergeBackup(actual, copia);
  assert.equal(r.history.length, 2);
  assert.equal(r.events.length, 2);
  assert.equal(r.stats.historyAdded, 1);
  assert.equal(r.stats.eventsAdded, 1);
});

test('importar el mismo fichero dos veces no duplica nada', () => {
  const copia = { activeFast: null, history: [sesion('a', 0, 16)], events: [evento('e1', 1)] };
  const primera = mergeBackup({ activeFast: null, history: [], events: [] }, copia);
  const segunda = mergeBackup(primera, copia);

  assert.equal(segunda.history.length, 1);
  assert.equal(segunda.events.length, 1);
  assert.equal(segunda.stats.historySkipped, 1);
  assert.equal(segunda.stats.eventsSkipped, 1);
});

test('ante el mismo id gana lo que ya está en el dispositivo', () => {
  // Lo importado se exportó antes, así que sobrescribir podría revertir una
  // corrección hecha después.
  const local = { ...sesion('a', 0, 16), note: 'corregido aquí' };
  const antiguo = { ...sesion('a', 0, 16), note: 'versión vieja' };

  const r = mergeBackup(
    { activeFast: null, history: [local], events: [] },
    { activeFast: null, history: [antiguo], events: [] }
  );
  assert.equal(r.history.length, 1);
  assert.equal(r.history[0].note, 'corregido aquí');
});

test('las entradas sin id se deduplican por contenido', () => {
  const sinId = { startedAt: T0, endedAt: T0 + 16 * H, targetMs: 16 * H };
  const r = mergeBackup(
    { activeFast: null, history: [sinId], events: [] },
    { activeFast: null, history: [{ ...sinId }], events: [] }
  );
  assert.equal(r.history.length, 1);
  assert.equal(r.stats.historySkipped, 1);
});

test('un ayuno en curso en el dispositivo nunca se pisa al importar', () => {
  const enCurso = { id: 'mio', startedAt: T0, targetMs: 16 * H, endedAt: null };
  const otro = { id: 'otro', startedAt: T0 - 5 * H, targetMs: 20 * H, endedAt: null };

  const r = mergeBackup(
    { activeFast: enCurso, history: [], events: [] },
    { activeFast: otro, history: [], events: [] }
  );
  assert.equal(r.activeFast.id, 'mio');
  assert.equal(r.stats.activeFastSkipped, true);
});

test('sin ayuno en curso, el de la copia se adopta', () => {
  const otro = { id: 'otro', startedAt: T0, targetMs: 16 * H, endedAt: null };
  const r = mergeBackup(
    { activeFast: null, history: [], events: [] },
    { activeFast: otro, history: [], events: [] }
  );
  assert.equal(r.activeFast.id, 'otro');
  assert.equal(r.stats.activeFastImported, true);
});

test('el resultado queda ordenado por fecha, no por orden de llegada', () => {
  const r = mergeBackup(
    { activeFast: null, history: [sesion('tarde', 48, 16)], events: [evento('e2', 50)] },
    { activeFast: null, history: [sesion('pronto', 0, 16)], events: [evento('e1', 2)] }
  );
  assert.deepEqual(r.history.map((s) => s.id), ['pronto', 'tarde']);
  assert.deepEqual(r.events.map((e) => e.id), ['e1', 'e2']);
});

test('una lápida viaja en la copia y no resucita el registro al importar', () => {
  const borrado = { id: 'e9', at: T0, kind: 'water', value: 500, deletedAt: T0 + H, updatedAt: T0 + H };
  const { backup } = parseBackup(JSON.stringify({
    format: BACKUP_FORMAT,
    schema: SUPPORTED_SCHEMA,
    history: [],
    events: [borrado],
  }));
  assert.equal(backup.events.length, 1);
  assert.equal(backup.events[0].deletedAt, T0 + H);
});

test('importar en un dispositivo vacío trae todo', () => {
  const copia = {
    activeFast: null,
    history: [sesion('a', 0, 16), sesion('b', 24, 18)],
    events: [evento('e1', 1), evento('e2', 25)],
  };
  const r = mergeBackup({ activeFast: null, history: [], events: [] }, copia);
  assert.equal(r.history.length, 2);
  assert.equal(r.events.length, 2);
  assert.equal(r.stats.historySkipped, 0);
});
