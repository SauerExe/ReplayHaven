import { useVault } from '../../data/store';
import {
  Select,
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  Switch,
  useSettingsAccess,
} from '../../components/settings';
import { LANGUAGES, isLanguage, setLanguage, t, useLanguage } from '../../i18n';
import { DisplayNameRow } from './AccountSection';

/** Language, reduced motion and library density; all stored in this browser. */
export function AppearanceSection() {
  const { state, setState } = useVault();
  const { visible } = useSettingsAccess();
  const language = useLanguage();
  const prefs = state.preferences;
  const update = (patch: Partial<typeof prefs>) =>
    setState((s) => ({ ...s, preferences: { ...s.preferences, ...patch } }));
  return (
    <SettingsPage
      id="appearance"
      title={t('settings.appearance.title')}
      description={t('settings.appearance.description')}
    >
      {/* Without an account the name shown in the app lives here. */}
      {!visible.account && (
        <SettingsGroup title={t('settings.account.profile')}>
          <DisplayNameRow />
        </SettingsGroup>
      )}
      <SettingsGroup footer={t('settings.appearance.footer')}>
        <SettingsRow label={t('language.label')} description={t('language.hint')}>
          <Select
            value={language}
            options={LANGUAGES.map((option) => ({
              value: option.id,
              label: option.label,
              lang: option.id,
            }))}
            onChange={(value) => {
              if (isLanguage(value)) setLanguage(value);
            }}
          />
        </SettingsRow>
        <SettingsRow
          label={t('settings.appearance.reducedMotion')}
          description={t('settings.appearance.reducedMotionHint')}
        >
          <Switch
            checked={prefs.reducedMotion}
            onChange={(reducedMotion) => update({ reducedMotion })}
          />
        </SettingsRow>
        <SettingsRow
          label={t('settings.appearance.compact')}
          description={t('settings.appearance.compactHint')}
        >
          <Switch checked={prefs.compact} onChange={(compact) => update({ compact })} />
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  );
}
