/**
 * Cliente de sincronización.
 *
 * Sube lo cambiado desde la última marca de agua y aplica lo que devuelve el
 * servidor. Todo lo demás sigue funcionando sin red: la app es local-first y
 * esto es un replicador, no una dependencia.
 *
 * ── La trampa de Cloudflare Access ───────────────────────────────────
 *
 * Cuando caduca la sesión, Access NO responde 401. Responde 302 hacia su página
 * de login. `fetch` sigue el redirect por defecto, así que la respuesta llega
 * con estado 200 y un cuerpo HTML. Un cliente ingenuo intenta parsearlo como
 * JSON, falla de forma rara, y en el peor caso lo interpreta como «el servidor
 * no tiene nada» y borra datos locales.
 *
 * Aquí se detecta explícitamente: si la respuesta no es JSON o la URL final no
 * es la que se pidió, se trata como «sin autenticar» y se sigue encolando en
 * local sin tocar nada.
 */

import {
  loadEventsRaw,
  loadHistory,
  loadActiveFast,
  loadDeviceSettings,
  saveDeviceSettings,
  restoreMerged,
} from './storage.js';
import { mergeRecords, changedSince, visible } from '../core/sync.js';

/** Estados que la interfaz puede mostrar. */
export const SYNC_STATE = {
  idle: 'idle',
  syncing: 'syncing',
  offline: 'offline',
  unauthenticated: 'unauthenticated',
  error: 'error',
};

/**
 * Un ciclo de sincronización.
 *
 * @returns {Promise<{state: string, applied?: number, cursor?: number}>}
 */
export async function syncOnce({ fetchImpl = fetch } = {}) {
  const settings = await loadDeviceSettings();
  if (!settings.syncEnabled || !settings.serverUrl) {
    return { state: SYNC_STATE.idle };
  }

  const since = settings.lastSyncedAt ?? 0;
  const [events, history, activeFast] = await Promise.all([
    loadEventsRaw(),
    loadHistory(),
    loadActiveFast(),
  ]);

  const url = new URL('/sync', settings.serverUrl).toString();
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Las cookies de Access viajan aquí; sin esto cada petición sería anónima.
      credentials: 'include',
      body: JSON.stringify({
        since,
        events: changedSince(events, since),
        sessions: changedSince(history, since),
        activeFast,
      }),
    });
  } catch {
    // Sin red. No es un error: es el modo normal de un móvil.
    return { state: SYNC_STATE.offline };
  }

  if (res.status === 401 || res.status === 403) {
    return { state: SYNC_STATE.unauthenticated };
  }
  if (!res.ok) {
    return { state: SYNC_STATE.error };
  }

  // La comprobación que evita tragarse la página de login de Access.
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return { state: SYNC_STATE.unauthenticated };
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    return { state: SYNC_STATE.unauthenticated };
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.events)) {
    return { state: SYNC_STATE.unauthenticated };
  }

  const mergedEvents = mergeRecords(events, payload.events);
  const mergedHistory = mergeRecords(history, payload.sessions ?? []);

  // El ayuno en curso sólo lo escribe el principal. Un secundario acepta el del
  // servidor; el principal se queda con el suyo, que es la fuente.
  const incomingActive = payload.activeFast ?? null;
  let nextActive = activeFast;
  if (settings.role !== 'primary') {
    nextActive = incomingActive;
  } else if (incomingActive && (incomingActive.updatedAt ?? 0) > (activeFast?.updatedAt ?? 0)) {
    nextActive = incomingActive;
  }

  await restoreMerged({
    activeFast: nextActive,
    history: mergedHistory,
    events: mergedEvents,
  });

  const cursor = Number.isFinite(payload.cursor) ? payload.cursor : since;
  await saveDeviceSettings({ lastSyncedAt: cursor });

  return {
    state: SYNC_STATE.idle,
    applied: payload.events.length + (payload.sessions?.length ?? 0),
    cursor,
    activeFastChanged: (nextActive?.updatedAt ?? 0) !== (activeFast?.updatedAt ?? 0),
    visibleEvents: visible(mergedEvents).length,
  };
}

/**
 * Sincroniza cada `intervalMs` mientras la pestaña esté visible.
 *
 * Pausar en segundo plano no es una optimización cosmética: un WebView
 * suspendido acumula temporizadores y al volver dispara todos de golpe contra
 * el servidor. Además se sincroniza al recuperar el foco, que es cuando el
 * usuario va a mirar los datos.
 *
 * @returns {() => void} función para detenerlo
 */
export function startSyncLoop({ intervalMs = 30_000, onResult } = {}) {
  let timer = null;
  let running = false;
  let stopped = false;

  const tick = async () => {
    // Evita solapar dos ciclos si uno tarda más que el intervalo.
    if (running || stopped) return;
    running = true;
    try {
      const result = await syncOnce();
      onResult?.(result);
    } catch {
      onResult?.({ state: SYNC_STATE.error });
    } finally {
      running = false;
    }
  };

  const start = () => {
    if (timer) return;
    timer = setInterval(tick, intervalMs);
    tick();
  };
  const pause = () => {
    clearInterval(timer);
    timer = null;
  };

  const onVisibility = () => (document.hidden ? pause() : start());
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', tick);

  start();

  return () => {
    stopped = true;
    pause();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', tick);
  };
}
