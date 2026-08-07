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

const KEY_ACTIVE_FAST = 'fastrack.activeFast';
const KEY_HISTORY = 'fastrack.history';

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

// Native backends are imported lazily so a plain `vite build` for the web target
// never needs these packages installed. Install only the one you ship.
const tauriBackend = {
  _store: null,
  async _get() {
    if (!this._store) {
      const { load } = await import(/* @vite-ignore */ '@tauri-apps/plugin-store');
      this._store = await load('fastrack.json', { autoSave: true });
    }
    return this._store;
  },
  async get(k) { return (await this._get()).get(k).then((v) => v ?? null); },
  async set(k, v) { await (await this._get()).set(k, v); },
  async remove(k) { await (await this._get()).delete(k); },
};

const capacitorBackend = {
  async _p() { return (await import(/* @vite-ignore */ '@capacitor/preferences')).Preferences; },
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
export async function loadActiveFast() {
  try {
    const raw = await backend.get(KEY_ACTIVE_FAST);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (typeof s?.startedAt !== 'number' || typeof s?.targetMs !== 'number') return null;
    return s;
  } catch {
    return null;
  }
}

export async function saveActiveFast(session) {
  await backend.set(KEY_ACTIVE_FAST, JSON.stringify(session));
}

export async function clearActiveFast() {
  await backend.remove(KEY_ACTIVE_FAST);
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

export async function appendToHistory(session) {
  const history = await loadHistory();
  history.push(session);
  await backend.set(KEY_HISTORY, JSON.stringify(history));
  return history;
}
