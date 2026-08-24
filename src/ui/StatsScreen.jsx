import { useMemo } from 'react';
import { formatDuration } from '../core/fastSession.js';
import { summarise } from '../core/stats.js';
import { useI18n } from '../i18n/LanguageProvider.jsx';

const H = 3600_000;
const LEVEL_FILL = {
  0: 'var(--color-bg)',
  1: 'var(--color-neutral-400)',
  2: 'var(--color-text)',
  3: 'var(--color-accent)',
};

/**
 * Screen 1a, Stats tab.
 *
 * Every figure the prototype hardcoded — 24 fasts, 17:12 average, 96:40 this
 * week, an 11-day streak, a fixed 35-cell grid — now comes out of summarise().
 *
 * The one panel not ported is the 14-day ketones sparkline. Its polyline points
 * were a hand-drawn literal, and nothing in the data model records ketone
 * readings over time yet; see the note at the bottom of this file.
 */
export function StatsScreen({ history }) {
  const { t, weekday, date } = useI18n();
  const s = useMemo(() => summarise(history), [history]);
  const peak = Math.max(24, ...s.week.map((d) => d.hours));

  return (
    <section className="stats">
      <div className="stats-panel">
        <h6>{t('stats.week')}</h6>
        <div className="stats-headline">
          <strong>{formatHM(s.weekMs)}</strong>
          <span className="text-muted">{deltaLabel(s.weekDeltaMs, t)}</span>
        </div>

        <div className="week-chart">
          {s.week.map((d) => (
            <div key={d.dayTs} className="week-col">
              <span className="week-hours">{Math.floor(d.hours).toString().padStart(2, '0')}</span>
              <div
                className="week-bar"
                style={{
                  height: `${(d.hours / peak) * 100}%`,
                  background: d.hours >= 24 ? 'var(--color-accent)' : 'var(--color-text)',
                }}
              />
            </div>
          ))}
        </div>
        <div className="week-labels">
          {s.week.map((d) => (
            <span key={d.dayTs}>{d.weekday}</span>
          ))}
        </div>
      </div>

      <dl className="stats-grid">
        <Stat label={t('stats.avgFast')} value={s.averageMs ? formatHM(s.averageMs) : t('common.none')} />
        <Stat label={t('stats.streak')} value={t('stats.streakDays', { days: s.streakDays })} accent />
        <Stat label={t('stats.longest')} value={s.longestMs ? formatHM(s.longestMs) : t('common.none')} />
        <Stat label={t('stats.daysLogged')} value={t('stats.daysLoggedValue', { days: s.daysLogged })} />
      </dl>

      <div className="stats-panel">
        <h6>{t('stats.consistency')}</h6>
        <div className="consistency-grid">
          {s.grid.map((c) => (
            <div
              key={c.dayTs}
              className="consistency-cell"
              style={{ background: LEVEL_FILL[c.level] }}
              title={`${date(c.dayTs)} — ${c.hours.toFixed(1)}h`}
            />
          ))}
        </div>
        <ul className="consistency-legend text-muted">
          <li><i style={{ background: LEVEL_FILL[0] }} />{t('stats.legend.none')}</li>
          <li><i style={{ background: LEVEL_FILL[1] }} />{t('stats.legend.under16')}</li>
          <li><i style={{ background: LEVEL_FILL[2] }} />{t('stats.legend.over16')}</li>
          <li><i style={{ background: LEVEL_FILL[3] }} />{t('stats.legend.over24')}</li>
        </ul>
      </div>
    </section>
  );
}

function Stat({ label, value, accent = false }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd style={accent ? { color: 'var(--color-accent)' } : undefined}>{value}</dd>
    </div>
  );
}

function formatHM(ms) {
  return formatDuration(ms).slice(0, 5);
}

function deltaLabel(deltaMs, t) {
  if (deltaMs === 0) return t('stats.sameAsLast');
  const sign = deltaMs > 0 ? '+' : '−';
  return t('stats.vsLast', { delta: `${sign}${formatHM(Math.abs(deltaMs))}` });
}

/*
 * NOT PORTED — the ketones sparkline.
 *
 * The prototype drew it from a literal polyline. Reproducing it would mean
 * shipping a chart that shows the same invented curve to every user regardless
 * of what they logged, which is worse than showing nothing.
 *
 * To build it for real: store a { at, mmol } reading on each log entry, then
 * plot the last 14 days. The log sheet already collects a ketones field, so the
 * capture side mostly exists — it just is not persisted with a timestamp yet.
 */
export const KETONES_CHART_TODO = { requires: 'timestamped ketone readings' };
