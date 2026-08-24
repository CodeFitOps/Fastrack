import { formatDuration } from '../core/fastSession.js';
import { durationMs, averageDurationMs, completedCount } from '../core/stats.js';
import { protocolById, protocolLabel } from '../core/protocols.js';
import { useI18n } from '../i18n/LanguageProvider.jsx';

const DAY_MS = 86_400_000;

/**
 * Screen 1a, History tab.
 *
 * The prototype's history entries carried pre-formatted display strings —
 * dur: '16:40', window: '20:05 → 12:45', barW: '69%', date: 'MON 03 AUG'.
 * Real entries store timestamps, so every one of those is derived here. That is
 * the right direction: a stored '16:40' cannot be re-sorted, re-summed, or
 * re-rendered in another locale.
 */
export function HistoryScreen({ history }) {
  const { t, date, clock } = useI18n();
  const done = history.filter((h) => h.endedAt != null);
  const average = averageDurationMs(history);

  if (done.length === 0) {
    return (
      <section className="history">
        <p className="text-muted history-empty">{t('history.empty')}</p>
      </section>
    );
  }

  return (
    <section className="history">
      <header className="history-head">
        <h6>{t('history.last30')}</h6>
        <div className="history-summary">
          <strong className="history-count">
            {completedCount(history, { sinceMs: 30 * DAY_MS })}
          </strong>
          <span className="text-muted">
            {t('history.completed')}
            {average ? t('history.average', { time: formatHM(average) }) : ''}
          </span>
        </div>
      </header>

      <ol className="history-list">
        {[...done]
          .sort((a, b) => b.endedAt - a.endedAt)
          .map((entry) => (
            <HistoryRow key={entry.id ?? entry.endedAt} entry={entry} t={t} date={date} clock={clock} />
          ))}
      </ol>
    </section>
  );
}

function HistoryRow({ entry, t, date, clock }) {
  const ms = durationMs(entry);
  // The bar reads against a 24h ceiling, as in the design.
  const barPct = Math.min(100, (ms / DAY_MS) * 100);
  const isExtended = entry.protocolId === 'extended';

  return (
    <li className="history-row">
      <div className="history-row-head">
        <span className="history-date">{date(entry.endedAt)}</span>
        <span className={isExtended ? 'tag tag-accent' : 'tag tag-neutral'}>
          {entry.protocolId
            ? protocolLabel(protocolById(entry.protocolId) ?? entry, t)
            : t('common.none')}
        </span>
      </div>

      <div className="history-row-main">
        <strong className="history-dur">{formatHM(ms)}</strong>
        <span className="text-muted history-window">
          {clock(entry.startedAt)} → {clock(entry.endedAt)}
        </span>
      </div>

      <div className="history-bar">
        <div className="history-bar-fill" style={{ width: `${barPct}%` }} />
      </div>

      {(entry.kcal || entry.ketones || entry.water) && (
        <div className="history-metrics">
          {entry.kcal && <span>{entry.kcal} KCAL</span>}
          {entry.ketones && <span>{entry.ketones} mmol/L</span>}
          {entry.water && <span>{entry.water}</span>}
        </div>
      )}

      {entry.note && <p className="history-note text-muted">{entry.note}</p>}
    </li>
  );
}

/** Duration as HH:MM — the seconds in a history row are noise. */
function formatHM(ms) {
  return formatDuration(ms).slice(0, 5);
}

