import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, KeyRound, RefreshCw } from 'lucide-react';
import { useVault } from '../data/store';
import { SettingsSection } from './SettingsSection';
export function ServerSettings() {
  const { server, refreshServer, connectServer, updateAnalysisSettings, toast } = useVault();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  async function change(key: keyof typeof server.settings, value: boolean) {
    setBusy(true);
    try {
      await updateAnalysisSettings({ ...server.settings, [key]: value });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsSection
      id="analysis"
      title="KI & Aufnahme-Server"
      description="Dein Windows-Client analysiert auf dem Gaming-PC. Die AgentBox nimmt Video und Ergebnis entgegen."
    >
      <div className={`server-status-card${server.connected ? ' online' : ''}`}>
        <div className="server-status-text">
          <strong>
            <span className="server-status-dot" />
            {server.connected
              ? 'Archiv-Server verbunden'
              : server.authRequired
                ? 'Server gesperrt'
                : 'Kein Archiv-Server verbunden'}
          </strong>
          <p>
            {server.connected
              ? `${server.queue} Aufträge in Verarbeitung · Originale bleiben erhalten`
              : 'Starte den ReplayHaven-Server und verbinde dich mit deinem Zugangsschlüssel.'}
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="Serververbindung aktualisieren"
          onClick={() => void refreshServer()}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      {!server.connected && (
        <form
          className="server-login"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await connectServer(token);
              setToken('');
              toast('Verbindung geprüft');
            } catch (error) {
              toast(error instanceof Error ? error.message : 'Verbindung fehlgeschlagen.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span className="server-login-label">
              <KeyRound size={14} />
              Server-Zugangsschlüssel
            </span>
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Schlüssel aus der Server-Einrichtung"
            />
          </label>
          <button disabled={busy} className="button primary">
            <Check size={16} />
            Verbinden
          </button>
          <p className="server-login-hint">
            Das Setup-Skript zeigt den Schlüssel einmalig an. Er bleibt in diesem Browser.
          </p>
        </form>
      )}
      {server.connected && (
        <>
          <div className="settings-card">
            <div className="setting-row">
              <div>
                <h3>
                  {server.provider === 'local'
                    ? 'Zusätzliche KI auf dem Server'
                    : server.provider === 'gemini'
                      ? 'Zusätzliche Gemini API'
                      : 'Analyse auf deinem Gaming-PC'}
                </h3>
                <p>
                  {server.configured
                    ? server.model
                    : 'Deine AgentBox benötigt dafür kein eigenes KI-Modell. Analyse und Pause steuerst du im Windows-Client.'}
                </p>
              </div>
              <span className="demo-label">
                {server.configured ? 'Optionaler Anbieter' : 'Client-Modus'}
              </span>
            </div>
            {server.configured && (
              <div className="setting-row">
                <div>
                  <h3>Neue Aufnahmen auf dem Server analysieren</h3>
                  <p>Gilt für Uploads ohne angekündigtes Client-Ergebnis.</p>
                </div>
                <div className="switch-field">
                  <span className="switch-state">{server.settings.autoAnalyze ? 'An' : 'Aus'}</span>
                  <button
                    className="switch"
                    role="switch"
                    aria-label="Neue Aufnahmen automatisch analysieren"
                    aria-checked={server.settings.autoAnalyze}
                    disabled={busy}
                    onClick={() => void change('autoAnalyze', !server.settings.autoAnalyze)}
                  >
                    <span />
                  </button>
                </div>
              </div>
            )}
            <div className="setting-row">
              <div>
                <h3>KI-Titel automatisch übernehmen</h3>
                <p>Selbst bearbeitete Titel bleiben erhalten.</p>
              </div>
              <div className="switch-field">
                <span className="switch-state">{server.settings.autoTitle ? 'An' : 'Aus'}</span>
                <button
                  className="switch"
                  role="switch"
                  aria-label="KI-Titel automatisch übernehmen"
                  aria-checked={server.settings.autoTitle}
                  disabled={busy}
                  onClick={() => void change('autoTitle', !server.settings.autoTitle)}
                >
                  <span />
                </button>
              </div>
            </div>
            {server.provider === 'gemini' && (
              <div className="setting-row">
                <div>
                  <h3>Ton in die Server-Analyse einbeziehen</h3>
                  <p>Kann auch Mikrofon und Voice-Chat enthalten. Gilt für folgende Analysen.</p>
                </div>
                <div className="switch-field">
                  <span className="switch-state">
                    {server.settings.includeAudio ? 'An' : 'Aus'}
                  </span>
                  <button
                    className="switch"
                    role="switch"
                    aria-label="Ton in die Analyse einbeziehen"
                    aria-checked={server.settings.includeAudio}
                    disabled={busy}
                    onClick={() => void change('includeAudio', !server.settings.includeAudio)}
                  >
                    <span />
                  </button>
                </div>
              </div>
            )}
          </div>
          {server.provider === 'gemini' && (
            <div className="notice">
              <p>
                Bei einer Server-Analyse wird eine verkleinerte Kopie an Google Gemini übertragen.
                Dabei können API-Kosten entstehen. Das Original bleibt auf deinem Server.
              </p>
            </div>
          )}
          <Link className="text-link" to="/devices">
            Windows-Client und Geräte öffnen <ArrowRight size={15} />
          </Link>
        </>
      )}
    </SettingsSection>
  );
}
