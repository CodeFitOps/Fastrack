import { useEffect, useState } from 'react';
import { validateStart } from '../core/fastSession.js';
import { useI18n } from '../i18n/LanguageProvider.jsx';

const H = 3600_000;

/** Atajos: los desfases habituales al caer en la cuenta de que ya se ayunaba. */
const QUICK = [
  { key: 'startNow', ms: 0 },
  { key: 'start2h', ms: 2 * H },
  { key: 'start4h', ms: 4 * H },
  { key: 'start8h', ms: 8 * H },
];

/**
 * Elegir cuándo empezó el ayuno.
 *
 * Los atajos cubren el caso real —«llevo unas horas, no sé exactamente»— con un
 * toque. El campo exacto está para quien sí lo sabe.
 *
 * Se usa `datetime-local` y no sólo la hora porque un ayuno prolongado puede
 * haber empezado anteayer, y una hora suelta no distingue eso. En móvil abre el
 * selector nativo, así que no cuesta más que un campo de hora.
 */
export function StartTimePicker({ value, onChange, now }) {
  const { t } = useI18n();
  const [mode, setMode] = useState('quick');
  const [exact, setExact] = useState(() => toLocalInput(value ?? now));

  // Si el valor cambia desde fuera (otro atajo), el campo exacto lo sigue.
  useEffect(() => {
    if (value != null) setExact(toLocalInput(value));
  }, [value]);

  const problem = value != null ? validateStart(value, now) : null;
  const offset = value != null ? now - value : 0;

  return (
    <div className="startpick">
      <div className="startpick-quick">
        {QUICK.map((q) => {
          const ts = now - q.ms;
          const active = mode === 'quick' && value != null && Math.abs(value - ts) < 60_000;
          return (
            <button
              key={q.key}
              type="button"
              className={active ? 'tag tag-accent startpick-opt' : 'tag tag-neutral startpick-opt'}
              onClick={() => {
                setMode('quick');
                onChange(now - q.ms);
              }}
            >
              {t(`fast.${q.key}`)}
            </button>
          );
        })}
        <button
          type="button"
          className={mode === 'exact' ? 'tag tag-accent startpick-opt' : 'tag tag-neutral startpick-opt'}
          onClick={() => setMode('exact')}
        >
          {t('fast.startExact')}
        </button>
      </div>

      {mode === 'exact' && (
        <input
          className="input startpick-input"
          type="datetime-local"
          value={exact}
          // El navegador ya impide elegir el futuro, pero la validación de
          // arriba se mantiene: un max en el DOM no es una garantía.
          max={toLocalInput(now)}
          onChange={(e) => {
            setExact(e.target.value);
            const ts = fromLocalInput(e.target.value);
            if (ts != null) onChange(ts);
          }}
        />
      )}

      {problem ? (
        <p className="log-error">{t(problem)}</p>
      ) : (
        offset > 60_000 && (
          <p className="startpick-note text-muted">
            {t('fast.startedAgo', { time: humanOffset(offset, t) })}
          </p>
        )
      )}
    </div>
  );
}

function humanOffset(ms, t) {
  const hours = Math.floor(ms / H);
  const mins = Math.round((ms % H) / 60_000);
  if (hours === 0) return t('fast.minutes', { count: mins });
  if (mins === 0) return t('fast.hours', { count: hours });
  return `${t('fast.hours', { count: hours })} ${t('fast.minutes', { count: mins })}`;
}

/** Epoch ms → 'YYYY-MM-DDTHH:mm' en hora local, que es lo que espera el input. */
function toLocalInput(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(text) {
  const ts = new Date(text).getTime();
  return Number.isFinite(ts) ? ts : null;
}
