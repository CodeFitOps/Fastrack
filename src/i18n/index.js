/**
 * Traducción, sin librería.
 *
 * Un catálogo plano por idioma, interpolación con `{nombre}` y plurales. No usa
 * i18next ni similares: aquí harían falta unos 40 kB de bundle para resolver un
 * problema de cuarenta líneas, y esta app se empaqueta para móvil.
 *
 * Regla del proyecto: **ningún texto visible se escribe en un componente**.
 * Todo pasa por `t()`. Es lo que permite que añadir un tercer idioma sea copiar
 * un fichero, en vez de rebuscar cadenas por veinte componentes.
 */

import { es } from './es.js';
import { en } from './en.js';

export const CATALOGS = { es, en };
export const LANGUAGES = [
  { id: 'es', label: 'Español' },
  { id: 'en', label: 'English' },
];

export const DEFAULT_LANG = 'es';

/** Locale para fechas y números. Distinto del catálogo: 'es' → 'es-ES'. */
export const LOCALES = { es: 'es-ES', en: 'en-GB' };

/**
 * Idioma del sistema, si lo tenemos traducido.
 *
 * Se mira el idioma del navegador, no el país: alguien con el móvil en inglés
 * viviendo en España quiere la app en inglés.
 */
export function detectLanguage(navigatorLanguages) {
  const list = navigatorLanguages
    ?? (typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []);
  for (const tag of list ?? []) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (CATALOGS[base]) return base;
  }
  return DEFAULT_LANG;
}

/**
 * Crea la función de traducción para un idioma.
 *
 * `t('log.saved')`
 * `t('journal.count', { count: 3 })`      → plurales
 * `t('fast.goalIn', { time: '02:14' })`   → interpolación
 *
 * Si falta una clave devuelve la clave misma, en vez de una cadena vacía: un
 * hueco en la interfaz es invisible en una revisión rápida, pero
 * `journal.count` a la vista salta enseguida. Hay además un test que compara
 * los catálogos, así que en teoría no debería pasar nunca.
 */
export function createTranslator(lang) {
  const catalog = CATALOGS[lang] ?? CATALOGS[DEFAULT_LANG];
  const fallback = CATALOGS[DEFAULT_LANG];

  return function t(key, vars) {
    let entry = catalog[key] ?? fallback[key];
    if (entry == null) return key;

    // Plurales: la entrada es { one, other } y se elige con `count`.
    if (typeof entry === 'object') {
      const n = vars?.count;
      entry = (n === 1 ? entry.one : entry.other) ?? entry.other;
    }

    if (!vars) return entry;
    return entry.replace(/\{(\w+)\}/g, (match, name) =>
      Object.hasOwn(vars, name) ? String(vars[name]) : match
    );
  };
}

/* ── formato de fechas y horas ─────────────────────────────────────── */

/**
 * Hora del reloj. `hour12` se deja al locale: en inglés británico y en español
 * es de 24 horas, pero si algún día se añade en-US saldrá con AM/PM sin tocar
 * nada.
 */
export function formatClock(ts, lang) {
  return new Date(ts).toLocaleTimeString(LOCALES[lang] ?? LOCALES[DEFAULT_LANG], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(ts, lang) {
  return new Date(ts)
    .toLocaleDateString(LOCALES[lang] ?? LOCALES[DEFAULT_LANG], {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    })
    .toUpperCase();
}

export function formatWeekday(ts, lang) {
  return new Date(ts)
    .toLocaleDateString(LOCALES[lang] ?? LOCALES[DEFAULT_LANG], { weekday: 'short' })
    .toUpperCase();
}
