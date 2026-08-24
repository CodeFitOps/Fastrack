import { useEffect, useRef, useState } from 'react';
import { PROTOCOLS, protocolLabel } from '../core/protocols.js';
import { useI18n } from '../i18n/LanguageProvider.jsx';
import { useDismissable } from './useDismissable.js';
import { StartTimePicker } from './StartTimePicker.jsx';

/**
 * Hoja de selección de protocolo.
 *
 * Sin esto el botón "START A FAST" no tenía a dónde ir: `begin()` existía en
 * useFastTracker pero no lo llamaba nadie, así que la app no podía iniciar un
 * ayuno. Este es el camino que faltaba.
 *
 * Muestra `hoursLabel` como texto y pasa `p.id`; la duración real sale de
 * `targetMs` en protocols.js. Es justo el error del prototipo al revés — allí
 * la etiqueta ERA la fuente de la duración.
 */
export function ProtocolSheet({ open, onPick, onClose }) {
  const firstOption = useRef(null);
  const { t } = useI18n();
  const [chosen, setChosen] = useState(null);
  const [startedAt, setStartedAt] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  // Escape y el botón atrás de Android, ambos desde la pila de capas.
  useDismissable(open, onClose);

  useEffect(() => {
    if (!open) return;
    firstOption.current?.focus();
    // `now` se congela al abrir: si se recalculara en cada render, los atajos
    // ("hace 2 h") se moverían bajo el dedo mientras se elige.
    setNow(Date.now());
    setChosen(null);
    setStartedAt(null);
    setError(null);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="sheet-backdrop"
      onClick={onClose}
      role="presentation"
    >
      {/* El clic se detiene aquí para que tocar la hoja no la cierre. */}
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('protocol.pick')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-head">
          <h6>{chosen ? protocolLabel(chosen, t) : t('protocol.pick')}</h6>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={chosen ? () => setChosen(null) : onClose}
          >
            {chosen ? t('common.back') : t('common.cancel')}
          </button>
        </header>

        {!chosen && (
          <ul className="proto-list">
            {PROTOCOLS.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="proto-option"
                  ref={i === 0 ? firstOption : null}
                  onClick={() => {
                    setChosen(p);
                    setStartedAt(Date.now());
                    setNow(Date.now());
                  }}
                >
                  <span className="proto-label">{protocolLabel(p, t)}</span>
                  <span className="proto-hours">{p.hoursLabel}</span>
                  <span className="proto-note">{t(p.noteKey)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {chosen && (
          <div className="proto-start">
            <div className="field">
              <label>{t('fast.startedWhen')}</label>
              <StartTimePicker value={startedAt} onChange={setStartedAt} now={now} />
            </div>

            {error && <p className="log-error">{t(error)}</p>}

            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={async () => {
                try {
                  setError(null);
                  await onPick(chosen.id, { startedAt });
                } catch (e) {
                  // El núcleo lanza claves de traducción, no frases.
                  setError(e.message);
                }
              }}
            >
              {t('today.start')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
