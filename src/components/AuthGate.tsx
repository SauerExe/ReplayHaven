import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { LogIn, ShieldCheck } from 'lucide-react';
import { api } from '../data/api';

/** Was der Server über die Anmeldung dieses Browsers sagt (server/auth-routes.ts). */
export interface AuthState {
  accounts: true;
  setupRequired: boolean;
  setupNeedsKey: boolean;
  loggedIn: boolean;
  kind: 'browser' | 'client' | 'key' | null;
  user: { name: string } | null;
}
interface AuthContextValue {
  /** null: Server ohne Konten (älter) oder nicht erreichbar; dann gilt der Zugangsschlüssel. */
  auth: AuthState | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue>({
  auth: null,
  refresh: async () => {},
  logout: async () => {},
});
export const useAuth = () => useContext(AuthContext);

const MEMORY = 'replayhaven.accounts';
function remembered() {
  try {
    return localStorage.getItem(MEMORY) === '1';
  } catch {
    return false;
  }
}
function remember(accounts: boolean) {
  try {
    if (accounts) localStorage.setItem(MEMORY, '1');
    else localStorage.removeItem(MEMORY);
  } catch {
    // Ohne Speicher wartet das Tor eben jedes Mal.
  }
}
async function loadState(): Promise<AuthState | null> {
  try {
    const state = await api<AuthState>('/auth/state');
    return state.accounts ? state : null;
  } catch {
    // Älterer Server, gesperrt mit Zugangsschlüssel, oder gar keiner: wie bisher weiter.
    return null;
  }
}

/**
 * Vor der Bibliothek: Mit einem Server, der Konten kennt, meldet sich jedes Gerät einmal an
 * (wie bei Immich). Ohne Server oder mit einem älteren bleibt alles, wie es war.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  // Nur wer schon einen Server mit Konten kennt, wartet auf dessen Antwort; alle anderen sehen
  // die Bibliothek sofort wie bisher.
  const [auth, setAuth] = useState<AuthState | null | undefined>(() =>
    remembered() ? undefined : null,
  );
  const refresh = useCallback(async () => {
    const state = await loadState();
    remember(!!state);
    setAuth(state);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    await refresh();
  }, [refresh]);

  if (window.location.pathname === '/connect') return <ConnectPage />;
  if (auth === undefined)
    return <div className="auth-screen" aria-busy="true" aria-label="Verbindung wird geprüft" />;
  if (auth && (auth.setupRequired || !auth.loggedIn))
    return <AuthScreen setup={auth.setupRequired} needsKey={auth.setupNeedsKey} onDone={refresh} />;
  return <AuthContext.Provider value={{ auth, refresh, logout }}>{children}</AuthContext.Provider>;
}

function Brand() {
  return (
    <div className="auth-brand">
      <img src="/favicon.svg" alt="" width="36" height="36" />
      <span>
        Replay<b>Haven</b>
      </span>
    </div>
  );
}

function AuthScreen({
  setup,
  needsKey,
  onDone,
}: {
  setup: boolean;
  needsKey: boolean;
  onDone: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (setup && password !== repeat) return setError('Die beiden Passwörter sind verschieden.');
    setBusy(true);
    try {
      await api(setup ? '/auth/setup' : '/auth/login', {
        method: 'POST',
        body: JSON.stringify(setup ? { name, password, key } : { name, password }),
      });
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={(e) => void submit(e)}>
        <Brand />
        <span className="surface-kicker">
          <ShieldCheck size={15} /> {setup ? 'ERSTE EINRICHTUNG' : 'DEIN ARCHIV'}
        </span>
        <h1>{setup ? 'Leg dein Konto an.' : 'Willkommen zurück.'}</h1>
        <p className="auth-lead">
          {setup
            ? 'Mit diesem Konto meldest du dich auf jedem Gerät an. Aufnahme-PCs koppelst du danach mit einem Klick.'
            : 'Melde dich an, um deine Clips zu sehen. Auf dem Handy geht es auch per QR-Code von einem angemeldeten Gerät.'}
        </p>
        <label className="field">
          Name
          <input
            autoComplete="username"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={60}
            autoFocus
          />
        </label>
        <label className="field">
          Passwort
          <input
            type="password"
            autoComplete={setup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={setup ? 8 : undefined}
          />
        </label>
        {setup && (
          <label className="field">
            Passwort wiederholen
            <input
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              required
            />
          </label>
        )}
        {setup && needsKey && (
          <label className="field">
            Zugangsschlüssel aus der Server-Einrichtung
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
            />
            <small className="auth-hint">
              Steht in deiner <code>.env</code> als <code>REPLAYHAVEN_ACCESS_TOKEN</code>. Er
              verhindert, dass jemand anderes das erste Konto anlegt.
            </small>
          </label>
        )}
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          <LogIn size={17} />
          {setup ? 'Konto anlegen' : 'Anmelden'}
        </button>
      </form>
    </main>
  );
}

/** Ziel des QR-Codes: meldet dieses Gerät mit dem einmaligen Code an und öffnet die Bibliothek. */
function ConnectPage() {
  const [error, setError] = useState('');
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code') || '';
    api('/auth/qr/redeem', { method: 'POST', body: JSON.stringify({ code }) })
      .then(() => window.location.replace('/'))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Der Code ließ sich nicht einlösen.'),
      );
  }, []);
  return (
    <main className="auth-screen">
      <div className="auth-card">
        <Brand />
        <h1>{error ? 'Das hat nicht geklappt.' : 'Gerät wird angemeldet …'}</h1>
        {error && (
          <>
            <p className="auth-lead">{error}</p>
            <a className="button secondary" href="/">
              Zur Anmeldung
            </a>
          </>
        )}
      </div>
    </main>
  );
}
