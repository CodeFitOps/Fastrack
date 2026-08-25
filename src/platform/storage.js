/**
 * Persistent key-value storage.
 *
 * One async interface, three backends chosen at runtime. This is the seam that
 * makes the Tauri-vs-Capacitor decision reversible: swapping shells changes only
 * this file, not any calling code.
 *
 * The interface is async even on web, where localStorage is synchronous, so that
 * callers never have to change shape when the backend does.
 */

import { loadNative } from './native.js';
// Estático: la carga diferida no aportaba nada, porque la UI ya importa
// events.js de forma estática, así que el módulo entra en el bundle igual.
// Vite avisaba de la contradicción.
import { migrateSessionFields } from '../core/events.js';
import { touch, tombstone, visible, purgeTombstones } from '../core/sync.js';
import { defaultRole } from '../core/roles.js';

const KEY_ACTIVE_FAST = 'fastrack.activeFast';
const KEY_HISTORY = 'fastrack.history';
const KEY_EVENTS = 'fastrack.events';
const KEY_SCHEMA = 'fastrack.schemaVersion';
const KEY_DEVICE = 'fastrack.device';
const KEY_DEVICE_ID = 'fastrack.deviceId';

const SCHEMA_VERSION = 4; // 4 = repara historial sin updatedAt (no se sincronizaba)

function detectPlatform() {
  if (typeof window === 'undefined') return 'memory';
  if (window.__TAURI_INTERNALS__ || window.__TAURI__) return 'tauri';
  if (window.Capacitor?.isNativePlatform?.()) return 'capacitor';
  return 'web';
}

/* ---------- backends ---------- */

const memoryBackend = (() => {
  const map = new Map();
  return {
    async get(k) { return map.has(k) ? map.get(k) : null; },
    async set(k, v) { map.set(k, v); },
    async remove(k) { map.delete(k); },
  };
})();

const webBackend = {
  async get(k) { return localStorage.getItem(k); },
  async set(k, v) { localStorage.setItem(k, v); },
  async remove(k) { localStorage.removeItem(k); },
};

// Los backends nativos se cargan por nombre desde native.js — ver allí por qué
// no se escribe el especificador como literal.
const tauriBackend = {
  _store: null,
  async _get() {
    if (!this._store) {
      const mod = await loadNative('tauriStore');
      if (!mod) throw new Error('@tauri-apps/plugin-store no está instalado');
      this._store = await mod.load('fastrack.json', { autoSave: true });
    }
    return this._store;
  },
  async get(k) { return (await this._get()).get(k).then((v) => v ?? null); },
  async set(k, v) { await (await this._get()).set(k, v); },
  async remove(k) { await (await this._get()).delete(k); },
};

const capacitorBackend = {
  async _p() {
    const mod = await loadNative('capacitorPreferences');
    if (!mod) throw new Error('@capacitor/preferences no está instalado');
    return mod.Preferences;
  },
  async get(k) { return (await (await this._p()).get({ key: k })).value ?? null; },
  async set(k, v) { await (await this._p()).set({ key: k, value: v }); },
  async remove(k) { await (await this._p()).remove({ key: k }); },
};

const BACKENDS = {
  memory: memoryBackend,
  web: webBackend,
  tauri: tauriBackend,
  capacitor: capacitorBackend,
};

export const platform = detectPlatform();
const backend = BACKENDS[platform];

/* ---------- app-level API ---------- */

/**
 * Read the in-progress fast, or null.
 * Returns null rather than throwing on corrupt data: a fasting app should open
 * to an empty start screen, not a crash, if storage is damaged.
 */
/**
 * El ayuno en curso, o null si no hay ninguno.
 *
 * Un ayuno terminado se conserva en esta ranura con `endedAt` puesto, y aquí se
 * traduce a null. La razón está en `clearActiveFast()`.
 */
export async function loadActiveFast() {
  const s = await loadActiveFastRaw();
  return s && s.endedAt == null ? s : null;
}

/**
 * La ranura tal cual, incluido un ayuno ya terminado.
 *
 * La usa la sincronización: el registro terminado es lo que comunica «este
 * ayuno acabó» a los demás dispositivos.
 */
export async function loadActiveFastRaw() {
  try {
    const raw = await backend.get(KEY_ACTIVE_FAST);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!isValidSession(s)) return null;
    return s;
  } catch {
    return null;
  }
}

/**
 * `targetMs` es null a propósito en un ayuno abierto (FREE-FORM), así que no
 * puede exigirse que sea número: `typeof null === 'object'`. Esta comprobación
 * se escribió antes de que existieran los ayunos abiertos y los descartaba en
 * silencio al recargar — el ayuno desaparecía sin ningún error.
 */
function isValidSession(s) {
  if (!s || typeof s !== 'object') return false;
  if (typeof s.startedAt !== 'number' || !Number.isFinite(s.startedAt)) return false;
  if (s.targetMs !== null && (typeof s.targetMs !== 'number' || !Number.isFinite(s.targetMs))) {
    return false;
  }
  return true;
}

/**
 * Guarda el ayuno en curso.
 *
 * Marca `updatedAt` porque el ayuno también se sincroniza: el portátil puede
 * corregirle la hora de inicio, y hay que saber qué versión es más reciente.
 */
export async function saveActiveFast(session) {
  await backend.set(KEY_ACTIVE_FAST, JSON.stringify(touch(session)));
}

/**
 * Cierra el ayuno en curso.
 *
 * NO borra la ranura: guarda el ayuno con `endedAt`, que es lo que hace las
 * veces de lápida. Vaciarla sin más provocaba que la siguiente sincronización
 * lo resucitara — el servidor seguía teniendo el ayuno vivo y, al no recibir
 * ninguna señal de que había terminado, lo devolvía como novedad. El contador
 * volvía a correr solo.
 *
 * @param {object} [ended] el ayuno ya terminado; si falta, se cierra ahora.
 */
export async function clearActiveFast(ended) {
  const current = ended ?? (await loadActiveFastRaw());
  if (!current) {
    await backend.remove(KEY_ACTIVE_FAST);
    return;
  }
  const closed = { ...current, endedAt: current.endedAt ?? Date.now() };
  await backend.set(KEY_ACTIVE_FAST, JSON.stringify(touch(closed)));
}

export async function loadHistory() {
  try {
    const raw = await backend.get(KEY_HISTORY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Añade un ayuno terminado al historial.
 *
 * `touch()` no es opcional: sin `updatedAt`, la sincronización ordena el ayuno
 * por su hora de INICIO. Un 16:8 terminado ahora se ordenaría como de hace
 * dieciséis horas, quedaría por detrás de la marca de agua, y `changedSince`
 * concluiría que no es novedad. El ayuno no se enviaba nunca y el otro
 * dispositivo no lo veía jamás en el historial ni en el diario.
 */
export async function appendToHistory(session) {
  const history = await loadHistory();
  history.push(touch(session));
  await backend.set(KEY_HISTORY, JSON.stringify(history));
  return history;
}


/* ---- registro de eventos ---- */

/**
 * Eventos visibles para la interfaz: sin los marcados como borrados.
 *
 * La sincronización necesita también las lápidas; para eso está
 * `loadEventsRaw()`. Separarlos evita el error de enseñar registros borrados
 * en el diario por olvidar filtrar en un sitio.
 */
export async function loadEvents() {
  return visible(await loadEventsRaw());
}

/** Todo, lápidas incluidas. Para sincronizar y exportar. */
export async function loadEventsRaw() {
  try {
    const raw = await backend.get(KEY_EVENTS);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveEvents(events) {
  await backend.set(KEY_EVENTS, JSON.stringify(events));
}

export async function appendEvent(event) {
  const events = await loadEventsRaw();
  events.push(touch(event));
  await saveEvents(events);
  return visible(events);
}

export async function updateEvent(id, patch) {
  const events = await loadEventsRaw();
  const i = events.findIndex((e) => e.id === id);
  if (i === -1) return visible(events);
  events[i] = touch({ ...events[i], ...patch });
  await saveEvents(events);
  return visible(events);
}

/**
 * Borrado lógico: la fila se marca, no se quita.
 *
 * Quitarla haría que el otro dispositivo la reenviase en la próxima
 * sincronización y el evento reapareciera. Ver src/core/sync.js.
 */
export async function deleteEvent(id) {
  const events = await loadEventsRaw();
  const i = events.findIndex((e) => e.id === id);
  if (i === -1) return visible(events);
  events[i] = tombstone(events[i]);
  await saveEvents(events);
  return visible(events);
}

/** Quita lápidas caducadas. Se llama al arrancar, no en cada escritura. */
export async function compactEvents() {
  const events = await loadEventsRaw();
  const kept = purgeTombstones(events);
  if (kept.length !== events.length) await saveEvents(kept);
  return kept.length;
}

/**
 * Migración al esquema 2.
 *
 * Convierte los campos sueltos (kcal/ketones/water/note) de las sesiones ya
 * guardadas en eventos fechados. Es idempotente: se marca la versión al
 * terminar, y no vuelve a ejecutarse.
 *
 * Las sesiones NO se reescriben. Se dejan sus campos antiguos intactos por si
 * la migración resultara mal — es más fácil volver a migrar desde el original
 * que reconstruir un dato borrado.
 */
export async function migrateIfNeeded() {
  let version = 0;
  try {
    version = Number(await backend.get(KEY_SCHEMA)) || 0;
  } catch {
    version = 0;
  }
  if (version >= SCHEMA_VERSION) return { migrated: false, created: 0 };

  const history = await loadHistory();
  const existing = await loadEventsRaw();

  const created = version < 2 ? history.flatMap(migrateSessionFields) : [];
  const stamped = stampExisting([...existing, ...created]);
  await saveEvents(stamped);

  const stampedHistory = stampExisting(history);
  await backend.set(KEY_HISTORY, JSON.stringify(stampedHistory));

  await repairMissingTimestamps();

  await backend.set(KEY_SCHEMA, String(SCHEMA_VERSION));
  return { migrated: true, created: created.length };
}

/**
 * Esquema 4: repara los registros guardados sin `updatedAt`.
 *
 * `appendToHistory` no marcaba la hora de escritura, así que un ayuno terminado
 * se ordenaba por su hora de INICIO. Un 16:8 acabado hace un minuto figuraba
 * como escrito dieciséis horas antes, quedaba por detrás de la marca de agua, y
 * no se enviaba nunca. En el otro dispositivo no aparecía jamás.
 *
 * Se marcan con la hora actual, no con la del ayuno: lo que hace falta es que
 * superen la marca de agua para que se envíen una vez. Además se pone el cursor
 * a cero, de modo que el siguiente ciclo suba todo lo pendiente.
 */
async function repairMissingTimestamps() {
  // Poner el cursor a cero, sin condiciones.
  //
  // Se intentó primero rellenar sólo los `updatedAt` que faltaran, pero no
  // bastaba: la marca que se les asignaba era la hora de FIN del ayuno, que en
  // un ayuno recién terminado sigue siendo anterior a la marca de agua. El
  // registro quedaba igual de invisible.
  //
  // Reiniciar el cursor fuerza un envío completo en el siguiente ciclo, y eso
  // arregla todos los casos de una vez. Es barato porque la fusión es
  // idempotente: reenviar lo que el servidor ya tiene no duplica nada.
  try {
    const raw = await backend.get(KEY_DEVICE);
    const settings = raw ? JSON.parse(raw) : {};
    await backend.set(KEY_DEVICE, JSON.stringify({ ...settings, lastSyncedAt: 0 }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Esquema 3: añade `updatedAt` a lo ya guardado.
 *
 * No se pone `Date.now()`: eso haría que todos los registros antiguos
 * parecieran recién escritos y ganaran cualquier conflicto de sincronización.
 * Se usa la marca natural de cada uno — cuándo ocurrió — que es la mejor
 * aproximación disponible a cuándo se escribió.
 */
function stampExisting(records) {
  return records.map((r) =>
    r.updatedAt != null ? r : { ...r, updatedAt: r.at ?? r.endedAt ?? r.startedAt ?? 0 }
  );
}

/* ---- copia de seguridad ---- */

/** Instantánea completa, lista para exportar. */
export async function snapshot() {
  const [activeFast, history, events] = await Promise.all([
    loadActiveFast(),
    loadHistory(),
    // En crudo, con lápidas: si la copia sólo llevara lo visible, importarla en
    // otro dispositivo resucitaría allí lo que se borró aquí.
    loadEventsRaw(),
  ]);
  return { activeFast, history, events };
}

/**
 * Escribe el resultado de una fusión.
 *
 * Se escribe todo o nada en la medida de lo posible: primero los dos bloques
 * grandes, y el ayuno activo al final, porque es el único que puede quedar en un
 * estado raro si algo falla a mitad.
 */
export async function restoreMerged({ activeFast, history, events }) {
  await backend.set(KEY_HISTORY, JSON.stringify(history));
  await backend.set(KEY_EVENTS, JSON.stringify(events));
  // Se escribe tal cual llega, sin volver a marcar `updatedAt`: hacerlo daría a
  // un dato recibido una marca más nueva que la del origen y ganaría conflictos
  // que no le corresponden.
  if (activeFast) {
    await backend.set(KEY_ACTIVE_FAST, JSON.stringify(activeFast));
  } else {
    await backend.remove(KEY_ACTIVE_FAST);
  }
  // Lo importado ya viene con el esquema actual: no hay que volver a migrar.
  await backend.set(KEY_SCHEMA, String(SCHEMA_VERSION));
}


/* ---- ajustes de este dispositivo ---- */

/**
 * Ajustes locales, que NO se sincronizan.
 *
 * El papel es una propiedad del dispositivo, no del usuario: si viajara con los
 * datos, el móvil y el portátil acabarían con el mismo papel y uno de los dos
 * quedaría sin poder llevar el ayuno.
 */
/**
 * Identificador estable de este dispositivo.
 *
 * Hace falta para que el servidor sepa cuál es el principal. Se genera una vez
 * y no se sincroniza: es propiedad del aparato, no del usuario.
 */
export async function deviceId() {
  let id = null;
  try {
    id = await backend.get(KEY_DEVICE_ID);
  } catch {
    id = null;
  }
  if (id) return id;

  const nuevo = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  await backend.set(KEY_DEVICE_ID, nuevo);
  return nuevo;
}

/**
 * Dirección del servidor por defecto.
 *
 * La app se sirve desde el mismo proceso que la API, así que su propio origen
 * es la respuesta correcta y no hay nada que teclear. En una app empaquetada el
 * origen es interno (`capacitor://localhost`) y no sirve: ahí sí hay que
 * indicarla a mano.
 */
function defaultServerUrl() {
  if (platform === 'capacitor' || platform === 'tauri' || platform === 'memory') return '';
  try {
    const { origin, protocol } = window.location;
    return protocol === 'http:' || protocol === 'https:' ? origin : '';
  } catch {
    return '';
  }
}

export async function loadDeviceSettings() {
  try {
    const raw = await backend.get(KEY_DEVICE);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      role: parsed.role ?? defaultRole(platform),
      // Activada por defecto cuando hay un origen del que tirar: la app se
      // sirve desde el servidor, así que sincronizar es lo esperado.
      syncEnabled: parsed.syncEnabled ?? Boolean(defaultServerUrl()),
      // Una cadena vacía guardada significa «usa el origen», no «sin servidor».
      serverUrl: parsed.serverUrl || defaultServerUrl(),
      lastSyncedAt: Number.isFinite(parsed.lastSyncedAt) ? parsed.lastSyncedAt : 0,
      // Cursor de descarga: secuencia asignada por el servidor.
      lastSyncedSeq: Number.isFinite(parsed.lastSyncedSeq) ? parsed.lastSyncedSeq : 0,
    };
  } catch {
    return {
      role: defaultRole(platform),
      syncEnabled: Boolean(defaultServerUrl()),
      serverUrl: defaultServerUrl(),
      lastSyncedAt: 0,
      lastSyncedSeq: 0,
    };
  }
}

export async function saveDeviceSettings(patch) {
  const current = await loadDeviceSettings();
  const next = { ...current, ...patch };
  await backend.set(KEY_DEVICE, JSON.stringify(next));
  return next;
}


/* ---- reinicio (modo de pruebas) ---- */

/**
 * Borra todos los datos de este dispositivo.
 *
 * Incluye el ayuno en curso, el historial, los eventos y la marca de
 * sincronización. NO borra la identidad del dispositivo ni los ajustes de
 * servidor: así vuelve a sincronizar solo, en vez de dejarte reconfigurándolo.
 *
 * Vaciar el cursor es imprescindible: sin eso el dispositivo creería estar al
 * día y no se descargaría nada del servidor.
 */
export async function wipeLocalData() {
  await backend.remove(KEY_ACTIVE_FAST);
  await backend.remove(KEY_HISTORY);
  await backend.remove(KEY_EVENTS);
  await backend.remove(KEY_SCHEMA);

  const settings = await loadDeviceSettings();
  await backend.set(KEY_DEVICE, JSON.stringify({
    ...settings,
    lastSyncedAt: 0,
    lastSyncedSeq: 0,
  }));
}
