import { useMemo, useState } from 'react';
import { EVENT_KINDS } from '../core/events.js';
import { formatDuration } from '../core/fastSession.js';
import {
  TIMEFRAMES,
  TIMEFRAME_IDS,
  resolveWindow,
  summariseWindow,
  splitByDay,
  fastingAt,
  positionInWindow,
  relativeDayKey,
} from '../core/timeframes.js';
import { useI18n } from '../i18n/LanguageProvider.jsx';

/**
 * Diario: todo lo registrado en el tramo elegido, ayunando o no.
 *
 * A diferencia de FastTimeline, que sólo enseña el ayuno en curso, esto es la
 * vista continua — la que deja ver el patrón real: a qué hora se come, cuándo se
 * entrena, cuándo suben las cetonas, y cómo encaja todo con las ventanas de
 * ayuno.
 */
export function JournalScreen({ events, history, session, now }) {
  const { t, date, clock } = useI18n();
  const [frame, setFrame] = useState('today');
  const [range, setRange] = useState(null); // rango a medida, si lo hay

  // La sesión en curso también es contexto: sin ella el día de hoy saldría
  // sin la banda de ayuno que lo explica.
  const sessions = useMemo(
    () => (session ? [...history, session] : history),
    [history, session]
  );

  const window = useMemo(
    () => (range ? resolveWindow(range, now) : resolveWindow(frame, now)),
    [frame, range, now]
  );

  const summary = useMemo(
    () => summariseWindow(events, window, { sessions, now }),
    [events, window, sessions, now]
  );

  const days = useMemo(
    () => splitByDay(events, window, { now }),
    [events, window, now]
  );

  return (
    <section className="journal">
      <div className="journal-frames" role="tablist" aria-label={t('journal.custom')}>
        {TIMEFRAME_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={!range && frame === id}
            className={!range && frame === id ? 'journal-frame journal-frame-on' : 'journal-frame'}
            onClick={() => {
              setRange(null);
              setFrame(id);
            }}
          >
            {t(TIMEFRAMES[id].labelKey)}
          </button>
        ))}
      </div>

      <CustomRange
        active={Boolean(range)}
        onApply={setRange}
        onClear={() => setRange(null)}
      />

      <div className="journal-summary">
        <div className="journal-summary-head">
          <h6>{windowLabel(window, t, date)}</h6>
          <span className="text-muted">
            {summary.count === 0
              ? t('journal.noRecords')
              : t('journal.count', { count: summary.count })}
          </span>
        </div>

        {summary.fastedMs > 0 && (
          <p className="journal-fasted">
            <strong>{formatDuration(summary.fastedMs).slice(0, 5)}</strong>
            <span className="text-muted"> {t('journal.fastedInRange')}</span>
          </p>
        )}

        {summary.kinds.length > 0 && (
          <ul className="journal-kinds">
            {summary.kinds.map((k) => (
              <li key={k.kind}>
                <span className="journal-kind-name">
                  {EVENT_KINDS[k.kind] ? t(EVENT_KINDS[k.kind].labelKey) : k.kind}
                </span>
                <span className="journal-kind-value">
                  {k.hasValues ? `${round(k.total)}${k.unit ? ` ${k.unit}` : ''}` : `×${k.count}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Eje del tramo: las bandas son ayunos, las marcas son eventos. Da la
          forma del periodo de un vistazo, antes de leer la lista. */}
      <WindowAxis window={window} summary={summary} now={now} />

      {days.length === 0 ? (
        <p className="journal-empty text-muted">{t('journal.empty')}</p>
      ) : (
        days.map((day) => (
          <div key={day.dayTs} className="journal-day">
            <h6 className="journal-day-label">{dayLabel(day.dayTs, now, t, date)}</h6>
            <ol className="journal-list">
              {day.events.map((e) => {
                const def = EVENT_KINDS[e.kind];
                const during = fastingAt(sessions, e.at, now);
                return (
                  <li key={e.id} className="journal-row">
                    <span className="journal-time">{clock(e.at)}</span>
                    <span className="journal-body">
                      <strong className="journal-kind">{def ? t(def.labelKey) : e.kind}</strong>
                      {e.value != null && (
                        <span className="journal-value">
                          {e.value}
                          {e.unit ? ` ${e.unit}` : ''}
                        </span>
                      )}
                      {e.labelKey && <span className="journal-label">{t(e.labelKey)}</span>}
                      {e.label && <span className="journal-label">{e.label}</span>}
                      {/* Saber si ocurrió ayunando cambia la lectura del dato. */}
                      {during && <span className="tag tag-accent journal-flag">{t('journal.duringFast')}</span>}
                      {e.migrated && (
                        <span className="journal-flag text-muted">{t('journal.migrated')}</span>
                      )}
                      {e.note && <span className="journal-note text-muted">{e.note}</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        ))
      )}
    </section>
  );
}

function WindowAxis({ window, summary, now }) {
  if (summary.count === 0 && summary.sessions.length === 0) return null;

  return (
    <div className="axis" aria-hidden="true">
      {summary.sessions.map((s) => {
        const from = positionInWindow(s.startedAt, window) * 100;
        const to = positionInWindow(s.endedAt ?? now, window) * 100;
        return (
          <i
            key={s.id ?? s.startedAt}
            className="axis-band"
            style={{ left: `${from}%`, width: `${Math.max(0.6, to - from)}%` }}
          />
        );
      })}
      {summary.events.map((e) => (
        <i
          key={e.id}
          className="axis-mark"
          style={{ left: `${positionInWindow(e.at, window) * 100}%` }}
        />
      ))}
    </div>
  );
}

function CustomRange({ active, onApply, onClear }) {
  const { t: tr } = useI18n();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState(null);

  if (!open) {
    return (
      <div className="journal-custom">
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
          {active ? tr('journal.customChange') : tr('journal.custom')}
        </button>
        {active && (
          <button type="button" className="btn btn-ghost" onClick={onClear}>
            {tr('journal.customClear')}
          </button>
        )}
      </div>
    );
  }

  const apply = () => {
    const f = Date.parse(from);
    const t = Date.parse(to);
    if (!Number.isFinite(f) || !Number.isFinite(t)) {
      setError('Faltan fechas');
      return;
    }
    if (t < f) {
      setError(tr('journal.badRange'));
      return;
    }
    // `to` es exclusivo, así que se extiende al final del día elegido para que
    // ese día quede incluido — es lo que espera cualquiera al elegir un rango.
    const end = new Date(t);
    end.setHours(23, 59, 59, 999);
    onApply({ from: f, to: end.getTime() + 1 });
    setError(null);
    setOpen(false);
  };

  return (
    <div className="journal-range">
      <div className="field">
        <label htmlFor="range-from">{tr('journal.from')}</label>
        <input id="range-from" className="input" type="date" value={from}
          onChange={(e) => setFrom(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="range-to">{tr('journal.to')}</label>
        <input id="range-to" className="input" type="date" value={to}
          onChange={(e) => setTo(e.target.value)} />
      </div>
      {error && <p className="log-error">{error}</p>}
      <div className="journal-range-actions">
        <button type="button" className="btn btn-primary" onClick={apply}>{tr('journal.apply')}</button>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
          {tr('common.cancel')}
        </button>
      </div>
    </div>
  );
}

const round = (n) => (Number.isInteger(n) ? n : Number(n.toFixed(1)));

/** Etiqueta de la ventana: preset traducido, día relativo, o rango de fechas. */
function windowLabel(window, t, date) {
  if (window.labelKey) return t(window.labelKey);
  if (window.dayTs != null) return dayLabel(window.dayTs, Date.now(), t, date);
  return `${date(window.from)} – ${date(window.to - 1)}`;
}

function dayLabel(dayTs, now, t, date) {
  const key = relativeDayKey(dayTs, now);
  return key ? t(key) : date(dayTs);
}
