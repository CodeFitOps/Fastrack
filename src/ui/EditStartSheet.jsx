import { useEffect, useState } from 'react';
import { formatDuration, isOpenEnded, isComplete } from '../core/fastSession.js';
import { useDismissable } from './useDismissable.js';
import { StartTimePicker } from './StartTimePicker.jsx';
import { useI18n } from '../i18n/LanguageProvider.jsx';

/**
 * Corregir la hora de inicio de un ayuno en curso.
 *
 * Muestra en vivo el efecto del cambio —cuánto pasa a llevar— porque mover el
 * inicio de un ayuno no es una edición inocua: cambia el progreso, la etapa
 * metabólica y el momento en que salta la alerta. Verlo antes de guardar evita
 * confirmar un dedazo.
 */
export function EditStartSheet({ open, session, onClose, onSubmit }) {
  const { t } = useI18n();
  const [startedAt, setStartedAt] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState(null);

  useDismissable(open, onClose);

  useEffect(() => {
    if (!open || !session) return;
    setStartedAt(session.startedAt);
    setNow(Date.now());
    setError(null);
  }, [open, session]);

  if (!open || !session) return null;

  const preview = startedAt != null ? Math.max(0, now - startedAt) : 0;
  const openEnded = isOpenEnded(session);
  const wouldComplete = !openEnded && startedAt != null
    && isComplete({ ...session, startedAt }, now);

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('fast.editStart')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-head">
          <h6>{t('fast.editStart')}</h6>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </header>

        <div className="proto-start">
          <StartTimePicker value={startedAt} onChange={setStartedAt} now={now} />

          <div className="editstart-preview">
            <span className="text-muted">{t('fast.wouldBe')}</span>
            <strong>{formatDuration(preview)}</strong>
          </div>

          {/* Aviso, no bloqueo: es legítimo caer en la cuenta tarde de que ya
              se había superado el objetivo. */}
          {wouldComplete && (
            <p className="log-warn">{t('fast.alreadyComplete')}</p>
          )}

          {error && <p className="log-error">{t(error)}</p>}

          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={async () => {
              try {
                setError(null);
                await onSubmit(startedAt);
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
