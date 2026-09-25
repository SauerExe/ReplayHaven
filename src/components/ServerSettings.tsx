import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, KeyRound, LogOut, RefreshCw, UserRound } from 'lucide-react';
import { api } from '../data/api';
import { useAuth } from './AuthGate';
import { useVault } from '../data/store';
import { SettingsSection } from './SettingsSection';
export function ServerSettings() {
  const { server, refreshServer, connectServer, updateAnalysisSettings, toast } = useVault();
  const { auth } = useAuth();
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
      {auth?.user && <AccountCard name={auth.user.name} />}
      {!server.connected && !auth && (
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

/** Das angemeldete Konto: Passwort ändern und abmelden. */
function AccountCard({ name }: { name: string }) {
  const { logout } = useAuth();
  const { toast } = useVault();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="settings-card account-card">
      <div className="setting-row">
        <div className="account-name">
          <UserRound size={20} />
          <div>
            <h3>Angemeldet als {name}</h3>
            <p>Andere Geräte meldest du unter Geräte per QR-Code an.</p>
          </div>
        </div>
        <div className="account-actions">
          <button className="button secondary" onClick={() => setOpen(!open)}>
            Passwort ändern
          </button>
          <button className="button secondary" onClick={() => void logout()}>
            <LogOut size={16} /> Abmelden
          </button>
        </div>
      </div>
      {open && (
        <form
          className="password-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              await api('/auth/password', {
                method: 'POST',
                body: JSON.stringify({ current, next }),
              });
              toast('Passwort geändert');
              setOpen(false);
              setCurrent('');
              setNext('');
            } catch (error) {
              toast(error instanceof Error ? error.message : 'Das hat nicht geklappt.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            Bisheriges Passwort
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </label>
          <label className="field">
            Neues Passwort
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
            />
          </label>
          <button className="button primary" disabled={busy}>
            <Check size={16} /> Speichern
          </button>
        </form>
      )}
    </div>
  );
}
