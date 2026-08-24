import { EVENT_KINDS, eventsDuring, positionInSession, isBackdated } from '../core/events.js';
import { formatDuration } from '../core/fastSession.js';
import { useI18n } from '../i18n/LanguageProvider.jsx';

/**
 * Línea de tiempo del ayuno en curso.
 *
 * Coloca cada evento en el punto del ayuno en que ocurrió, y muestra a su lado
 * las horas transcurridas — que es la lectura útil aquí. «Cetonas 1.4 a las
 * 18:30» dice poco; «cetonas 1.4 a las 14h de ayuno» es lo que se compara entre
 * un día y otro.
 */
export function FastTimeline({ session, events, now, onDelete }) {
  const { t } = useI18n();
  if (!session) return null;

  const during = eventsDuring(events, session, now);
  if (during.length === 0) {
    return (
      <p className="timeline-empty text-muted">{t('log.empty')}</p>
    );
  }

  return (
    <ol className="timeline">
      {during.map((e) => {
        const def = EVENT_KINDS[e.kind];
        const pct = positionInSession(e, session, now) * 100;
        const elapsed = e.at - session.startedAt;

        return (
          <li key={e.id} className="timeline-item">
            <span className="timeline-elapsed">{formatDuration(elapsed).slice(0, 5)}</span>

            <span className="timeline-track" aria-hidden="true">
              <i className="timeline-dot" style={{ left: `${pct}%` }} />
            </span>

            <span className="timeline-body">
              <strong className="timeline-kind">{def ? t(def.labelKey) : e.kind}</strong>
              {e.value != null && (
                <span className="timeline-value">
                  {e.value}
                  {e.unit ? ` ${e.unit}` : ''}
                </span>
              )}
              {e.labelKey && <span className="timeline-label">{t(e.labelKey)}</span>}
              {e.label && <span className="timeline-label">{e.label}</span>}
              {/* Un valor anotado horas después no merece la misma confianza. */}
              {isBackdated(e) && <span className="timeline-flag text-muted">{t('log.backdated')}</span>}
              {e.note && <span className="timeline-note text-muted">{e.note}</span>}
            </span>

            {onDelete && (
              <button
                type="button"
                className="btn btn-ghost timeline-del"
                onClick={() => onDelete(e.id)}
                aria-label={t('common.delete', { what: def ? t(def.labelKey) : e.kind })}
              >
                ×
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
