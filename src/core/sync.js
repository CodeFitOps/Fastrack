/**
 * Metadatos de sincronización y borrado lógico.
 *
 * Esto existe antes que cualquier servidor a propósito: es la única parte que
 * no se puede añadir después sin migrar datos ya escritos. El transporte —HTTP,
 * SSE, WebSocket— se puede cambiar cuando sea; el modelo de datos no.
 *
 * ── Por qué lápidas ──────────────────────────────────────────────────
 *
 * Si borrar un evento lo quita de la lista y punto, la sincronización lo
 * resucita: el otro dispositivo todavía lo tiene, lo envía como novedad, y
 * reaparece. Es el fallo clásico de toda sincronización casera, y sólo se nota
 * cuando ya hay datos reales de por medio.
 *
 * En vez de quitar la fila, se marca con `deletedAt`. La UI filtra lo marcado;
 * la sincronización lo propaga como lo que es: la orden de borrar.
 *
 * ── Cómo se resuelven los conflictos ─────────────────────────────────
 *
 * Gana la escritura más reciente por `updatedAt` (last-write-wins). Es sencillo
 * y suficiente aquí: un solo usuario, dos dispositivos, y editar el mismo
 * registro en ambos a la vez es rarísimo. Su límite conocido es que depende de
 * los relojes de los dispositivos: si uno va cinco minutos adelantado, sus
 * escrituras ganan aunque sean anteriores en la práctica. Para este uso es
 * asumible; si algún día deja de serlo, la salida es un contador lógico
 * (Lamport) en vez de la hora de pared, y ese cambio sí cabe luego porque no
 * toca la forma de los registros.
 *
 * Un borrado gana a una edición del mismo instante: es más seguro que algo
 * borrado reaparezca a que reaparezca lo que se quiso quitar.
 */

/** Marca de tiempo de escritura, para poder ordenar cambios entre dispositivos. */
export function touch(record, now = Date.now()) {
  return { ...record, updatedAt: now };
}

/** Borrado lógico: la fila se queda, marcada. */
export function tombstone(record, now = Date.now()) {
  return { ...record, deletedAt: now, updatedAt: now };
}

export function isDeleted(record) {
  return record?.deletedAt != null;
}

/** Lo visible para la interfaz: todo menos lo marcado como borrado. */
export function visible(records) {
  return records.filter((r) => !isDeleted(r));
}

/**
 * Cuándo se escribió por última vez un registro.
 *
 * Los registros anteriores a este esquema no tienen `updatedAt`. Se les asigna
 * su propia marca de tiempo natural (`at` o `startedAt`) en vez de 0: así un
 * evento antiguo no pierde siempre frente a cualquier cosa recién escrita, pero
 * tampoco gana sobre una edición real posterior.
 */
export function writtenAt(record) {
  return record.updatedAt ?? record.at ?? record.startedAt ?? 0;
}

/**
 * Fusiona dos listas de registros con identificador.
 *
 * Simétrica: da el mismo resultado sin importar cuál se pase primero, que es lo
 * que permite usarla igual en el cliente y en el servidor.
 */
export function mergeRecords(a, b) {
  const byId = new Map();

  for (const record of [...a, ...b]) {
    const id = record.id;
    if (!id) continue;

    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, record);
      continue;
    }
    byId.set(id, pickWinner(existing, record));
  }

  return [...byId.values()];
}

function pickWinner(x, y) {
  const tx = writtenAt(x);
  const ty = writtenAt(y);
  if (tx !== ty) return tx > ty ? x : y;

  // Mismo instante: el borrado gana. Es más recuperable que algo borrado
  // reaparezca a que reaparezca lo que se quiso quitar.
  if (isDeleted(x) !== isDeleted(y)) return isDeleted(x) ? x : y;

  // Empate total: se elige de forma determinista para que ambos dispositivos
  // lleguen al mismo resultado sin hablar entre ellos.
  return JSON.stringify(x) <= JSON.stringify(y) ? x : y;
}

/**
 * Registros escritos después de `since`, que es lo que hay que enviar.
 *
 * Incluye las lápidas: un borrado es un cambio que el otro lado necesita.
 */
export function changedSince(records, since) {
  return records.filter((r) => writtenAt(r) > since);
}

/**
 * Marca de agua tras una sincronización: la escritura más reciente que se ha
 * visto. Se guarda para pedir sólo lo nuevo la próxima vez.
 *
 * Se toma del máximo observado y no de `Date.now()` para no saltarse cambios
 * que el servidor escribiera mientras la petición viajaba.
 */
export function highWaterMark(records, previous = 0) {
  return records.reduce((max, r) => Math.max(max, writtenAt(r)), previous);
}

/**
 * Limpia lápidas antiguas.
 *
 * Sin esto crecen para siempre. El plazo debe superar con holgura el tiempo que
 * un dispositivo puede pasar sin sincronizar: si se purga una lápida antes de
 * que el otro dispositivo la haya visto, ese dispositivo reenviará el registro
 * y volverá a aparecer. Noventa días es amplio para un móvil de uso diario.
 */
export const TOMBSTONE_TTL_MS = 90 * 86_400_000;

export function purgeTombstones(records, { now = Date.now(), ttl = TOMBSTONE_TTL_MS } = {}) {
  return records.filter((r) => !isDeleted(r) || now - r.deletedAt < ttl);
}
