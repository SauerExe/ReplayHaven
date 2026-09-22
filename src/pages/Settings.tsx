import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  Database,
  FolderOpen,
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
import { SettingsSection, type SettingsArea } from '../components/SettingsSection';
const areas: SettingsArea[] = [
  { id: 'analysis', label: 'KI & Server', icon: Sparkles },
  { id: 'profile', label: 'Profil', icon: User },
  { id: 'playback', label: 'Wiedergabe', icon: Play },
  { id: 'appearance', label: 'Erscheinungsbild', icon: Palette },
  { id: 'storage', label: 'Speicher', icon: Database },
  { id: 'devices', label: 'Geräte', icon: Monitor },
];
const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
function length(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} Min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} Std ${rest} Min` : `${Math.floor(minutes / 60)} Std`;
}
function useCurrentArea() {
  const [current, setCurrent] = useState(areas[0].id);
  useEffect(() => {
    const update = () => {
      const nodes = areas
        .map((a) => document.getElementById(a.id))
        .filter((node): node is HTMLElement => Boolean(node));
      if (!nodes.length) return;
      const last = nodes[nodes.length - 1];
      const atEnd = window.innerHeight + window.scrollY >= document.body.scrollHeight - 4;
      setCurrent(
        atEnd
          ? last.id
          : (nodes.filter((node) => node.getBoundingClientRect().top <= 170).pop() || nodes[0]).id,
      );
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return current;
}
export default function Settings() {
  const { state, setState, toast, server } = useVault();
  const action = useActions();
  const [name, setName] = useState(state.preferences.name);
  const prefs = state.preferences;
  const current = useCurrentArea();
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
      <div className="page-heading">
        <div>
          <span className="eyebrow">GANZ WIE DU ES MAGST</span>
          <h1>Einstellungen</h1>
          <p>Dein Vault, deine Gewohnheiten.</p>
        </div>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Einstellungsbereiche">
          <span className="settings-nav-label">Bereiche</span>
          {areas.map((area) => (
            <a
              key={area.id}
              href={`#${area.id}`}
              aria-current={current === area.id ? 'true' : undefined}
            >
              <area.icon size={16} />
              {area.label}
            </a>
          ))}
        </nav>
        <div className="settings-sections">
          <ServerSettings />
          <SettingsSection id="profile" title="Profil" description="Ein bisschen persönlicher.">
            <form
              className="settings-card profile-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) {
                  update({ name: name.trim() });
                  toast('Profil gespeichert');
                }
              }}
            >
              <div className="large-avatar" aria-hidden="true">
                {initial}
              </div>
              <div className="profile-fields">
                <label className="field">
                  Dein Name
                  <input
                    value={name}
                    required
                    maxLength={40}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <p className="profile-hint">
                  Erscheint im Profilmenü. Bleibt in diesem Browser gespeichert.
                </p>
              </div>
              <button
                className="button secondary"
                disabled={!name.trim() || name.trim() === prefs.name}
              >
                <Check size={16} />
                Speichern
              </button>
            </form>
          </SettingsSection>
          <SettingsSection id="playback" title="Wiedergabe" description="Wie deine Clips starten.">
            <div className="settings-card">
              <div className="setting-row">
                <div>
                  <h3>Standardgeschwindigkeit</h3>
                  <p>Gilt beim Öffnen eines Videos.</p>
                </div>
                <div className="segmented" role="radiogroup" aria-label="Standardgeschwindigkeit">
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
                  <h3>Gemerkter Fortschritt</h3>
                  <p>
                    {continuing
                      ? `${continuing} Clips kannst du gerade weiterschauen.`
                      : 'Gerade lässt sich kein Clip weiterschauen.'}
                  </p>
                </div>
                <button
                  className="button secondary"
                  disabled={!continuing}
                  onClick={() => {
                    setState((s) => ({ ...s, progress: {} }));
                    toast('Fortschritt zurückgesetzt');
                  }}
                >
                  <RotateCcw size={15} />
                  Zurücksetzen
                </button>
              </div>
            </div>
            <p className="settings-footnote">
              Vorschaubilder bleiben statisch. Videos laden erst auf der Clip-Seite.
            </p>
          </SettingsSection>
          <SettingsSection
            id="appearance"
            title="Erscheinungsbild"
            description="Ruhe oder Dichte, ganz wie du magst."
          >
            <div className="settings-card">
              <div className="setting-row">
                <div>
                  <h3>Bewegung reduzieren</h3>
                  <p>Animationen und sanftes Scrollen ausschalten.</p>
                </div>
                <div className="switch-field">
                  <span className="switch-state">{prefs.reducedMotion ? 'An' : 'Aus'}</span>
                  <button
                    className="switch"
                    role="switch"
                    aria-label="Bewegung reduzieren"
                    aria-checked={prefs.reducedMotion}
                    onClick={() => update({ reducedMotion: !prefs.reducedMotion })}
                  >
                    <span />
                  </button>
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <h3>Kompakte Bibliothek</h3>
                  <p>Mehr Clips pro Reihe auf großen Bildschirmen.</p>
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
                  <span className="switch-state">{prefs.compact ? 'An' : 'Aus'}</span>
                  <button
                    className="switch"
                    role="switch"
                    aria-label="Kompakte Bibliothek"
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
            title="Speicher"
            description="Was dein Vault gerade hält."
            aside={sampleClips > 0 ? <span className="demo-label">Beispieldaten</span> : undefined}
          >
            <p className="storage-headline">
              <strong>{serverClips.length ? bytes(serverSize) : 'Nichts archiviert'}</strong>
              <span>
                {serverClips.length
                  ? `in ${serverClips.length} Originalen auf deinem Server`
                  : 'Dein Vault liegt bisher nur in diesem Browser.'}
              </span>
            </p>
            <dl className="storage-ledger">
              <div>
                <dt>Auf dem Server</dt>
                <dd>{serverClips.length ? `${serverClips.length} · ${bytes(serverSize)}` : '—'}</dd>
              </div>
              <div>
                <dt>Lokale Vorschauen</dt>
                <dd>{localClips.length ? `${localClips.length} · ${bytes(localSize)}` : '—'}</dd>
              </div>
              <div>
                <dt>Beispiel-Clips</dt>
                <dd>{sampleClips || '—'}</dd>
              </div>
              <div>
                <dt>Sammlungen</dt>
                <dd>{state.collections.length}</dd>
              </div>
              <div>
                <dt>Favoriten</dt>
                <dd>{favorites}</dd>
              </div>
              <div>
                <dt>Gesamtlänge</dt>
                <dd>{length(total)}</dd>
              </div>
            </dl>
            <p className="settings-footnote">
              Lokale Videos liegen nur als Vorschau in dieser Sitzung vor. Einstellungen und
              Änderungen an Beispiel-Cards werden im Browser gespeichert. Die Serverangabe zählt
              sichtbare Originale; zusätzliche Wiedergabekopien und entfernte Einträge sind darin
              nicht enthalten.
            </p>
            <button className="text-button destructive" onClick={() => action({ kind: 'reset' })}>
              Beispieldaten und Einstellungen zurücksetzen
            </button>
          </SettingsSection>
          <SettingsSection
            id="devices"
            title="Geräte & Server"
            description="Woher deine Aufnahmen kommen."
          >
            <div className="settings-card">
              <div className="setting-row">
                <div>
                  <h3>
                    {server.connected ? <Wifi size={16} /> : <WifiOff size={16} />}
                    {server.connected ? 'Archiv-Server verbunden' : 'Kein Server verbunden'}
                  </h3>
                  <p>
                    {server.connected
                      ? 'NVIDIA-Aufnahmen können automatisch archiviert werden.'
                      : 'Dein Archiv ist derzeit nur lokal verfügbar.'}
                  </p>
                </div>
                <Link className="button secondary" to="/devices">
                  Geräte <ArrowRight size={16} />
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
                      <span className="device-uploads">{device.uploaded} Uploads</span>
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
