import { RotateCcw } from 'lucide-react';
import { useVault } from '../../data/store';
import { canContinue } from '../../data/repository';
import {
  SegmentedControl,
  SettingsGroup,
  SettingsPage,
  SettingsRow,
} from '../../components/settings';
import { t, tp } from '../../i18n';

const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** Default speed and the progress remembered for "keep watching". */
export function PlaybackSection() {
  const { state, setState, toast } = useVault();
  const prefs = state.preferences;
  const continuing = Object.values(state.progress).filter((p) =>
    canContinue(p.seconds, p.duration),
  ).length;
  return (
    <SettingsPage
      id="playback"
      title={t('settings.playback.title')}
      description={t('settings.playback.description')}
    >
      <SettingsGroup footer={t('settings.playback.footer')}>
        <SettingsRow
          label={t('settings.playback.speed')}
          description={t('settings.playback.speedHint')}
        >
          <SegmentedControl
            value={prefs.speed}
            options={speeds.map((speed) => ({ value: speed, label: `${speed}×` }))}
            onChange={(speed) =>
              setState((s) => ({ ...s, preferences: { ...s.preferences, speed } }))
            }
          />
        </SettingsRow>
        <SettingsRow
          label={t('settings.playback.progress')}
          description={
            continuing
              ? tp('settings.playback.continuing', continuing)
              : t('settings.playback.nothingToContinue')
          }
        >
          <button
            type="button"
            className="button secondary"
            disabled={!continuing}
            onClick={() => {
              setState((s) => ({ ...s, progress: {} }));
              toast(t('settings.playback.progressReset'));
            }}
          >
            <RotateCcw size={15} aria-hidden="true" />
            {t('settings.playback.reset')}
          </button>
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  );
}
