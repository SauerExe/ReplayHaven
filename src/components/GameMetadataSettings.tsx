import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../data/api';
import { useVault } from '../data/store';
import { useIsAdmin } from './AuthGate';
import { SettingsSection } from './SettingsSection';
import { t, tp } from '../i18n';

export function GameMetadataSettings() {
  const { server, refreshServer, toast } = useVault();
  const admin = useIsAdmin();
  const [refreshing, setRefreshing] = useState(false);
  const metadata = server.gameMetadata;
  const busy = refreshing || !!metadata?.pending;

  async function refresh() {
    setRefreshing(true);
    try {
      const { queued } = await api<{ queued: number }>('/games/refresh', { method: 'POST' });
      toast(queued ? tp('pages.games.queued', queued) : t('pages.games.allQueued'));
      await refreshServer();
    } catch (error) {
      toast(error instanceof Error ? error.message : t('pages.games.fetchFailed'));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <SettingsSection
      id="games"
      title={t('pages.games.title')}
      description={t('pages.games.description')}
    >
      <div className="settings-card">
        <div className="setting-row">
          <div>
            <h3>{t('pages.games.steamTitle')}</h3>
            <p>{t('pages.games.steamText')}</p>
          </div>
          <button
            type="button"
            className="button secondary"
            // Plain accounts see the status; refreshing needs an admin.
            disabled={!admin || !server.connected || !metadata?.enabled || !metadata.total || busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} aria-hidden="true" />
            {busy ? t('pages.games.updating') : t('pages.games.updateNow')}
          </button>
        </div>
        <div className="setting-row">
          <div role="status">
            <h3>
              {!server.connected
                ? t('pages.games.noServer')
                : !metadata
                  ? t('pages.games.updateRequired')
                  : metadata.enabled
                    ? t('pages.games.enabled')
                    : t('pages.games.disabled')}
            </h3>
            <p>
              {!server.connected
                ? t('pages.games.noServerText')
                : !metadata
                  ? t('pages.games.updateRequiredText')
                  : !metadata.enabled
                    ? t('pages.games.disabledText')
                    : !metadata.total
                      ? t('pages.games.waitingText')
                      : t('pages.games.summary', {
                          matched: metadata.matched,
                          total: metadata.total,
                          missing: metadata.missing,
                        })}
            </p>
            {server.connected && metadata?.enabled && !!metadata.pending && (
              <p>{tp('pages.games.pending', metadata.pending)}</p>
            )}
            {server.connected && metadata?.enabled && !!metadata.failed && (
              <p>{tp('pages.games.failed', metadata.failed)}</p>
            )}
          </div>
        </div>
      </div>
      <p className="settings-footnote">{t('pages.games.footnote')}</p>
    </SettingsSection>
  );
}
