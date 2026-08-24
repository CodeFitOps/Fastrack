import { useCallback, useEffect, useRef, useState } from 'react';
import { syncOnce, startSyncLoop, SYNC_STATE } from '../platform/syncClient.js';

/**
 * Gobierna el ciclo de sincronización.
 *
 * Sólo arranca el bucle si la sincronización está activada y hay servidor. Sin
 * eso la app se comporta exactamente como hasta ahora: local y sin red.
 */
export function useSync({ device, onApplied }) {
  // Arranca en 'disabled': hasta que se confirme lo contrario, la app es local.
  const [state, setState] = useState(SYNC_STATE.disabled);
  const [lastRun, setLastRun] = useState(null);
  const [lastError, setLastError] = useState(null);
  const applied = useRef(onApplied);
  applied.current = onApplied;

  const enabled = Boolean(device?.syncEnabled && device?.serverUrl);

  const handle = useCallback((result) => {
    setState(result.state);
    setLastRun(Date.now());
    setLastError(result.state === SYNC_STATE.error ? 'sync.errorGeneric' : null);
    // Sólo se recarga la interfaz si de verdad llegó algo, para no repintar
    // cada treinta segundos sin motivo.
    if (result.applied > 0 || result.activeFastChanged) applied.current?.();
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState(SYNC_STATE.disabled);
      return undefined;
    }
    return startSyncLoop({ intervalMs: 30_000, onResult: handle });
  }, [enabled, device?.serverUrl, device?.role, handle]);

  /** Ciclo manual, para el botón «sincronizar ahora». */
  const syncNow = useCallback(async () => {
    setState(SYNC_STATE.syncing);
    const result = await syncOnce();
    handle(result);
    return result;
  }, [handle]);

  return { state, lastRun, lastError, syncNow, enabled };
}

export { SYNC_STATE };
