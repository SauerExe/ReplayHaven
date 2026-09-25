import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { KeyRound, LogIn, ShieldCheck } from 'lucide-react';
import { api } from '../data/api';
import { t, tx } from '../i18n';

/** What the server says about this browser's sign-in (server/auth-routes.ts). */
export interface AuthState {
  accounts: true;
  setupRequired: boolean;
  setupNeedsKey: boolean;
  loggedIn: boolean;
  kind: 'browser' | 'client' | 'key' | null;
  /** Missing on servers from before roles existed; those treat every account as admin. */
  role?: 'admin' | 'user' | null;
  user: {
    id?: string;
    name: string;
    role?: 'admin' | 'user';
    hasPassword?: boolean;
    oidcLinked?: boolean;
  } | null;
  /** false when the server only allows single sign-on. */
  passwordLogin?: boolean;
  oidc?: { enabled: boolean; name: string } | null;
}
interface AuthContextValue {
  /** null: server without accounts (older) or unreachable; then the access key applies. */
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
/** Whether admin-only controls (upload, edit, pairing, users) make sense for this browser. */
export function isAdmin(auth: AuthState | null) {
  return !auth || !auth.role || auth.role === 'admin';
}
export const useIsAdmin = () => isAdmin(useAuth().auth);
/** Whether this browser may change a clip: admins always, others only clips outside the server. */
export function useCanEdit(clip: { server?: boolean } | undefined) {
  const admin = useIsAdmin();
  return admin || !clip?.server;
}

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
    // Without storage the gate simply waits every time.
  }
}
async function loadState(): Promise<AuthState | null> {
  try {
    const state = await api<AuthState>('/auth/state');
    return state.accounts ? state : null;
  } catch {
    // Older server, locked with the access key, or none at all: continue as before.
    return null;
  }
}
/** An error from a failed single sign-on (`/?login_error=…`), removed from the address bar. */
function takeLoginError() {
  const url = new URL(window.location.href);
  const error = url.searchParams.get('login_error');
  if (error === null) return '';
  url.searchParams.delete('login_error');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  return error || t('auth.signInFailed');
}

/**
 * In front of the library: with a server that knows accounts, every device signs in once (like
 * Immich). Without a server, or with an older one, everything stays as it was.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  // Only browsers that already know a server with accounts wait for its answer; everyone else
  // sees the library right away as before.
  const [auth, setAuth] = useState<AuthState | null | undefined>(() =>
    remembered() ? undefined : null,
  );
  const [loginError, setLoginError] = useState(takeLoginError);
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
    return <div className="auth-screen" aria-busy="true" aria-label={t('auth.checking')} />;
  if (auth && (auth.setupRequired || !auth.loggedIn))
    return (
      <AuthScreen
        setup={auth.setupRequired}
        needsKey={auth.setupNeedsKey}
        passwordLogin={auth.passwordLogin !== false}
        oidcName={auth.oidc?.enabled ? auth.oidc.name : ''}
        initialError={loginError}
        onDone={refresh}
      />
    );
  return (
    <AuthContext.Provider value={{ auth, refresh, logout }}>
      {loginError && (
        <div className="auth-banner" role="alert">
          <span>{loginError}</span>
          <button type="button" className="button secondary" onClick={() => setLoginError('')}>
            {t('auth.dismiss')}
          </button>
        </div>
      )}
      {children}
    </AuthContext.Provider>
  );
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
  passwordLogin,
  oidcName,
  initialError,
  onDone,
}: {
  setup: boolean;
  needsKey: boolean;
  passwordLogin: boolean;
  oidcName: string;
  initialError: string;
  onDone: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (setup && password !== repeat) return setError(t('auth.passwordMismatch'));
    setBusy(true);
    try {
      await api(setup ? '/auth/setup' : '/auth/login', {
        method: 'POST',
        body: JSON.stringify(setup ? { name, password, key } : { name, password }),
      });
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.failed'));
    } finally {
      setBusy(false);
    }
  }
  const sso = oidcName ? (
    <a
      className={`button ${passwordLogin ? 'secondary' : 'primary'} auth-sso`}
      href="/api/auth/oidc/start"
    >
      <KeyRound size={17} />
      {t('auth.sso.signInWith', { name: oidcName })}
    </a>
  ) : null;
  const errorBox = error && (
    <p className="auth-error" role="alert">
      {error}
    </p>
  );

  // Single sign-on only: no form, just the button.
  if (!passwordLogin)
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <Brand />
          <span className="surface-kicker">
            <ShieldCheck size={15} /> {setup ? t('auth.kicker.setup') : t('auth.kicker.login')}
          </span>
          <h1>{setup ? t('auth.sso.setupTitle') : t('auth.title.login')}</h1>
          <p className="auth-lead">
            {t(setup ? 'auth.sso.setupLead' : 'auth.sso.loginLead', {
              name: oidcName || t('auth.sso.generic'),
            })}
          </p>
          {errorBox}
          {sso ?? <p className="auth-lead">{t('auth.sso.notConfigured')}</p>}
        </div>
      </main>
    );

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={(e) => void submit(e)}>
        <Brand />
        <span className="surface-kicker">
          <ShieldCheck size={15} /> {setup ? t('auth.kicker.setup') : t('auth.kicker.login')}
        </span>
        <h1>{setup ? t('auth.title.setup') : t('auth.title.login')}</h1>
        <p className="auth-lead">{setup ? t('auth.lead.setup') : t('auth.lead.login')}</p>
        {sso && (
          <>
            {sso}
            <div className="auth-divider" role="separator">
              <span>{t('auth.or')}</span>
            </div>
          </>
        )}
        <label className="field">
          {t('auth.field.name')}
          <input
            autoComplete="username"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={60}
            autoFocus={!sso}
          />
        </label>
        <label className="field">
          {t('auth.field.password')}
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
            {t('auth.field.repeat')}
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
            {t('auth.field.key')}
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
            />
            <small className="auth-hint">
              {tx('auth.field.keyHint', {
                file: <code>.env</code>,
                name: <code>REPLAYHAVEN_ACCESS_TOKEN</code>,
              })}
            </small>
          </label>
        )}
        {errorBox}
        <button className="button primary" disabled={busy}>
          <LogIn size={17} />
          {setup ? t('auth.submit.setup') : t('auth.submit.login')}
        </button>
      </form>
    </main>
  );
}

/** Target of the QR code: signs this device in with the one-time code and opens the library. */
function ConnectPage() {
  const [error, setError] = useState('');
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code') || '';
    api('/auth/qr/redeem', { method: 'POST', body: JSON.stringify({ code }) })
      .then(() => window.location.replace('/'))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : t('auth.connect.codeFailed')),
      );
  }, []);
  return (
    <main className="auth-screen">
      <div className="auth-card">
        <Brand />
        <h1>{error ? t('auth.failed') : t('auth.connect.signingIn')}</h1>
        {error && (
          <>
            <p className="auth-lead">{error}</p>
            <a className="button secondary" href="/">
              {t('auth.connect.toLogin')}
            </a>
          </>
        )}
      </div>
    </main>
  );
}
