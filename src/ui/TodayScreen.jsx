import {
  formatDuration,
  progress,
  remainingMs,
  overtimeMs,
  isOpenEnded,
  elapsedMs,
} from '../core/fastSession.js';
import { STAGES, stageStatus } from '../core/protocols.js';
import { useFastTracker } from './useFastTracker.js';

/**
 * The prototype's screen 1a, ported off the dc-runtime.
 *
 * Translation reference for the remaining screens:
 *   {{ expr }}                 →  {expr}
 *   <sc-if value="{{ c }}">    →  {c && ( … )}
 *   <sc-for list="{{ xs }}" as="x">  →  {xs.map(x => ( … ))}
 *   renderVals() view-model    →  values computed in the component body
 *
 * Colours and spacing come from the design system's CSS custom properties
 * instead of the inline hex and px the prototype used — those trip the
 * project's own _adherence.oxlintrc.json ("Raw hex color — use a design-system
 * color token via var()"). The tokens already exist in styles.css; the
 * prototype simply predated using them.
 */
export function TodayScreen() {
  const { session, hydrated, now, isFasting, elapsed, finish } = useFastTracker();

  if (!hydrated) return <div className="today-loading">Loading</div>;

  const openEnded = session ? isOpenEnded(session) : false;
  const pct = session && !openEnded ? progress(session, now) : 0;
  const left = session && !openEnded ? remainingMs(session, now) : null;
  const over = session && !openEnded ? overtimeMs(session, now) : null;

  // The live fast is the one place the accent runs; everything else is ink.
  const stateColor = isFasting ? 'var(--color-accent)' : 'var(--color-text)';

  return (
    <section className="today">
      <header className="today-head">
        <span className="today-state" style={{ color: stateColor }}>
          {isFasting ? 'FASTING' : 'EATING WINDOW'}
        </span>
        <span className="today-proto">{session?.protocolLabel ?? '—'}</span>
      </header>

      {/* Tabular numerals so the clock does not shift width as digits change. */}
      <div className="today-clock" style={{ color: stateColor }}>
        {formatDuration(elapsed)}
      </div>

      <div className="today-sub">
        <strong className="today-pct">
          {openEnded ? '—' : `${Math.round(pct * 100)}%`}
        </strong>
        <span className="text-muted">{subLine({ session, openEnded, left, over })}</span>
      </div>

      {/* An open-ended fast has nothing to fill a progress bar against. */}
      {session && !openEnded && (
        <div className="today-bar">
          <div
            className="today-bar-fill"
            style={{ width: `${pct * 100}%`, background: stateColor }}
            role="progressbar"
            aria-valuenow={Math.round(pct * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      )}

      <dl className="today-times">
        <div>
          <dt>STARTED</dt>
          <dd>{session ? clockTime(session.startedAt) : '—'}</dd>
        </div>
        <div>
          <dt>{isFasting ? 'TARGET ENDS' : 'LAST FAST'}</dt>
          <dd>
            {session && !openEnded ? clockTime(session.startedAt + session.targetMs) : '—'}
          </dd>
        </div>
      </dl>

      <h6>METABOLIC STAGE</h6>
      <ol className="stage-ladder">
        {STAGES.map((stage) => {
          const status = stageStatus(stage, elapsed, isFasting);
          return (
            <li key={stage.name} className={`stage stage-${status}`}>
              <span className="stage-hour">{stage.hoursLabel}</span>
              <span className="stage-name">{stage.name}</span>
              <span className="stage-note text-muted">{stage.note}</span>
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        className={isFasting ? 'btn btn-primary btn-block' : 'btn btn-secondary btn-block'}
        onClick={() => (isFasting ? finish() : null)}
      >
        {isFasting ? 'END FAST + LOG' : 'START A FAST'}
      </button>
    </section>
  );
}

function subLine({ session, openEnded, left, over }) {
  if (!session) return 'no active fast — pick a protocol to begin';
  if (openEnded) return 'no target — running until you stop it';
  if (left > 0) return `${formatDuration(left)} to go`;
  return `target passed by ${formatDuration(over)}`;
}

/**
 * Local wall-clock time. Unlike elapsed duration, this is deliberately
 * timezone-aware: a fast started at 20:05 should read 20:05 in whatever zone
 * the person was in, and the stored epoch timestamp is unaffected either way.
 */
function clockTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export { elapsedMs };
