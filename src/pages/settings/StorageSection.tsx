import { RotateCcw } from 'lucide-react';
import { useVault } from '../../data/store';
import { bytes } from '../../data/repository';
import { useActions } from '../../components/Actions';
import {
  DangerZone,
  RowValue,
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  StatusBadge,
} from '../../components/settings';
import { t, tp } from '../../i18n';

function length(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('settings.storage.minutes', { minutes });
  const rest = minutes % 60;
  const hours = Math.floor(minutes / 60);
  return rest
    ? t('settings.storage.hoursMinutes', { hours, minutes: rest })
    : t('settings.storage.hours', { hours });
}

/** What the archive and this browser hold; resetting local data. */
export function StorageSection() {
  const { state } = useVault();
  const action = useActions();
  const local = state.clips.filter((c) => c.local);
  const onServer = state.clips.filter((c) => c.server);
  const samples = state.clips.length - local.length - onServer.length;
  const size = (clips: typeof state.clips) => bytes(clips.reduce((sum, c) => sum + c.size, 0));
  const favorites = state.clips.filter((c) => c.favorite).length;
  const total = state.clips.reduce((sum, c) => sum + c.duration, 0);
  return (
    <SettingsPage
      id="storage"
      title={t('settings.storage.title')}
      description={t('settings.storage.description')}
      badge={
        samples > 0 && <StatusBadge tone="neutral">{t('settings.storage.sampleData')}</StatusBadge>
      }
    >
      <SettingsGroup
        title={t('settings.storage.archive')}
        description={
          onServer.length
            ? tp('settings.storage.archiveSummary', onServer.length, { size: size(onServer) })
            : t('settings.storage.browserOnly')
        }
        footer={t('settings.storage.footer')}
      >
        <SettingsRow
          label={t('settings.storage.onServer')}
          description={t('settings.storage.onServerHint')}
        >
          <RowValue>
            {onServer.length
              ? `${tp('settings.storage.clips', onServer.length)} · ${size(onServer)}`
              : '—'}
          </RowValue>
        </SettingsRow>
        <SettingsRow
          label={t('settings.storage.localPreviews')}
          description={t('settings.storage.localPreviewsHint')}
        >
          <RowValue>
            {local.length ? `${tp('settings.storage.clips', local.length)} · ${size(local)}` : '—'}
          </RowValue>
        </SettingsRow>
        {samples > 0 && (
          <SettingsRow
            label={t('settings.storage.sampleClips')}
            description={t('settings.storage.sampleClipsHint')}
          >
            <RowValue>{tp('settings.storage.clips', samples)}</RowValue>
          </SettingsRow>
        )}
      </SettingsGroup>

      <SettingsGroup title={t('settings.storage.library')}>
        <SettingsRow label={t('settings.storage.collections')}>
          <RowValue>{state.collections.length}</RowValue>
        </SettingsRow>
        <SettingsRow label={t('settings.storage.favorites')}>
          <RowValue>{favorites}</RowValue>
        </SettingsRow>
        <SettingsRow label={t('settings.storage.totalLength')}>
          <RowValue>{length(total)}</RowValue>
        </SettingsRow>
      </SettingsGroup>

      <DangerZone>
        <SettingsRow
          label={t('settings.storage.reset')}
          description={t('settings.storage.resetHint')}
        >
          <button
            type="button"
            className="button st-danger-button"
            onClick={(event) => action({ kind: 'reset' }, event.currentTarget)}
          >
            <RotateCcw size={15} aria-hidden="true" />
            {t('settings.storage.resetButton')}
          </button>
        </SettingsRow>
      </DangerZone>
    </SettingsPage>
  );
}
