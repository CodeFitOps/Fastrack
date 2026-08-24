import { useState } from 'react';
import { EVENT_KINDS, EVENT_KIND_IDS } from '../core/events.js';
import { useDismissable } from './useDismissable.js';
import { useI18n } from '../i18n/LanguageProvider.jsx';

/**
 * Hoja de registro rápido.
 *
 * Dos pasos: elegir tipo, rellenar. El primer paso es una rejilla de botones
 * grandes porque esto se usa con una mano, a menudo mientras pasa otra cosa —
 * al salir del gimnasio, en la mesa.
 *
 * La hora es editable y por defecto es "ahora". Poder retrasarla es lo que hace
 * que el registro sea honesto: si te acuerdas a las 22:00 de la medición de las
 * 18:30, la gráfica necesita las 18:30.
 */
export function LogSheet({ open, onClose, onSubmit, isFasting }) {
  const [kind, setKind] = useState(null);
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [timeMode, setTimeMode] = useState('now');
  const [customTime, setCustomTime] = useState(() => toTimeInput(Date.now()));
  const [error, setError] = useState(null);
  const { t } = useI18n();

  // Debe ir antes del early return: los hooks no pueden ser condicionales.
  useDismissable(open, onClose);

  if (!open) return null;

  const def = kind ? EVENT_KINDS[kind] : null;

  const reset = () => {
    setKind(null);
    setValue('');
    setLabel('');
    setNote('');
    setTimeMode('now');
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    const at = timeMode === 'now' ? Date.now() : fromTimeInput(customTime);
    const numeric = def.numeric && value !== '' ? Number(value) : undefined;

    if (def.numeric && value !== '' && !Number.isFinite(numeric)) {
      setError(t('log.notANumber'));
      return;
    }
    if (def.numeric && value === '' && kind !== 'note') {
      setError(t('log.missingValue', { unit: def.unit ?? '' }).trim());
      return;
    }

    try {
      // Las sensaciones guardan la clave; el resto, texto libre del usuario.
      const isOptionList = Boolean(def.optionKeys);
      await onSubmit({
        kind,
        at,
        value: numeric,
        labelKey: isOptionList ? label || undefined : undefined,
        label: isOptionList ? undefined : label || undefined,
        note: note || undefined,
      });
      close();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={close} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('log.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-head">
          <h6>{def ? t(def.labelKey).toUpperCase() : t('log.title')}</h6>
          <button type="button" className="btn btn-ghost" onClick={def ? () => setKind(null) : close}>
            {def ? t('common.back') : t('common.cancel')}
          </button>
        </header>

        {!def && (
          <div className="log-kinds">
            {EVENT_KIND_IDS.map((id) => (
              <button key={id} type="button" className="log-kind" onClick={() => setKind(id)}>
                {t(EVENT_KINDS[id].labelKey)}
              </button>
            ))}
          </div>
        )}

        {def && (
          <div className="log-form">
            {/* Aviso, no bloqueo: la persona sabe mejor que la app qué ha hecho. */}
            {isFasting && def.breaksFast && (
              <p className="log-warn">{t('log.breaksFast')}</p>
            )}

            {def.numeric && (
              <div className="field">
                <label htmlFor="log-value">
                  {t('log.value')} {def.unit ? `(${def.unit})` : ''}
                </label>
                <input
                  id="log-value"
                  className="input"
                  type="number"
                  inputMode="decimal"
                  step={def.step ?? 1}
                  min={def.min}
                  max={def.max}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  autoFocus
                />
              </div>
            )}

            {def.optionKeys && (
              <div className="log-options">
                {def.optionKeys.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={label === key ? 'tag tag-accent log-option' : 'tag tag-neutral log-option'}
                    onClick={() => setLabel(key)}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            )}

            {def.placeholderKey && (
              <div className="field">
                <label htmlFor="log-label">{t(def.placeholderKey).toUpperCase()}</label>
                <input
                  id="log-label"
                  className="input"
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
            )}

            <div className="field">
              <label>{t('log.time')}</label>
              <div className="log-time">
                <div className="seg">
                  <label className="seg-opt">
                    <input
                      type="radio"
                      name="when"
                      checked={timeMode === 'now'}
                      onChange={() => setTimeMode('now')}
                    />
                    {t('log.now')}
                  </label>
                  <label className="seg-opt">
                    <input
                      type="radio"
                      name="when"
                      checked={timeMode === 'custom'}
                      onChange={() => setTimeMode('custom')}
                    />
                    {t('log.other')}
                  </label>
                </div>
                {timeMode === 'custom' && (
                  <input
                    className="input log-time-input"
                    type="time"
                    value={customTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                  />
                )}
              </div>
            </div>

            <div className="field">
              <label htmlFor="log-note">{t('log.note')} {t('common.optional')}</label>
              <input
                id="log-note"
                className="input"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            {error && <p className="log-error">{error}</p>}

            <button type="button" className="btn btn-primary btn-block" onClick={submit}>
              {t('common.save')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function toTimeInput(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Una hora suelta se interpreta como la más reciente ya pasada. Si son las
 * 00:30 y anotas «23:40», te refieres a hace cincuenta minutos, no a dentro de
 * casi un día — así que se resta un día cuando la hora cae en el futuro.
 */
function fromTimeInput(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1);
  return d.getTime();
}
