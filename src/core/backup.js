/**
 * Copia de seguridad: exportar e importar.
 *
 * Funciones puras, sin acceso a almacenamiento, para poder probarlas a fondo.
 * La capa que lee y escribe está en platform/storage.js.
 *
 * Sirve para tres cosas que en el fondo son la misma:
 *   - copia de seguridad (el navegador puede vaciar su almacenamiento)
 *   - llevar los datos del navegador al APK (son almacenamientos distintos)
 *   - llevarlos de una máquina a otra
 *
 * Los timestamps son epoch absolutos, así que un fichero exportado en Madrid se
 * importa correctamente en cualquier zona horaria: sólo cambia cómo se muestran.
 */

export const BACKUP_FORMAT = 1;

/** Versión de esquema de datos que produce y admite esta versión. */
export const SUPPORTED_SCHEMA = 3;

/**
 * Construye el objeto exportable.
 *
 * Incluye el ayuno en curso: si alguien cambia de dispositivo a mitad de un
 * ayuno de 20 h, perderlo sería justo el peor momento.
 */
export function buildBackup({ activeFast, history, events }, { now = Date.now() } = {}) {
  return {
    format: BACKUP_FORMAT,
    schema: SUPPORTED_SCHEMA,
    exportedAt: now,
    activeFast: activeFast ?? null,
    history: history ?? [],
    events: events ?? [],
  };
}

export function serializeBackup(backup) {
  return JSON.stringify(backup, null, 2);
}

/** Nombre de fichero con fecha, para que varias copias no se pisen. */
export function backupFilename(now = Date.now()) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `fastrack-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

/**
 * Lee y valida un fichero de copia.
 *
 * Devuelve `{ backup }` o `{ error }` con una clave de traducción. Nunca lanza:
 * un fichero corrupto es un caso esperado, no un fallo del programa.
 */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'backup.notJson' };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: 'backup.notBackup' };
  }
  if (data.format !== BACKUP_FORMAT) return { error: 'backup.wrongFormat' };

  // Un fichero de una versión futura puede traer campos que aquí se perderían
  // en silencio. Mejor rechazarlo que importarlo a medias.
  if (typeof data.schema !== 'number' || data.schema > SUPPORTED_SCHEMA) {
    return { error: 'backup.tooNew' };
  }

  if (!Array.isArray(data.history) || !Array.isArray(data.events)) {
    return { error: 'backup.notBackup' };
  }

  return {
    backup: {
      format: data.format,
      schema: data.schema,
      exportedAt: typeof data.exportedAt === 'number' ? data.exportedAt : null,
      activeFast: isValidSession(data.activeFast) ? data.activeFast : null,
      history: data.history.filter(isValidSession),
      events: data.events.filter(isValidEvent),
    },
  };
}

function isValidSession(s) {
  if (!s || typeof s !== 'object') return false;
  if (!Number.isFinite(s.startedAt)) return false;
  if (s.targetMs !== null && !Number.isFinite(s.targetMs)) return false;
  if (s.endedAt != null && !Number.isFinite(s.endedAt)) return false;
  return true;
}

function isValidEvent(e) {
  // Una lápida es un evento válido: lleva id y hora, y debe viajar.
  return Boolean(e) && typeof e === 'object' && Number.isFinite(e.at) && typeof e.kind === 'string';
}

/**
 * Fusiona una copia con lo que ya hay en el dispositivo.
 *
 * Fusionar, no reemplazar. Importar en un dispositivo que ya tiene registros no
 * debe borrarlos: casi siempre se quiere juntar lo de dos sitios, y un reemplazo
 * silencioso es imposible de deshacer.
 *
 * Ante dos entradas con el mismo id gana **la del dispositivo**. Lo importado es
 * por definición más antiguo —se exportó antes— y sobrescribir con ello podría
 * revertir una corrección hecha después.
 *
 * Las entradas sin id se identifican por su contenido, para que importar el
 * mismo fichero dos veces no duplique nada.
 */
export function mergeBackup(current, backup) {
  const history = mergeById(current.history ?? [], backup.history, sessionSignature);
  const events = mergeById(current.events ?? [], backup.events, eventSignature);

  // Un ayuno en curso en el dispositivo nunca se pisa: es el dato más vivo que
  // existe, y perderlo a mitad significa perder el reloj.
  let activeFast = current.activeFast ?? null;
  let activeFastSkipped = false;
  if (backup.activeFast) {
    if (activeFast) {
      activeFastSkipped = true;
    } else {
      activeFast = backup.activeFast;
    }
  }

  return {
    activeFast,
    history: history.merged.sort((a, b) => a.startedAt - b.startedAt),
    events: events.merged.sort((a, b) => a.at - b.at),
    stats: {
      historyAdded: history.added,
      historySkipped: history.skipped,
      eventsAdded: events.added,
      eventsSkipped: events.skipped,
      activeFastImported: Boolean(backup.activeFast) && !activeFastSkipped && !current.activeFast,
      activeFastSkipped,
    },
  };
}

function mergeById(current, incoming, signature) {
  const seen = new Set(current.map((x) => x.id ?? signature(x)));
  const merged = [...current];
  let added = 0;
  let skipped = 0;

  for (const item of incoming) {
    const key = item.id ?? signature(item);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    merged.push(item);
    added++;
  }

  return { merged, added, skipped };
}

const sessionSignature = (s) => `s:${s.startedAt}:${s.endedAt ?? 'run'}`;
const eventSignature = (e) => `e:${e.at}:${e.kind}:${e.value ?? ''}`;
