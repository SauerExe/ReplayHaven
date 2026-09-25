import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  ChevronDown,
  BookOpen,
  Database,
  FolderOpen,
  Gamepad2,
  Monitor,
  Palette,
  Play,
  RotateCcw,
  Sparkles,
  User,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useVault } from '../data/store';
import { bytes, canContinue } from '../data/repository';
import { useActions } from '../components/Actions';
import { ServerSettings } from '../components/ServerSettings';
import { GameMetadataSettings } from '../components/GameMetadataSettings';
import { SettingsSection, type SettingsArea } from '../components/SettingsSection';
import { PageHeading } from '../components/PageHeading';
import { useActiveSection } from '../components/useActiveSection';
import { LANGUAGES, isLanguage, setLanguage, t, tp, useLanguage, type MessageKey } from '../i18n';
const areas: (Omit<SettingsArea, 'label'> & { label: MessageKey })[] = [
  { id: 'analysis', label: 'pages.settings.area.analysis', icon: Sparkles },
  { id: 'games', label: 'pages.settings.area.games', icon: Gamepad2 },
  { id: 'profile', label: 'pages.settings.area.profile', icon: User },
  { id: 'playback', label: 'pages.settings.area.playback', icon: Play },
  { id: 'appearance', label: 'pages.settings.area.appearance', icon: Palette },
  { id: 'storage', label: 'pages.settings.area.storage', icon: Database },
  { id: 'devices', label: 'pages.settings.area.devices', icon: Monitor },
];
const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
const areaIds = areas.map((area) => area.id);
function length(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('pages.settings.minutes', { minutes });
  const rest = minutes % 60;
  const hours = Math.floor(minutes / 60);
  return rest
    ? t('pages.settings.hoursMinutes', { hours, minutes: rest })
    : t('pages.settings.hours', { hours });
}
export default function Settings() {
  const { state, setState, toast, server } = useVault();
  const action = useActions();
  const [name, setName] = useState(state.preferences.name);
  const prefs = state.preferences;
  const language = useLanguage();
  const current = useActiveSection(areaIds);
  const navigationRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navigationRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current]');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    const navBox = nav.getBoundingClientRect();
    const activeBox = active.getBoundingClientRect();
    if (activeBox.left < navBox.left || activeBox.right > navBox.right)
      nav.scrollLeft += activeBox.left - navBox.left - (nav.clientWidth - activeBox.width) / 2;
  }, [current]);
  const update = (patch: Partial<typeof prefs>) =>
    setState((s) => ({ ...s, preferences: { ...s.preferences, ...patch } }));
  const localClips = state.clips.filter((c) => c.local);
  const localSize = localClips.reduce((sum, c) => sum + c.size, 0);
  const serverClips = state.clips.filter((c) => c.server);
  const serverSize = serverClips.reduce((sum, c) => sum + c.size, 0);
  const sampleClips = state.clips.length - localClips.length - serverClips.length;
  const favorites = state.clips.filter((c) => c.favorite).length;
  const total = state.clips.reduce((sum, c) => sum + c.duration, 0);
  const continuing = Object.entries(state.progress).filter(([, p]) =>
    canContinue(p.seconds, p.duration),
  ).length;
  const initial = (name.trim() || prefs.name).slice(0, 1).toUpperCase();
  return (
    <div className="page settings-page">
      <PageHeading
        eyebrow={t('pages.settings.eyebrow')}
        title={t('pages.settings.title')}
        description={t('pages.settings.description')}
      >
        <Link className="button secondary" to="/setup">
          <BookOpen size={17} />
          {t('pages.settings.setupGuide')}
        </Link>
      </PageHeading>
      <div className="settings-layout">
        <nav
          className="settings-nav"
          aria-label={t('pages.settings.nav.label')}
          ref={navigationRef}
        >
          <span className="settings-nav-label">{t('pages.settings.nav.title')}</span>
          {areas.map((area) => (
            <a
              key={area.id}
              href={`#${area.id}`}
              aria-current={current === area.id ? 'location' : undefined}
            >
              <area.icon size={16} />
              {t(area.label)}
            </a>
          ))}
          <div className="settings-nav-note">
            <span className="settings-note-icon">
              <BookOpen size={19} />
            </span>
            <strong>{t('pages.settings.nav.newTitle')}</strong>
            <p>{t('pages.settings.nav.newText')}</p>
            <Link to="/setup">
              {t('pages.settings.nav.newLink')} <ArrowRight size={14} />
            </Link>
          </div>
        </nav>
        <div className="settings-sections">
          <ServerSettings />
          <GameMetadataSettings />
          <SettingsSection
            id="profile"
            title={t('pages.settings.profile.title')}
            description={t('pages.settings.profile.description')}
          >
            <form
              className="settings-card profile-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) {
                  update({ name: name.trim() });
                  toast(t('pages.settings.profile.saved'));
                }
              }}
            >
              <div className="large-avatar" aria-hidden="true">
                {initial}
              </div>
              <div className="profile-fields">
                <label className="field">
                  {t('pages.settings.profile.name')}
                  <input
                    value={name}
                    required
                    maxLength={40}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <p className="profile-hint">{t('pages.settings.profile.hint')}</p>
              </div>
              <button
                className="button secondary"
                disabled={!name.trim() || name.trim() === prefs.name}
              >
                <Check size={16} />
                {t('common.save')}
              </button>
            </form>
          </SettingsSection>
          <SettingsSection
            id="playback"
            title={t('pages.settings.playback.title')}
            description={t('pages.settings.playback.description')}
          >
            <div className="settings-card">
              <div className="setting-row">
                <div>
                  <h3>{t('pages.settings.playback.speed')}</h3>
                  <p>{t('pages.settings.playback.speedHint')}</p>
                </div>
                <div
                  className="segmented"
                  role="radiogroup"
                  aria-label={t('pages.settings.playback.speed')}
                >
                  {speeds.map((s) => (
                    <label className="segment" key={s}>
                      <input
                        type="radio"
                        name="playback-speed"
                        className="sr-only"
                        value={s}
                        checked={prefs.speed === s}
                        onChange={() => update({ speed: s })}
                      />
                      <span>{s}×</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <h3>{t('pages.settings.playback.progress')}</h3>
                  <p>
                    {continuing
                      ? tp('pages.settings.playback.continuing', continuing)
                      : t('pages.settings.playback.nothingToContinue')}
                  </p>
                </div>
                <button
                  className="button secondary"
                  disabled={!continuing}
                  onClick={() => {
                    setState((s) => ({ ...s, progress: {} }));
                    toast(t('pages.settings.playback.progressReset'));
                  }}
                >
                  <RotateCcw size={15} />
                  {t('pages.settings.playback.reset')}
                </button>
              </div>
            </div>
            <p className="settings-footnote">{t('pages.settings.playback.footnote')}</p>
          </SettingsSection>
          <SettingsSection
            id="appearance"
            title={t('pages.settings.appearance.title')}
            description={t('pages.settings.appearance.description')}
          >
            <div className="settings-card">
              <div className="setting-row">
                <div>
                  <h3>
                    <label htmlFor="settings-language">{t('language.label')}</label>
                  </h3>
                  <p id="settings-language-hint">{t('language.hint')}</p>
                </div>
                <div className="filter-select">
                  <select
                    id="settings-language"
                    aria-describedby="settings-language-hint"
                    value={language}
                    onChange={(e) => {
                      if (isLanguage(e.target.value)) setLanguage(e.target.value);
                    }}
                  >
                    {LANGUAGES.map((option) => (
                      <option key={option.id} value={option.id} lang={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <h3>{t('pages.settings.appearance.reducedMotion')}</h3>
                  <p>{t('pages.settings.appearance.reducedMotionHint')}</p>
                </div>
                <div className="switch-field">
                  <span className="switch-state">
                    {prefs.reducedMotion ? t('pages.settings.on') : t('pages.settings.off')}
                  </span>
                  <button
                    className="switch"
                    role="switch"
                    aria-label={t('pages.settings.appearance.reducedMotion')}
                    aria-checked={prefs.reducedMotion}
                    onClick={() => update({ reducedMotion: !prefs.reducedMotion })}
                  >
                    <span />
                  </button>
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <h3>{t('pages.settings.appearance.compact')}</h3>
                  <p>{t('pages.settings.appearance.compactHint')}</p>
                  <div
                    className={`density-preview${prefs.compact ? ' compact' : ''}`}
                    aria-hidden="true"
                  >
                    {Array.from({ length: prefs.compact ? 6 : 4 }, (_, i) => (
                      <span key={i} />
                    ))}
                  </div>
                </div>
                <div className="switch-field">
                  <span className="switch-state">
                    {prefs.compact ? t('pages.settings.on') : t('pages.settings.off')}
                  </span>
                  <button
                    className="switch"
                    role="switch"
                    aria-label={t('pages.settings.appearance.compact')}
                    aria-checked={prefs.compact}
                    onClick={() => update({ compact: !prefs.compact })}
                  >
                    <span />
                  </button>
                </div>
              </div>
            </div>
          </SettingsSection>
          <SettingsSection
            id="storage"
            title={t('pages.settings.storage.title')}
            description={t('pages.settings.storage.description')}
            aside={
              sampleClips > 0 ? (
                <span className="demo-label">{t('pages.settings.storage.sampleData')}</span>
              ) : undefined
            }
          >
            <p className="storage-headline">
              <strong>
                {serverClips.length ? bytes(serverSize) : t('pages.settings.storage.nothing')}
              </strong>
              <span>
                {serverClips.length
                  ? tp('pages.settings.storage.originals', serverClips.length)
                  : t('pages.settings.storage.browserOnly')}
              </span>
            </p>
            <dl className="storage-ledger">
              <div>
                <dt>{t('pages.settings.storage.onServer')}</dt>
                <dd>{serverClips.length ? `${serverClips.length} · ${bytes(serverSize)}` : '—'}</dd>
              </div>
              <div>
                <dt>{t('pages.settings.storage.localPreviews')}</dt>
                <dd>{localClips.length ? `${localClips.length} · ${bytes(localSize)}` : '—'}</dd>
              </div>
              <div>
                <dt>{t('pages.settings.storage.sampleClips')}</dt>
                <dd>{sampleClips || '—'}</dd>
              </div>
              <div>
                <dt>{t('pages.settings.storage.collections')}</dt>
                <dd>{state.collections.length}</dd>
              </div>
              <div>
                <dt>{t('pages.settings.storage.favorites')}</dt>
                <dd>{favorites}</dd>
              </div>
              <div>
                <dt>{t('pages.settings.storage.totalLength')}</dt>
                <dd>{length(total)}</dd>
              </div>
            </dl>
            <p className="settings-footnote">{t('pages.settings.storage.footnote')}</p>
            <button className="text-button destructive" onClick={() => action({ kind: 'reset' })}>
              {t('pages.settings.storage.reset')}
            </button>
          </SettingsSection>
          <SettingsSection
            id="devices"
            title={t('pages.settings.devices.title')}
            description={t('pages.settings.devices.description')}
          >
            <div className="settings-card">
              <div className="setting-row">
                <div>
                  <h3>
                    {server.connected ? <Wifi size={16} /> : <WifiOff size={16} />}
                    {server.connected
                      ? t('pages.settings.devices.connected')
                      : t('pages.settings.devices.disconnected')}
                  </h3>
                  <p>
                    {server.connected
                      ? t('pages.settings.devices.connectedText')
                      : t('pages.settings.devices.disconnectedText')}
                  </p>
                </div>
                <Link className="button secondary" to="/devices">
                  {t('pages.settings.devices.link')} <ArrowRight size={16} />
                </Link>
              </div>
              {server.devices.length > 0 && (
                <ul className="settings-devices">
                  {server.devices.map((device) => (
                    <li key={device.id}>
                      <div>
                        <strong>{device.name}</strong>
                        <span>
                          <FolderOpen size={12} /> {device.folder}
                        </span>
                      </div>
                      <span className="device-uploads">
                        {tp('pages.settings.devices.uploads', device.uploaded)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </SettingsSection>
        </div>
      </div>
    </div>
  );
}
