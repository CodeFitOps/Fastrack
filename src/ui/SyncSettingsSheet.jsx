import { useEffect, useState } from 'react';
import { ROLES } from '../core/roles.js';
import { SYNC_STATE } from '../platform/syncClient.js';
import { useDismissable } from './useDismissable.js';
import { useI18n } from '../i18n/LanguageProvider.jsx';

/**
 * Ajustes de sincronización.
 *
 * La URL se prueba antes de guardarla. Guardar una dirección mal escrita y
 * descubrirlo media hora después, cuando faltan datos en el otro dispositivo,
 * es mucho peor que un botón de comprobar.
 */
export function SyncSettingsSheet({ open, device, onClose, onSave, syncState, lastRun, onSyncNow }) {
  const { t, clock } = useI18n();
  const [url, setUrl] = useState('');
  const [role, setRole] = useState(ROLES.secondary);
  const [enabled, setEnabled] = useState(false);
  const [probe, setProbe] = useState(null);
  const [busy, setBusy] = useState(false);

  useDismissable(open, onClose);

  useEffect(() => {
    if (!open || !device) return;
    setUrl(device.serverUrl ?? '');
    setRole(device.role ?? ROLES.secondary);
    setEnabled(Boolean(device.syncEnabled));
    setProbe(null);
  }, [open, device]);

  if (!open) return null;

  const probeServer = async () => {
    setBusy(true);
    setProbe(null);
    try {
      const target = new URL('/health', normalise(url)).toString();
      const res = await fetch(target, { credentials: 'include' });
      const type = res.headers.get('content-type') ?? '';

      if (!type.includes('application/json')) {
        // Access devuelve su página de login con estado 200. Distinguirlo aquí
        // ahorra confusión: el servidor está bien, falta identificarse.
        setProbe({ ok: false, key: 'sync.probeNeedsAuth' });
      } else if (res.ok) {
        setProbe({ ok: true, key: 'sync.probeOk' });
      } else {
        setProbe({ ok: false, key: 'sync.probeBadStatus' });
      }
    } catch {
      // Un fallo de red aquí suele ser la URL mal, el servidor caído, o HTTPS
      // en una página servida por HTTP.
      setProbe({ ok: false, key: 'sync.probeUnreachable' });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    await onSave({ serverUrl: normalise(url), role, syncEnabled: enabled });
    onClose();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('sync.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-head">
          <h6>{t('sync.title')}</h6>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </header>

        <div className="sync-body">
          <div className="sync-status">
            <span className={`sync-dot sync-dot-${syncState}`} aria-hidden="true" />
            <span>{t(`sync.state.${syncState}`)}</span>
            {lastRun && (
              <span className="text-muted">{t('sync.lastRun', { time: clock(lastRun) })}</span>
            )}
          </div>

          <div className="field">
            <label htmlFor="sync-url">{t('sync.serverUrl')}</label>
            <input
              id="sync-url"
              className="input"
              type="url"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck="false"
              placeholder="https://fastrack.tudominio.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-block"
            disabled={busy || !url}
            onClick={probeServer}
          >
            {t('sync.probe')}
          </button>

          {probe && (
            <p className={probe.ok ? 'sync-probe-ok' : 'log-error'}>{t(probe.key)}</p>
          )}

          <div className="field">
            <label>{t('role.title')}</label>
            <div className="seg sync-roles">
              <label className="seg-opt">
                <input
                  type="radio"
                  name="role"
                  checked={role === ROLES.primary}
                  onChange={() => setRole(ROLES.primary)}
                />
                {t('role.primary')}
              </label>
              <label className="seg-opt">
                <input
                  type="radio"
                  name="role"
                  checked={role === ROLES.secondary}
                  onChange={() => setRole(ROLES.secondary)}
                />
                {t('role.secondary')}
              </label>
            </div>
            <p className="sync-hint text-muted">{t('role.explain')}</p>
          </div>

          <label className="radio sync-toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span className="dot" />
            {t('sync.enable')}
          </label>

          {/* Un solo dispositivo marcado como principal: si ambos lo fueran,
              dos ayunos distintos competirían y no hay forma de fusionarlos. */}
          {enabled && role === ROLES.primary && (
            <p className="sync-hint text-muted">{t('sync.onlyOnePrimary')}</p>
          )}

          {/* Explica por qué, con la sincronización apagada, este dispositivo
              puede empezar ayunos aunque esté marcado como secundario. */}
          {!enabled && (
            <p className="sync-hint text-muted">{t('sync.disabledMeansFullControl')}</p>
          )}

          {enabled && role === ROLES.secondary && (
            <p className="sync-hint text-muted">{t('sync.secondaryMeans')}</p>
          )}

          <button type="button" className="btn btn-primary btn-block" onClick={save}>
            {t('common.save')}
          </button>

          {device?.syncEnabled && (
            <button
              type="button"
              className="btn btn-ghost btn-block"
              onClick={onSyncNow}
              disabled={syncState === SYNC_STATE.syncing}
            >
              {t('sync.now')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Quita la barra final y añade el esquema si falta.
 *
 * Sin esto, `new URL('/sync', 'fastrack.midominio.com')` lanza, y el usuario ve
 * un fallo genérico por no haber escrito «https://».
 */
function normalise(raw) {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
