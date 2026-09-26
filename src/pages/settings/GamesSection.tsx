import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../../data/api';
import { useVault } from '../../data/store';
import {
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  StatusBadge,
  type BadgeTone,
} from '../../components/settings';
import { t, tp } from '../../i18n';
import { failure } from './shared';

/** Steam fetching of covers and game details: status and "Update now". */
export function GamesSection() {
  const { server, refreshServer, toast } = useVault();
  const [refreshing, setRefreshing] = useState(false);
  const metadata = server.gameMetadata;
  const busy = refreshing || !!metadata?.pending;
  const active = server.connected && !!metadata?.enabled;

  async function refresh() {
    setRefreshing(true);
    try {
      const { queued } = await api<{ queued: number }>('/games/refresh', { method: 'POST' });
      toast(queued ? tp('settings.games.queued', queued) : t('settings.games.allQueued'));
      await refreshServer();
    } catch (error) {
      toast(failure(error));
    } finally {
      setRefreshing(false);
    }
  }

  const [tone, state, text]: [BadgeTone, string, string] = !server.connected
    ? ['error', t('settings.games.noServer'), t('settings.games.noServerText')]
    : !metadata
      ? ['warning', t('settings.games.updateRequired'), t('settings.games.updateRequiredText')]
      : !metadata.enabled
        ? ['neutral', t('settings.games.off'), t('settings.games.disabledText')]
        : [
            'ok',
            t('settings.games.on'),
            metadata.total
              ? t('settings.games.summary', {
                  matched: metadata.matched,
                  total: metadata.total,
                  missing: metadata.missing,
                })
              : t('settings.games.waitingText'),
          ];

  return (
    <SettingsPage
      id="games"
      title={t('settings.games.title')}
      description={t('settings.games.description')}
    >
      <SettingsGroup
        title={t('settings.games.steam')}
        description={t('settings.games.steamText')}
        footer={t('settings.games.footer')}
      >
        <SettingsRow
          label={t('settings.games.fetching')}
          description={
            <span role="status">
              {text}
              {active && !!metadata?.pending && (
                <span className="st-row-extra">
                  {tp('settings.games.pending', metadata.pending)}
                </span>
              )}
              {active && !!metadata?.failed && (
                <span className="st-row-extra">{tp('settings.games.failed', metadata.failed)}</span>
              )}
            </span>
          }
        >
          <StatusBadge tone={tone} dot={tone === 'ok'}>
            {state}
          </StatusBadge>
        </SettingsRow>
        <SettingsRow
          label={t('settings.games.update')}
          description={t('settings.games.updateHint')}
        >
          <button
            type="button"
            className="button secondary"
            disabled={!active || !metadata?.total || busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={15} aria-hidden="true" />
            {busy ? t('settings.games.updating') : t('settings.games.updateNow')}
          </button>
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  );
}
