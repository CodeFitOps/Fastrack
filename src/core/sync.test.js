import test from 'node:test';
import assert from 'node:assert/strict';
import {
  touch,
  tombstone,
  isDeleted,
  visible,
  writtenAt,
  mergeRecords,
  changedSince,
  highWaterMark,
  purgeTombstones,
  TOMBSTONE_TTL_MS,
} from './sync.js';

const T0 = new Date(2026, 6, 15, 12, 0, 0).getTime();
const MIN = 60_000;

const ev = (id, at, extra = {}) => ({ id, at, kind: 'water', value: 500, ...extra });

test('un borrado deja lápida en vez de quitar la fila', () => {
  const t = tombstone(ev('e1', T0), T0 + MIN);
  assert.equal(isDeleted(t), true);
  assert.equal(t.deletedAt, T0 + MIN);
  assert.equal(t.id, 'e1', 'la lápida conserva el id, o no se puede propagar');
});

test('lo borrado desaparece de la vista pero sigue en la lista', () => {
  const lista = [ev('e1', T0), tombstone(ev('e2', T0), T0)];
  assert.equal(lista.length, 2);
  assert.equal(visible(lista).length, 1);
  assert.equal(visible(lista)[0].id, 'e1');
});

test('SIN lápida, sincronizar resucita lo borrado', () => {
  // Este es el fallo que justifica todo el módulo. Se deja escrito para que
  // quede claro qué pasa si alguien "simplifica" quitando las lápidas.
  const movil = []; // se borró aquí, quitando la fila
  const portatil = [ev('e1', T0)]; // aquí todavía está
  const fusionSinLapida = mergeRecords(movil, portatil);
  assert.equal(fusionSinLapida.length, 1, 'reaparece: exactamente el bug');
});

test('CON lápida, el borrado se propaga y no vuelve', () => {
  const movil = [tombstone(ev('e1', T0), T0 + MIN)];
  const portatil = [ev('e1', T0)];

  const fusion = mergeRecords(movil, portatil);
  assert.equal(fusion.length, 1);
  assert.equal(isDeleted(fusion[0]), true);
  assert.equal(visible(fusion).length, 0);
});

test('la fusión es simétrica: el orden de los argumentos no cambia el resultado', () => {
  // Es lo que permite usar la misma función en el cliente y en el servidor.
  const a = [touch(ev('e1', T0), T0 + MIN)];
  const b = [tombstone(ev('e1', T0), T0 + 2 * MIN)];

  assert.deepEqual(mergeRecords(a, b), mergeRecords(b, a));
});

test('gana la escritura más reciente', () => {
  const vieja = touch({ ...ev('e1', T0), value: 300 }, T0);
  const nueva = touch({ ...ev('e1', T0), value: 750 }, T0 + 5 * MIN);

  assert.equal(mergeRecords([vieja], [nueva])[0].value, 750);
  assert.equal(mergeRecords([nueva], [vieja])[0].value, 750);
});

test('una edición posterior a un borrado lo revive, y es correcto', () => {
  // Restaurar algo borrado es una operación legítima; lo que no debe pasar es
  // que reviva solo.
  const borrado = tombstone(ev('e1', T0), T0 + MIN);
  const restaurado = touch({ ...ev('e1', T0), value: 900 }, T0 + 10 * MIN);

  const r = mergeRecords([borrado], [restaurado]);
  assert.equal(isDeleted(r[0]), false);
  assert.equal(r[0].value, 900);
});

test('en el mismo instante, el borrado gana a la edición', () => {
  const editado = touch({ ...ev('e1', T0), value: 900 }, T0 + MIN);
  const borrado = tombstone(ev('e1', T0), T0 + MIN);

  assert.equal(isDeleted(mergeRecords([editado], [borrado])[0]), true);
});

test('un registro sin updatedAt usa su propia marca natural, no cero', () => {
  // Si valieran 0, cualquier escritura nueva ganaría siempre a los datos
  // anteriores a este esquema.
  assert.equal(writtenAt(ev('e1', T0)), T0);
  assert.equal(writtenAt({ id: 's1', startedAt: T0 }), T0);
  assert.equal(writtenAt(touch(ev('e1', T0), T0 + MIN)), T0 + MIN);
});

test('un evento antiguo no pierde frente a otro más viejo recién sincronizado', () => {
  const antiguoPeroReciente = ev('e1', T0 + 10 * MIN);
  const masViejo = ev('e1', T0);
  assert.equal(mergeRecords([antiguoPeroReciente], [masViejo])[0].at, T0 + 10 * MIN);
});

test('la fusión no duplica lo que ya coincide', () => {
  const mismo = touch(ev('e1', T0), T0);
  assert.equal(mergeRecords([mismo], [{ ...mismo }]).length, 1);
});

test('los registros sin id se ignoran en vez de romper la fusión', () => {
  const r = mergeRecords([{ at: T0, kind: 'water' }], [ev('e1', T0)]);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'e1');
});

/* ── qué enviar y hasta dónde se ha visto ── */

test('changedSince devuelve sólo lo escrito después del corte', () => {
  const lista = [
    touch(ev('viejo', T0), T0),
    touch(ev('nuevo', T0), T0 + 10 * MIN),
    tombstone(ev('borrado', T0), T0 + 20 * MIN),
  ];
  const cambios = changedSince(lista, T0 + 5 * MIN);
  assert.deepEqual(cambios.map((r) => r.id).sort(), ['borrado', 'nuevo']);
});

test('changedSince incluye las lápidas — un borrado también es un cambio', () => {
  const cambios = changedSince([tombstone(ev('e1', T0), T0 + MIN)], T0);
  assert.equal(cambios.length, 1);
  assert.equal(isDeleted(cambios[0]), true);
});

test('la marca de agua sale del máximo visto, no del reloj', () => {
  // Usar Date.now() se saltaría cambios escritos mientras viajaba la petición.
  const lista = [touch(ev('a', T0), T0 + MIN), touch(ev('b', T0), T0 + 9 * MIN)];
  assert.equal(highWaterMark(lista), T0 + 9 * MIN);
  assert.equal(highWaterMark([], T0), T0, 'sin cambios, la marca no retrocede');
});

/* ── limpieza ── */

test('las lápidas caducadas se purgan y las recientes no', () => {
  const ahora = T0 + TOMBSTONE_TTL_MS + 1000;
  const lista = [
    ev('vivo', T0),
    tombstone(ev('viejo', T0), T0),
    tombstone(ev('reciente', T0), ahora - 1000),
  ];
  const r = purgeTombstones(lista, { now: ahora });
  assert.deepEqual(r.map((x) => x.id).sort(), ['reciente', 'vivo']);
});

test('el plazo de purga supera con holgura lo que un móvil tarda en sincronizar', () => {
  // Purgar antes de que el otro dispositivo haya visto la lápida hace que el
  // registro reaparezca. 90 días cubre un móvil de uso diario con margen.
  assert.ok(TOMBSTONE_TTL_MS >= 30 * 86_400_000);
});
