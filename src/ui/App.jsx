import { useCallback, useState } from 'react';
import { useFastTracker } from './useFastTracker.js';
import { TodayScreen } from './TodayScreen.jsx';
import { HistoryScreen } from './HistoryScreen.jsx';
import { StatsScreen } from './StatsScreen.jsx';
import { JournalScreen } from './JournalScreen.jsx';
import { useAndroidBackButton } from './useAndroidBackButton.js';
import { popLayer } from './layerStack.js';
import { useI18n } from '../i18n/LanguageProvider.jsx';
import { LanguagePicker } from './LanguagePicker.jsx';
import { BackupSheet } from './BackupSheet.jsx';

const TABS = [
  { key: 'today', labelKey: 'tab.today' },
  { key: 'journal', labelKey: 'tab.journal' },
  { key: 'history', labelKey: 'tab.history' },
  { key: 'stats', labelKey: 'tab.stats' },
];

/**
 * The tracker lives here, not inside a screen, so History and Stats see the same
 * store as Today and switching tabs does not remount the fast.
 */
export function App() {
  const [tab, setTab] = useState('today');
  const [backupOpen, setBackupOpen] = useState(false);
  const tracker = useFastTracker();
  const { t } = useI18n();

  /**
   * Atrás: primero cierra la capa de más arriba (una hoja abierta), si no
   * vuelve a la pestaña principal, y sólo entonces deja minimizar la app.
   */
  const handleBack = useCallback(() => {
    if (popLayer()) return true;
    if (tab !== 'today') {
      setTab('today');
      return true;
    }
    return false;
  }, [tab]);

  useAndroidBackButton({ onBack: handleBack });

  if (!tracker.hydrated) return <div className="app-loading">{t('app.loading')}</div>;

  return (
    <div className="app">
      <header className="app-head">
        <span className="app-mark" aria-hidden="true" />
        <h1 className="app-title">{t('app.title')}</h1>
        <button
          type="button"
          className="btn btn-ghost app-backup-btn"
          onClick={() => setBackupOpen(true)}
          aria-label={t('backup.title')}
          title={t('backup.title')}
        >
          ⤓
        </button>
        <LanguagePicker />
      </header>

      <main className="app-body">
        {tab === 'today' && <TodayScreen tracker={tracker} />}
        {tab === 'journal' && (
          <JournalScreen
            events={tracker.events}
            history={tracker.history}
            session={tracker.session}
            now={tracker.now}
          />
        )}
        {tab === 'history' && <HistoryScreen history={tracker.history} />}
        {tab === 'stats' && <StatsScreen history={tracker.history} />}
      </main>

      <BackupSheet
        open={backupOpen}
        onClose={() => setBackupOpen(false)}
        onImported={tracker.reload}
      />

      <nav className="app-bottom-bar" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={tab === item.key ? 'app-tab app-tab-active' : 'app-tab'}
            onClick={() => setTab(item.key)}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </nav>
    </div>
  );
}
