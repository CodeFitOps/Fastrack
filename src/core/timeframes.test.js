import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIMEFRAMES,
  resolveWindow,
  eventsInWindow,
  sessionsInWindow,
  fastingAt,
  fastedMsInWindow,
  summariseWindow,
  splitByDay,
  relativeDayKey,
  positionInWindow,
  startOfLocalDay,
  addDays,
} from './timeframes.js';
import { createEvent } from './events.js';

const H = 3600_000;

/** Referencia fija: 10:00 de un miércoles local. */
const NOW = new Date(2026, 6, 15, 10, 0, 0).getTime();
const TODAY = startOfLocalDay(NOW);

const at = (dayOffset, hour, min = 0) => addDays(TODAY, -dayOffset) + hour * H + min * 60_000;

test('«hoy» va de medianoche a medianoche, no hasta ahora mismo', () => {
  const w = resolveWindow('today', NOW);
  assert.equal(w.from, TODAY);
  assert.equal(w.to, addDays(TODAY, 1));
});

test('«últimas 24 h» es rodante y sí depende de la hora actual', () => {
  const w = resolveWindow('rolling24h', NOW);
  assert.equal(w.from, NOW - 24 * H);
  assert.ok(w.to > NOW);
});

test('la cena de ayer entra en las últimas 24 h pero no en «hoy»', () => {
  // Es la diferencia que importa: esa cena cerró el ayuno anterior.
  const cena = createEvent({ kind: 'meal', value: 700, at: at(1, 21) });
  assert.equal(eventsInWindow([cena], resolveWindow('today', NOW)).length, 0);
  assert.equal(eventsInWindow([cena], resolveWindow('rolling24h', NOW)).length, 1);
});

test('un día suelto se resuelve por su fecha', () => {
  const w = resolveWindow({ dayTs: at(3, 15) }, NOW);
  assert.equal(w.from, addDays(TODAY, -3));
  assert.equal(w.to, addDays(TODAY, -2));
});

test('un rango a medida se acepta tal cual', () => {
  const w = resolveWindow({ from: at(2, 0), to: at(0, 12) }, NOW);
  assert.equal(w.from, at(2, 0));
  assert.equal(w.id, 'custom');
});

test('un rango invertido se rechaza en vez de devolver nada en silencio', () => {
  assert.throws(() => resolveWindow({ from: NOW, to: NOW - H }, NOW), RangeError);
  assert.throws(() => resolveWindow('el martes pasado', NOW), RangeError);
});

test('los eventos salen en orden cronológico', () => {
  const events = [
    createEvent({ kind: 'ketones', value: 1.2, at: at(0, 9) }),
    createEvent({ kind: 'water', value: 500, at: at(0, 7) }),
    createEvent({ kind: 'mood', label: 'Normal', at: at(0, 8) }),
  ];
  const got = eventsInWindow(events, resolveWindow('today', NOW));
  assert.deepEqual(got.map((e) => e.kind), ['water', 'mood', 'ketones']);
});

test('un ayuno empezado ayer aparece en la ventana de hoy', () => {
  // Filtrar por startedAt lo escondería justo el día en que se está haciendo.
  const s = { id: 's', startedAt: at(1, 20), endedAt: at(0, 12), targetMs: 16 * H };
  const found = sessionsInWindow([s], resolveWindow('today', NOW), NOW);
  assert.equal(found.length, 1);
});

test('un ayuno en curso sin cerrar cuenta en la ventana', () => {
  const s = { id: 's', startedAt: at(0, 6), endedAt: null, targetMs: 16 * H };
  assert.equal(sessionsInWindow([s], resolveWindow('today', NOW), NOW).length, 1);
});

test('fastingAt dice si había ayuno en un instante dado', () => {
  const s = { id: 's', startedAt: at(1, 20), endedAt: at(0, 12), targetMs: 16 * H };
  assert.equal(fastingAt([s], at(0, 8), NOW)?.id, 's');
  assert.equal(fastingAt([s], at(0, 14), NOW), null);
  assert.equal(fastingAt([s], at(1, 19), NOW), null);
});

test('las horas ayunadas dentro de la ventana se recortan a la ventana', () => {
  // 20:00 ayer → 12:00 hoy son 16h, pero sólo 12h caen dentro de «hoy».
  const s = { id: 's', startedAt: at(1, 20), endedAt: at(0, 12), targetMs: 16 * H };
  assert.equal(fastedMsInWindow([s], resolveWindow('today', NOW), NOW), 12 * H);
});

test('el resumen agrupa por tipo y suma los valores', () => {
  const events = [
    createEvent({ kind: 'water', value: 500, at: at(0, 7) }),
    createEvent({ kind: 'water', value: 750, at: at(0, 9) }),
    createEvent({ kind: 'ketones', value: 1.4, at: at(0, 8) }),
  ];
  const s = summariseWindow(events, resolveWindow('today', NOW), { now: NOW });
  assert.equal(s.count, 3);
  const agua = s.kinds.find((k) => k.kind === 'water');
  assert.equal(agua.count, 2);
  assert.equal(agua.total, 1250);
  assert.equal(agua.unit, 'ml');
});

test('el resumen no inventa tipos vacíos', () => {
  const s = summariseWindow([createEvent({ kind: 'water', value: 500, at: at(0, 7) })],
    resolveWindow('today', NOW), { now: NOW });
  assert.equal(s.kinds.length, 1);
});

test('una ventana sin nada resume a cero sin romper', () => {
  const s = summariseWindow([], resolveWindow('today', NOW), { now: NOW });
  assert.equal(s.count, 0);
  assert.deepEqual(s.kinds, []);
  assert.equal(s.fastedMs, 0);
});

test('splitByDay reparte por días naturales, el más reciente primero', () => {
  const events = [
    createEvent({ kind: 'water', value: 500, at: at(0, 9) }),
    createEvent({ kind: 'meal', value: 600, at: at(1, 21) }),
    createEvent({ kind: 'meal', value: 700, at: at(3, 13) }),
  ];
  const days = splitByDay(events, resolveWindow('week', NOW), { now: NOW });
  assert.equal(days.length, 3);
  assert.ok(days[0].dayTs > days[1].dayTs);
  // La etiqueta ya no se genera aquí: el módulo devuelve la clave y la UI la
  // traduce, para que «Hoy» / «Today» dependa del idioma elegido.
  assert.equal(relativeDayKey(days[0].dayTs, NOW), 'journal.today');
  assert.equal(relativeDayKey(days[1].dayTs, NOW), 'journal.yesterday');
  assert.equal(relativeDayKey(days[2].dayTs, NOW), null); // más atrás, fecha normal
});

test('los días vacíos se omiten salvo que se pidan', () => {
  const events = [createEvent({ kind: 'water', value: 500, at: at(0, 9) })];
  assert.equal(splitByDay(events, resolveWindow('week', NOW)).length, 1);
  assert.equal(splitByDay(events, resolveWindow('week', NOW), { includeEmpty: true }).length, 7);
});

test('un evento que cruza a la madrugada cae en su día natural', () => {
  const madrugada = createEvent({ kind: 'mood', labelKey: 'mood.tired', at: at(0, 1, 30) });
  const days = splitByDay([madrugada], resolveWindow('today', NOW));
  assert.equal(days.length, 1);
  assert.equal(days[0].dayTs, TODAY);
});

test('positionInWindow sitúa un instante en el eje', () => {
  const w = resolveWindow('today', NOW);
  assert.equal(positionInWindow(TODAY, w), 0);
  assert.equal(positionInWindow(TODAY + 12 * H, w), 0.5);
  assert.equal(positionInWindow(TODAY - 5 * H, w), 0); // recortado, no negativo
});

test('todos los tramos predefinidos se resuelven', () => {
  for (const id of Object.keys(TIMEFRAMES)) {
    const w = resolveWindow(id, NOW);
    assert.ok(w.to > w.from, `${id} produce un rango válido`);
  }
});
