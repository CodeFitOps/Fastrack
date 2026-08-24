/**
 * Tests de traducción.
 *
 * El más valioso es el primero: comparar los juegos de claves de los dos
 * catálogos. Sin él, añadir un texto en español y olvidarlo en inglés no
 * rompería nada — simplemente saldría la clave cruda en pantalla, y sólo se
 * descubriría usando la app en inglés y mirando esa pantalla concreta.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOGS,
  LANGUAGES,
  DEFAULT_LANG,
  createTranslator,
  detectLanguage,
  formatClock,
} from './index.js';
import { EVENT_KINDS } from '../core/events.js';
import { PROTOCOLS, STAGES } from '../core/protocols.js';

test('los dos catálogos tienen exactamente las mismas claves', () => {
  const es = Object.keys(CATALOGS.es).sort();
  const en = Object.keys(CATALOGS.en).sort();

  const faltanEnIngles = es.filter((k) => !en.includes(k));
  const faltanEnEspanol = en.filter((k) => !es.includes(k));

  assert.deepEqual(faltanEnIngles, [], 'claves sin traducir al inglés');
  assert.deepEqual(faltanEnEspanol, [], 'claves sin traducir al español');
});

test('los plurales están declarados igual en ambos idiomas', () => {
  for (const key of Object.keys(CATALOGS.es)) {
    const esPlural = typeof CATALOGS.es[key] === 'object';
    const enPlural = typeof CATALOGS.en[key] === 'object';
    assert.equal(esPlural, enPlural, `"${key}" es plural en un idioma y no en el otro`);
    if (esPlural) {
      for (const form of ['one', 'other']) {
        assert.ok(CATALOGS.es[key][form], `es "${key}" sin forma ${form}`);
        assert.ok(CATALOGS.en[key][form], `en "${key}" sin forma ${form}`);
      }
    }
  }
});

test('ningún catálogo tiene textos vacíos', () => {
  for (const [lang, catalog] of Object.entries(CATALOGS)) {
    for (const [key, value] of Object.entries(catalog)) {
      if (typeof value === 'string') {
        assert.ok(value.length > 0, `${lang} "${key}" está vacío`);
      }
    }
  }
});

test('toda clave usada por el núcleo existe en los dos catálogos', () => {
  const usadas = [
    ...Object.values(EVENT_KINDS).flatMap((k) => [
      k.labelKey,
      k.placeholderKey,
      ...(k.optionKeys ?? []),
    ]),
    ...PROTOCOLS.flatMap((p) => [p.labelKey, p.noteKey]),
    ...STAGES.flatMap((s) => [s.nameKey, s.noteKey]),
  ].filter(Boolean);

  for (const key of usadas) {
    for (const lang of Object.keys(CATALOGS)) {
      assert.ok(CATALOGS[lang][key] != null, `falta "${key}" en ${lang}`);
    }
  }
});

test('la interpolación sustituye las variables', () => {
  const t = createTranslator('es');
  assert.equal(t('today.toGo', { time: '02:14' }), 'quedan 02:14');
  assert.equal(createTranslator('en')('today.toGo', { time: '02:14' }), '02:14 to go');
});

test('una variable que falta deja el hueco visible en vez de "undefined"', () => {
  const t = createTranslator('es');
  assert.equal(t('today.toGo', {}), 'quedan {time}');
});

test('los plurales eligen la forma según count', () => {
  const es = createTranslator('es');
  assert.equal(es('journal.count', { count: 1 }), '1 registro');
  assert.equal(es('journal.count', { count: 5 }), '5 registros');

  const en = createTranslator('en');
  assert.equal(en('journal.count', { count: 1 }), '1 entry');
  assert.equal(en('journal.count', { count: 0 }), '0 entries');
});

test('una clave desconocida se devuelve tal cual, para que se vea', () => {
  const t = createTranslator('es');
  assert.equal(t('no.existe.esta.clave'), 'no.existe.esta.clave');
});

test('un idioma desconocido cae al idioma por defecto', () => {
  const t = createTranslator('klingon');
  assert.equal(t('tab.today'), CATALOGS[DEFAULT_LANG]['tab.today']);
});

test('se detecta el idioma del navegador, ignorando el país', () => {
  assert.equal(detectLanguage(['en-US', 'es']), 'en');
  assert.equal(detectLanguage(['es-AR']), 'es');
  assert.equal(detectLanguage(['fr-FR', 'en-GB']), 'en');
  assert.equal(detectLanguage(['fr-FR']), DEFAULT_LANG); // ninguno traducido
  assert.equal(detectLanguage([]), DEFAULT_LANG);
});

test('todos los idiomas anunciados tienen catálogo', () => {
  for (const l of LANGUAGES) {
    assert.ok(CATALOGS[l.id], `"${l.id}" está en la lista pero no tiene catálogo`);
  }
});

test('la hora se formatea con el locale del idioma', () => {
  const ts = new Date(2026, 0, 15, 14, 30).getTime();
  // Ambos locales usan 24h; lo que se comprueba es que no rompe ni cae a UTC.
  assert.match(formatClock(ts, 'es'), /14[:.]30/);
  assert.match(formatClock(ts, 'en'), /14[:.]30/);
});
