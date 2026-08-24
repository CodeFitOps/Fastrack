import { LANGUAGES } from '../i18n/index.js';
import { useI18n } from '../i18n/LanguageProvider.jsx';

/**
 * Cambio de idioma.
 *
 * Dos idiomas caben como par de botones en la cabecera; no merece una pantalla
 * de ajustes propia todavía. Si se añade un tercero, esto pasa a ser un
 * desplegable.
 */
export function LanguagePicker() {
  const { lang, setLang, t } = useI18n();

  return (
    <div className="lang-picker" role="group" aria-label={t('settings.language')}>
      {LANGUAGES.map((l) => (
        <button
          key={l.id}
          type="button"
          className={l.id === lang ? 'lang-opt lang-opt-on' : 'lang-opt'}
          aria-pressed={l.id === lang}
          onClick={() => setLang(l.id)}
        >
          {l.id.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
