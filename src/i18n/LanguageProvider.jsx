import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  createTranslator,
  detectLanguage,
  formatClock,
  formatDate,
  formatWeekday,
  DEFAULT_LANG,
  CATALOGS,
} from './index.js';

const KEY_LANG = 'fastrack.lang';

const LanguageContext = createContext(null);

/**
 * Provee `t()` y el idioma actual.
 *
 * El idioma se lee de forma síncrona en el primer render, no en un efecto: si
 * se cargara después, la app se pintaría un instante en el idioma por defecto y
 * saltaría al elegido. Con `localStorage` es barato hacerlo así; en Capacitor,
 * `Preferences` es asíncrono, pero el idioma también se guarda aquí para que el
 * arranque no parpadee.
 */
export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => readStoredLang() ?? detectLanguage());

  const setLang = useCallback((next) => {
    if (!CATALOGS[next]) return;
    setLangState(next);
    try {
      localStorage.setItem(KEY_LANG, next);
    } catch {
      // Modo privado o almacenamiento lleno: el idioma dura la sesión y ya.
    }
  }, []);

  // Para lectores de pantalla y para que el navegador aplique guionado y
  // corrección ortográfica del idioma correcto.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo(() => {
    const t = createTranslator(lang);
    return {
      lang,
      setLang,
      t,
      clock: (ts) => formatClock(ts, lang),
      date: (ts) => formatDate(ts, lang),
      weekday: (ts) => formatWeekday(ts, lang),
    };
  }, [lang, setLang]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useI18n necesita estar dentro de <LanguageProvider>');
  return ctx;
}

function readStoredLang() {
  try {
    const stored = localStorage.getItem(KEY_LANG);
    return stored && CATALOGS[stored] ? stored : null;
  } catch {
    return null;
  }
}

export { DEFAULT_LANG };
