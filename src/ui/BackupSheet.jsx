import { useState } from 'react';
import {
  buildBackup,
  serializeBackup,
  backupFilename,
  parseBackup,
  mergeBackup,
} from '../core/backup.js';
import { snapshot, restoreMerged, wipeLocalData } from '../platform/storage.js';
import { useDismissable } from './useDismissable.js';
import { useI18n } from '../i18n/LanguageProvider.jsx';

/**
 * Copia de seguridad.
 *
 * Necesario porque los datos viven en el dispositivo y no hay servidor: vaciar
 * el navegador los borra, y el navegador y el APK son almacenamientos
 * distintos, así que instalar la app no trae consigo lo registrado en la web.
 */
export function BackupSheet({ open, onClose, onImported }) {
  const { t, date } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  useDismissable(open, onClose);

  if (!open) return null;

  const wipe = async () => {
    setBusy(true);
    try {
      await wipeLocalData();
      onImported?.();
      onClose();
    } finally {
      setBusy(false);
      setConfirmWipe(false);
    }
  };

  const exportar = async () => {
    setBusy(true);
    setError(null);
    try {
      const now = Date.now();
      const text = serializeBackup(buildBackup(await snapshot(), { now }));
      await downloadText(text, backupFilename(now));
    } catch {
      setError('backup.exportFailed');
    } finally {
      setBusy(false);
    }
  };

  const importar = async (file) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { backup, error: problem } = parseBackup(await file.text());
      if (problem) {
        setError(problem);
        return;
      }
      const merged = mergeBackup(await snapshot(), backup);
      await restoreMerged(merged);
      setResult(merged.stats);
      onImported?.();
    } catch {
      setError('backup.importFailed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('backup.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-head">
          <h6>{t('backup.title')}</h6>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </header>

        <div className="backup-body">
          <p className="backup-why text-muted">{t('backup.why')}</p>

          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={busy}
            onClick={exportar}
          >
            {t('backup.export')}
          </button>

          <label className="btn btn-secondary btn-block backup-import">
            {t('backup.import')}
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(e) => importar(e.target.files?.[0])}
              // Se limpia el valor para que elegir el mismo fichero dos veces
              // vuelva a disparar el evento.
              onClick={(e) => { e.currentTarget.value = ''; }}
            />
          </label>

          <p className="backup-note text-muted">{t('backup.mergeNote')}</p>

          {error && <p className="log-error">{t(error)}</p>}

          {/* Zona de borrado, separada del resto: exportar e importar son
              acciones seguras, ésta no. */}
          <div className="backup-danger">
            {!confirmWipe ? (
              <button
                type="button"
                className="btn btn-ghost backup-wipe"
                onClick={() => setConfirmWipe(true)}
              >
                {t('backup.wipe')}
              </button>
            ) : (
              <>
                <p className="log-warn">{t('backup.wipeConfirm')}</p>
                <div className="backup-danger-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setConfirmWipe(false)}
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={wipe}
                  >
                    {t('backup.wipeYes')}
                  </button>
                </div>
              </>
            )}
          </div>

          {result && (
            <div className="backup-result">
              <p>
                <strong>{t('backup.imported')}</strong>
              </p>
              <ul>
                <li>{t('backup.fastsAdded', { count: result.historyAdded })}</li>
                <li>{t('backup.eventsAdded', { count: result.eventsAdded })}</li>
                {(result.historySkipped > 0 || result.eventsSkipped > 0) && (
                  <li className="text-muted">
                    {t('backup.skipped', {
                      count: result.historySkipped + result.eventsSkipped,
                    })}
                  </li>
                )}
                {result.activeFastImported && <li>{t('backup.activeImported')}</li>}
                {result.activeFastSkipped && (
                  <li className="text-muted">{t('backup.activeSkipped')}</li>
                )}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Descarga un texto como fichero.
 *
 * En un WebView de Capacitor el truco del enlace con Blob puede no hacer nada:
 * no hay carpeta de descargas ni gestor. Por eso se intenta primero la API de
 * compartir del sistema, que en Android abre el diálogo de siempre y permite
 * guardar en Drive, mandarlo por correo, o donde sea.
 */
async function downloadText(text, filename) {
  const file = new File([text], filename, { type: 'application/json' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      // Cancelar el diálogo de compartir no es un error que deba mostrarse.
      if (e?.name === 'AbortError') return;
      // Cualquier otro fallo cae al método del enlace.
    }
  }

  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Se revoca en el siguiente ciclo: revocar de inmediato cancela la descarga
  // en algunos navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
