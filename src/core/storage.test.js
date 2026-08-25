/**
 * Persistencia: guardar y recuperar.
 *
 * Estos tests existen por un fallo real: `loadActiveFast` exigía que `targetMs`
 * fuese `number`, y en un ayuno abierto vale `null`. Como `typeof null` es
 * 'object', la comprobación lo descartaba y el ayuno desaparecía al recargar,
 * sin error ni aviso. Los tests del núcleo pasaban todos, porque el fallo no
 * estaba en la lógica del tiempo sino en la puerta de entrada de los datos.
 *
 * La lección: el ida y vuelta por almacenamiento necesita sus propios tests,
 * con TODAS las formas válidas del dato, no sólo la habitual.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const H = 3600_000;

/** localStorage de mentira, aislado por test. */
function mockBrowser() {
  const store = new Map();
  globalThis.window = {};
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return store;
}

// El módulo lee la plataforma al importarse, así que el mock va antes.
const store = mockBrowser();
const storage = await import('../platform/storage.js');
const { PROTOCOLS } = await import('../core/protocols.js');
const { startFast } = await import('../core/fastSession.js');

test.beforeEach(() => store.clear());

test('la plataforma detectada en un navegador es web', () => {
  assert.equal(storage.platform, 'web');
});

test('todos los protocolos sobreviven a guardar y recuperar', async () => {
  for (const p of PROTOCOLS) {
    store.clear();
    const s = startFast({ targetMs: p.targetMs });
    s.protocolId = p.id;
    await storage.saveActiveFast(s);

    const back = await storage.loadActiveFast();
    assert.ok(back, `el ayuno "${p.id}" se perdió al recargar`);
    assert.equal(back.startedAt, s.startedAt);
    assert.equal(back.targetMs, p.targetMs);
    assert.equal(back.protocolId, p.id);
  }
});

test('un ayuno abierto se recupera con targetMs null, no se descarta', async () => {
  const s = startFast({ targetMs: null });
  await storage.saveActiveFast(s);
  const back = await storage.loadActiveFast();
  assert.ok(back);
  assert.equal(back.targetMs, null);
});

test('sin nada guardado devuelve null', async () => {
  assert.equal(await storage.loadActiveFast(), null);
});

test('los datos corruptos se rechazan en vez de romper el arranque', async () => {
  const basura = [
    'no es json',
    'null',
    '{}',
    '{"startedAt":"ayer","targetMs":1000}',
    '{"startedAt":1000,"targetMs":"16h"}',
    '{"targetMs":1000}',
    '[]',
  ];
  for (const raw of basura) {
    store.clear();
    store.set('fastrack.activeFast', raw);
    assert.equal(await storage.loadActiveFast(), null, `debería rechazar: ${raw}`);
  }
});

test('limpiar el ayuno activo lo borra de verdad', async () => {
  await storage.saveActiveFast(startFast({ targetMs: 16 * H }));
  await storage.clearActiveFast();
  assert.equal(await storage.loadActiveFast(), null);
});

test('los eventos sobreviven al ida y vuelta', async () => {
  const { createEvent } = await import('../core/events.js');
  await storage.appendEvent(createEvent({ kind: 'meal', value: 620, label: 'Cena' }));
  await storage.appendEvent(createEvent({ kind: 'ketones', value: 1.4 }));

  const back = await storage.loadEvents();
  assert.equal(back.length, 2);
  assert.equal(back[0].label, 'Cena');
  assert.equal(back[1].value, 1.4);
});

test('un evento se puede borrar y el resto sigue', async () => {
  const { createEvent } = await import('../core/events.js');
  const uno = createEvent({ kind: 'water', value: 500 });
  const dos = createEvent({ kind: 'water', value: 250 });
  await storage.appendEvent(uno);
  await storage.appendEvent(dos);

  await storage.deleteEvent(uno.id);
  const back = await storage.loadEvents();
  assert.equal(back.length, 1);
  assert.equal(back[0].id, dos.id);
});

test('un registro de eventos corrupto devuelve lista vacía, no rompe', async () => {
  store.set('fastrack.events', '{no json');
  assert.deepEqual(await storage.loadEvents(), []);
});

test('el historial sobrevive y se acumula', async () => {
  await storage.appendToHistory({ id: 'a', startedAt: 1, endedAt: 2 });
  await storage.appendToHistory({ id: 'b', startedAt: 3, endedAt: 4 });
  const h = await storage.loadHistory();
  assert.deepEqual(h.map((x) => x.id), ['a', 'b']);
});

test('el ciclo completo: empezar, registrar, recargar, seguir ayunando', async () => {
  const { createEvent } = await import('../core/events.js');
  const { elapsedMs } = await import('../core/fastSession.js');

  // Empieza un ayuno hace 5 horas.
  const inicio = Date.now() - 5 * H;
  const s = { ...startFast({ targetMs: 16 * H }), startedAt: inicio };
  await storage.saveActiveFast(s);
  await storage.appendEvent(createEvent({ kind: 'water', value: 500, sessionId: s.id }));

  // "Cierra el navegador": se recarga todo desde cero.
  const activo = await storage.loadActiveFast();
  const eventos = await storage.loadEvents();

  assert.ok(activo, 'el ayuno debe seguir ahí tras recargar');
  assert.equal(Math.round(elapsedMs(activo) / H), 5);
  assert.equal(eventos.length, 1);
});

/* ---- terminar un ayuno con sincronización de por medio ---- */

test('un ayuno terminado deja rastro en la ranura, no la vacía', async () => {
  // Vaciarla hacía que la siguiente sincronización lo resucitara: el servidor
  // seguía teniendo el ayuno vivo y, al no recibir señal de que había acabado,
  // lo devolvía como novedad. El contador volvía a correr solo.
  const s = startFast({ targetMs: 16 * H });
  await storage.saveActiveFast(s);
  await storage.clearActiveFast({ ...s, endedAt: Date.now() });

  assert.equal(await storage.loadActiveFast(), null, 'para la interfaz, no hay ayuno');

  const raw = await storage.loadActiveFastRaw();
  assert.ok(raw, 'para la sincronización, el registro sigue ahí');
  assert.ok(raw.endedAt != null, 'y lleva endedAt, que es lo que comunica el fin');
  assert.equal(raw.id, s.id, 'conserva el identificador o el servidor no sabría cuál cerrar');
});

test('clearActiveFast sin ayuno guardado no deja basura', async () => {
  await storage.clearActiveFast();
  assert.equal(await storage.loadActiveFastRaw(), null);
});

test('un ayuno terminado que llega del servidor no revive el contador', async () => {
  const s = startFast({ targetMs: 16 * H });
  await storage.restoreMerged({
    activeFast: { ...s, endedAt: Date.now(), updatedAt: Date.now() },
    history: [],
    events: [],
  });
  assert.equal(await storage.loadActiveFast(), null);
});

test('un ayuno vivo que llega del servidor sí se adopta', async () => {
  const s = startFast({ targetMs: 16 * H });
  await storage.restoreMerged({ activeFast: s, history: [], events: [] });
  const back = await storage.loadActiveFast();
  assert.ok(back);
  assert.equal(back.id, s.id);
});
