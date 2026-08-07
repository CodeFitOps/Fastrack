import { useCallback, useEffect, useRef, useState } from 'react';
import {
  startFast,
  endFast,
  elapsedMs,
  isOpenEnded,
} from '../core/fastSession.js';
import { protocolById } from '../core/protocols.js';
import {
  loadActiveFast,
  saveActiveFast,
  clearActiveFast,
  loadHistory,
  appendToHistory,
} from '../platform/storage.js';
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
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const tick = useRef(null);

  // Rehydrate from storage on mount. An interrupted fast resumes here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [active, past] = await Promise.all([loadActiveFast(), loadHistory()]);
      if (cancelled) return;
      setSession(active);
      setHistory(past);
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

  const begin = useCallback(async (protocolId) => {
    const protocol = protocolById(protocolId);
    if (!protocol) return;
    const next = startFast({ targetMs: protocol.targetMs });
    next.protocolId = protocol.id;
    next.protocolLabel = protocol.label;

    setSession(next);
    setNow(Date.now());
    await saveActiveFast(next);

    // Asked here, on a deliberate tap, rather than at app launch.
    if (!isOpenEnded(next) && (await requestPermission())) {
      await scheduleGoalAlert(next);
    }
  }, []);

  const finish = useCallback(async (logFields = {}) => {
    if (!session) return null;
    const done = { ...endFast(session), ...logFields };
    await cancelGoalAlert();
    setHistory(await appendToHistory(done));
    await clearActiveFast();
    setSession(null);
    return done;
  }, [session]);

  return {
    session,
    history,
    hydrated,
    now,
    isFasting: Boolean(session),
    elapsed: session ? elapsedMs(session, now) : 0,
    begin,
    finish,
  };
}
