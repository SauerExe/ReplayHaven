import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Database, Monitor, Palette, Play, User, WifiOff } from 'lucide-react';
import { useVault } from '../data/store';
import { bytes } from '../data/repository';
import { useActions } from '../components/Actions';
import { ServerSettings } from '../components/ServerSettings';
export default function Settings() {
  const { state, setState, toast, server } = useVault();
  const action = useActions();
  const [name, setName] = useState(state.preferences.name);
  const prefs = state.preferences;
  const update = (patch: Partial<typeof prefs>) =>
    setState((s) => ({ ...s, preferences: { ...s.preferences, ...patch } }));
  const localClips = state.clips.filter((c) => c.local);
  const size = localClips.reduce((s, c) => s + c.size, 0);
  const serverClips = state.clips.filter((c) => c.server);
  const serverSize = serverClips.reduce((sum, c) => sum + c.size, 0);
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
          <a href="#analysis">
            <Monitor size={17} />
            KI & Server
          </a>
          <a href="#profile">
            <User size={17} />
            Profil
          </a>
          <a href="#playback">
            <Play size={17} />
            Wiedergabe
          </a>
          <a href="#appearance">
            <Palette size={17} />
            Erscheinungsbild
          </a>
          <a href="#storage">
            <Database size={17} />
            Speicher
          </a>
          <a href="#devices">
            <Monitor size={17} />
            Geräte
          </a>
        </nav>
        <div className="settings-sections">
          <ServerSettings />
          <section id="profile" className="settings-section">
            <h2>Profil</h2>
            <p>Ein bisschen persönlicher.</p>
            <form
              className="profile-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) {
                  update({ name: name.trim() });
                  toast('Profil gespeichert');
                }
              }}
            >
              <div className="large-avatar">{prefs.name.slice(0, 1).toUpperCase()}</div>
              <label className="field">
                Dein Name
                <input
                  value={name}
                  required
                  maxLength={40}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button
                className="button secondary"
                disabled={!name.trim() || name.trim() === prefs.name}
              >
                <Check size={16} />
                Speichern
              </button>
            </form>
          </section>
          <section id="playback" className="settings-section">
            <h2>Wiedergabe</h2>
            <div className="setting-row">
              <div>
                <h3>Standardgeschwindigkeit</h3>
                <p>Gilt beim Öffnen eines Videos.</p>
              </div>
              <select
                aria-label="Standardgeschwindigkeit"
                value={prefs.speed}
                onChange={(e) => update({ speed: Number(e.target.value) })}
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </div>
            <div className="setting-info">
              Vorschaubilder bleiben statisch. Videos laden erst auf der Clip-Seite.
            </div>
          </section>
          <section id="appearance" className="settings-section">
            <h2>Erscheinungsbild</h2>
            <div className="setting-row">
              <div>
                <h3>Bewegung reduzieren</h3>
                <p>Animationen und sanftes Scrollen ausschalten.</p>
              </div>
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
            <div className="setting-row">
              <div>
                <h3>Kompakte Bibliothek</h3>
                <p>Mehr Clips pro Reihe auf großen Bildschirmen.</p>
              </div>
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
          </section>
          <section id="storage" className="settings-section">
            <h2>Speicher</h2>
            <div className="storage-card">
              <Database size={24} />
              <div>
                <h3>
                  {bytes(serverSize)} <span>archivierte Originale</span>
                </h3>
                <p>
                  {serverClips.length} Server-Clips · {localClips.length} lokale Vorschauen (
                  {bytes(size)})
                </p>
              </div>
            </div>
            <p className="muted small-text">
              Lokale Videos liegen nur als Vorschau in dieser Sitzung vor. Einstellungen und
              Änderungen an Beispiel-Cards werden im Browser gespeichert. Die Serverangabe zählt
              sichtbare Originale; zusätzliche Wiedergabekopien und entfernte Einträge sind darin
              nicht enthalten.
            </p>
            <button className="text-button destructive" onClick={() => action({ kind: 'reset' })}>
              Beispieldaten und Einstellungen zurücksetzen
            </button>
          </section>
          <section id="devices" className="settings-section">
            <h2>Geräte & Server</h2>
            <div className="setting-row">
              <div>
                <h3>
                  <WifiOff size={16} />{' '}
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
          </section>
        </div>
      </div>
    </div>
  );
}
