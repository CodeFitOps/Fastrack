import {
  formatDuration,
  progress,
  remainingMs,
  overtimeMs,
  isOpenEnded,
  elapsedMs,
} from '../core/fastSession.js';
import { useState } from 'react';
import { STAGES, stageStatus, protocolLabel, protocolById } from '../core/protocols.js';
import { useI18n } from '../i18n/LanguageProvider.jsx';
import { ProtocolSheet } from './ProtocolSheet.jsx';
import { LogSheet } from './LogSheet.jsx';
import { EditStartSheet } from './EditStartSheet.jsx';
import { FastTimeline } from './FastTimeline.jsx';

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
export function TodayScreen({ tracker }) {
  const {
    session, events, now, isFasting, elapsed,
    begin, changeStart, finish, log, removeEvent,
    canControl, canEditFast, controlBlockedReason,
  } = tracker;
  const [picking, setPicking] = useState(false);
  const [logging, setLogging] = useState(false);
  const [editingStart, setEditingStart] = useState(false);
  const { t, clock } = useI18n();

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
          {isFasting ? t('today.fasting') : t('today.eating')}
        </span>
        <span className="today-proto">
          {session ? protocolLabel(protocolById(session.protocolId) ?? session, t) : t('common.none')}
        </span>
      </header>

      {/* Tabular numerals so the clock does not shift width as digits change. */}
      <div className="today-clock" style={{ color: stateColor }}>
        {formatDuration(elapsed)}
      </div>

      <div className="today-sub">
        <strong className="today-pct">
          {openEnded ? '—' : `${Math.round(pct * 100)}%`}
        </strong>
        <span className="text-muted">{subLine({ session, openEnded, left, over, t })}</span>
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
          <dt>{t('today.started')}</dt>
          <dd>
            {isFasting && canEditFast ? (
              // Pulsable: corregir el inicio es justo lo que hace falta cuando
              // se cae en la cuenta de que se llevaba más rato ayunando.
              <button
                type="button"
                className="today-edit-start"
                onClick={() => setEditingStart(true)}
              >
                {clock(session.startedAt)}
              </button>
            ) : (
              session ? clock(session.startedAt) : t('common.none')
            )}
          </dd>
        </div>
        <div>
          <dt>{isFasting ? t('today.targetEnds') : t('today.lastFast')}</dt>
          <dd>
            {session && !openEnded ? clock(session.startedAt + session.targetMs) : t('common.none')}
          </dd>
        </div>
      </dl>

      <h6>{t('today.stage')}</h6>
      <ol className="stage-ladder">
        {STAGES.map((stage) => {
          const status = stageStatus(stage, elapsed, isFasting);
          return (
            <li key={stage.id} className={`stage stage-${status}`}>
              <span className="stage-hour">{stage.hoursLabel}</span>
              <span className="stage-name">{t(stage.nameKey)}</span>
              <span className="stage-note text-muted">{t(stage.noteKey)}</span>
            </li>
          );
        })}
      </ol>

      {/* Registrar está disponible siempre, no sólo ayunando: una comida
          ocurre por definición en la ventana de comer. */}
      <div className="today-log">
        <div className="today-log-head">
          <h6>{t('today.log')}</h6>
          <button type="button" className="btn btn-ghost" onClick={() => setLogging(true)}>
            {t('common.add')}
          </button>
        </div>
        {isFasting ? (
          <FastTimeline session={session} events={events} now={now} onDelete={removeEvent} />
        ) : (
          <p className="timeline-empty text-muted">{t('log.emptyNoFast')}</p>
        )}
      </div>

      <button
        type="button"
        className={isFasting ? 'btn btn-primary btn-block' : 'btn btn-secondary btn-block'}
        disabled={!canControl}
        onClick={() => (isFasting ? finish() : setPicking(true))}
      >
        {isFasting ? t('today.end') : t('today.start')}
      </button>

      {/* Un botón deshabilitado sin explicación parece un fallo. */}
      {controlBlockedReason && (
        <p className="role-note text-muted">{t(controlBlockedReason)}</p>
      )}

      <LogSheet
        open={logging}
        isFasting={isFasting}
        onClose={() => setLogging(false)}
        onSubmit={log}
      />

      <EditStartSheet
        open={editingStart}
        session={session}
        onClose={() => setEditingStart(false)}
        onSubmit={async (ts) => {
          await changeStart(ts);
          setEditingStart(false);
        }}
      />

      <ProtocolSheet
        open={picking}
        onClose={() => setPicking(false)}
        onPick={async (protocolId, opts) => {
          await begin(protocolId, opts);
          setPicking(false);
        }}
      />
    </section>
  );
}

function subLine({ session, openEnded, left, over, t }) {
  if (!session) return t('today.noFast');
  if (openEnded) return t('today.openEnded');
  if (left > 0) return t('today.toGo', { time: formatDuration(left) });
  return t('today.past', { time: formatDuration(over) });
}

export { elapsedMs };
