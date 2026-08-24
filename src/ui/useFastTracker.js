import { useCallback, useEffect, useRef, useState } from 'react';
import {
  startFast,
  endFast,
  elapsedMs,
  isOpenEnded,
  isComplete,
  adjustStart,
} from '../core/fastSession.js';
import { protocolById } from '../core/protocols.js';
import {
  loadActiveFast,
  saveActiveFast,
  clearActiveFast,
  loadHistory,
  appendToHistory,
  loadEvents,
  appendEvent,
  updateEvent,
  deleteEvent,
  migrateIfNeeded,
  loadDeviceSettings,
  saveDeviceSettings,
} from '../platform/storage.js';
import { canControlFast, canEditFast, blockedReason } from '../core/roles.js';
import { createEvent } from '../core/events.js';
import {
  requestPermission,
  scheduleGoalAlert,
  cancelGoalAlert,
} from '../platform/notifications.js';

/**
 * Owns the live fast.
 *
 * `now` ticks once a second purely to trigger a repaint. It is never the source
 * of elapsed time — that is always derived from the stored startedAt — so a
 * missed tick while the app is backgrounded costs nothing but a stale pixel.
 */
export function useFastTracker() {
  const [session, setSession] = useState(null);
  const [history, setHistory] = useState([]);
  const [events, setEvents] = useState([]);
  const [hydrated, setHydrated] = useState(false);
  const [device, setDevice] = useState({ role: 'primary', syncEnabled: false });
  const [now, setNow] = useState(() => Date.now());
  const tick = useRef(null);

  // Rehydrate from storage on mount. An interrupted fast resumes here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // La migración va primero: convierte los campos sueltos de sesiones
      // antiguas en eventos fechados antes de que nada lea el registro.
      await migrateIfNeeded();
      const [active, past, log, settings] = await Promise.all([
        loadActiveFast(),
        loadHistory(),
        loadEvents(),
        loadDeviceSettings(),
      ]);
      if (cancelled) return;
      setSession(active);
      setHistory(past);
      setEvents(log);
      setDevice(settings);
      setHydrated(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Repaint clock. Resynced on resume because a suspended WebView throttles or
  // stops timers entirely, and the visible clock would otherwise lag on return.
  useEffect(() => {
    const sync = () => setNow(Date.now());
    tick.current = setInterval(sync, 1000);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    return () => {
      clearInterval(tick.current);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
    };
  }, []);

  /**
   * Empieza un ayuno. `startedAt` permite fecharlo hacia atrás, para cuando ya
   * se llevaba un rato ayunando antes de abrir la app.
   *
   * Puede lanzar RangeError con una clave de traducción si la hora no vale;
   * quien llame debe mostrarla.
   */
  const begin = useCallback(async (protocolId, { startedAt } = {}) => {
    // El ciclo de vida del ayuno tiene un solo escritor cuando hay
    // sincronización: dos dispositivos abriendo ayunos distintos producirían
    // estados incompatibles que no se pueden fusionar.
    if (!canControlFast(device)) throw new RangeError('role.onlyPrimaryControls');

    const protocol = protocolById(protocolId);
    if (!protocol) return null;

    const next = startFast({ targetMs: protocol.targetMs, startedAt });
    next.protocolId = protocol.id;

    setSession(next);
    setNow(Date.now());
    await saveActiveFast(next);

    // El permiso se pide aquí, en un gesto deliberado, no al abrir la app.
    // Si el inicio retrasado ya supera el objetivo no hay nada que programar:
    // el momento de la alerta quedó en el pasado.
    if (!isOpenEnded(next) && !isComplete(next) && (await requestPermission())) {
      await scheduleGoalAlert(next);
    }
    return next;
  }, []);

  /**
   * Corrige la hora de inicio de un ayuno en curso.
   *
   * Reprograma la alerta siempre, porque el instante del objetivo se ha movido.
   * Sin esto, corregir el inicio dejaría la notificación anterior en pie y
   * saltaría a la hora vieja — un aviso a destiempo es peor que ninguno.
   */
  const changeStart = useCallback(async (startedAt) => {
    if (!canEditFast(device)) throw new RangeError('role.onlyPrimaryControls');
    if (!session) return null;
    const moved = adjustStart(session, startedAt);

    setSession(moved);
    setNow(Date.now());
    await saveActiveFast(moved);

    await cancelGoalAlert();
    if (!isOpenEnded(moved) && !isComplete(moved)) {
      await scheduleGoalAlert(moved);
    }
    return moved;
  }, [session, device]);

  const finish = useCallback(async (logFields = {}) => {
    if (!canControlFast(device)) throw new RangeError('role.onlyPrimaryControls');
    if (!session) return null;
    const done = { ...endFast(session), ...logFields };
    await cancelGoalAlert();
    setHistory(await appendToHistory(done));
    await clearActiveFast();
    setSession(null);
    return done;
  }, [session]);

  /**
   * Registra un evento. `at` puede ir hacia atrás para anotar algo que pasó
   * antes; el `sessionId` se rellena solo con el ayuno activo, si lo hay.
   */
  const log = useCallback(async (fields) => {
    const event = createEvent({ ...fields, sessionId: session?.id ?? null });
    setEvents(await appendEvent(event));
    return event;
  }, [session]);

  const editEvent = useCallback(async (id, patch) => {
    setEvents(await updateEvent(id, patch));
  }, []);

  const removeEvent = useCallback(async (id) => {
    setEvents(await deleteEvent(id));
  }, []);

  /** Recarga todo desde almacenamiento. Se usa tras importar una copia. */
  const reload = useCallback(async () => {
    const [active, past, log] = await Promise.all([
      loadActiveFast(),
      loadHistory(),
      loadEvents(),
    ]);
    setSession(active);
    setHistory(past);
    setEvents(log);
    setNow(Date.now());
  }, []);

  const updateDevice = useCallback(async (patch) => {
    setDevice(await saveDeviceSettings(patch));
  }, []);

  return {
    session,
    history,
    events,
    device,
    updateDevice,
    // `canControl` es lo que la interfaz consulta; `controlBlockedReason`
    // explica por qué no, para no dejar un botón muerto sin explicación.
    canControl: canControlFast(device),
    canEditFast: canEditFast(device),
    controlBlockedReason: blockedReason(device),
    reload,
    log,
    editEvent,
    removeEvent,
    hydrated,
    now,
    isFasting: Boolean(session),
    elapsed: session ? elapsedMs(session, now) : 0,
    begin,
    changeStart,
    finish,
  };
}
