import { createContext, useCallback, useContext, useEffect, useId, useState } from 'react';
import type { FormEvent, InputHTMLAttributes, ReactNode } from 'react';
import {
  CircleAlert,
  Globe,
  KeyRound,
  LoaderCircle,
  MonitorSmartphone,
  Play,
  Server,
  Sparkles,
} from 'lucide-react';
import { ApiError, api } from '../data/api';
import { LANGUAGES, setLanguage, t, tx, useLanguage } from '../i18n';
import { takeSetupKey } from './setup-link';

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
  // Read before anything else renders, so the key leaves the address bar right away.
  const [linkKey] = useState(takeSetupKey);
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
    return (
      <div className="auth-screen" aria-busy="true" aria-label={t('auth.checking')}>
        <div className="auth-backdrop" aria-hidden="true" />
      </div>
    );
  if (auth && (auth.setupRequired || !auth.loggedIn))
    return (
      <AuthScreen
        setup={auth.setupRequired}
        needsKey={auth.setupNeedsKey}
        // The first account is always created with the setup form, even with single sign-on only.
        passwordLogin={auth.passwordLogin !== false || auth.setupRequired}
        oidcName={auth.oidc?.enabled ? auth.oidc.name : ''}
        initialError={loginError}
        linkKey={linkKey}
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

/**
 * The frame of every sign-in screen: split in two, the product on the left (brand, promise,
 * three features, a sample clip) and the form on the right with one quiet help line and the
 * language switch. On phones the left side shrinks to the brand and the promise.
 */
const POINTS = [
  { icon: Sparkles, key: 'ai' },
  { icon: Server, key: 'server' },
  { icon: MonitorSmartphone, key: 'devices' },
] as const;

function AuthLayout({
  titleId,
  help,
  helpWideOnly,
  busy,
  children,
}: {
  titleId: string;
  help?: ReactNode;
  /** On phones this help already sits next to the field it concerns. */
  helpWideOnly?: boolean;
  busy?: boolean;
  children: ReactNode;
}) {
  const language = useLanguage();
  return (
    <main className="auth-screen">
      <aside className="auth-aside">
        <div className="auth-backdrop" aria-hidden="true" />
        <div className="auth-brand">
          <img src="/icon-192.png" alt="" width="36" height="36" />
          <span>
            Replay<span className="auth-brand-light">Haven</span>
          </span>
        </div>
        <div className="auth-pitch">
          <p className="auth-eyebrow">{t('auth.aside.eyebrow')}</p>
          <p className="auth-headline">{t('auth.aside.title')}</p>
          <p className="auth-pitch-lead">{t('auth.aside.lead')}</p>
          <ul className="auth-points">
            {POINTS.map(({ icon: Icon, key }) => (
              <li key={key}>
                <span className="auth-point-icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span>
                  <strong>{t(`auth.aside.${key}.title`)}</strong>
                  {t(`auth.aside.${key}.text`)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        {/* What the library makes of a recording: decorative, the text says it too. */}
        <div className="auth-showcase" aria-hidden="true">
          <div className="auth-sample auth-sample-back">
            <div className="auth-sample-thumb auth-sample-thumb-alt" />
          </div>
          <div className="auth-sample">
            <div className="auth-sample-thumb">
              <span className="auth-sample-badge">
                <Sparkles size={12} /> {t('auth.aside.sampleTag')}
              </span>
              <span className="auth-sample-play">
                <Play size={18} fill="currentColor" />
              </span>
              <span className="auth-sample-time">0:54</span>
            </div>
            <div className="auth-sample-body">
              <span className="auth-sample-game">Counter-Strike 2</span>
              <span className="auth-sample-title">{t('auth.aside.sampleTitle')}</span>
              <span className="auth-sample-timeline">
                <span className="auth-sample-progress" />
                {[22, 41, 58, 71, 86].map((at, i) => (
                  <span
                    key={at}
                    className={`auth-sample-mark${i === 4 ? ' ace' : ''}`}
                    style={{ left: `${at}%` }}
                  />
                ))}
              </span>
              <span className="auth-sample-tags">
                <span>Ace</span>
                <span>Headshot</span>
                <span>Inferno</span>
              </span>
            </div>
          </div>
        </div>
        <p className="auth-trust">{t('auth.aside.trust')}</p>
      </aside>
      <div className="auth-shell">
        <div className="auth-brand auth-brand-mobile">
          <img src="/icon-192.png" alt="" width="32" height="32" />
          <span>
            Replay<span className="auth-brand-light">Haven</span>
          </span>
        </div>
        <section className="auth-card" aria-labelledby={titleId} aria-busy={busy || undefined}>
          {children}
        </section>
        {help && <p className={`auth-help${helpWideOnly ? ' wide-only' : ''}`}>{help}</p>}
        <footer className="auth-footer">
          <span>© ReplayHaven</span>
          <div className="auth-language" role="group" aria-label={t('auth.language')}>
            <Globe size={14} aria-hidden="true" />
            {LANGUAGES.map((item) => (
              <button
                key={item.id}
                type="button"
                lang={item.id}
                aria-pressed={language === item.id}
                onClick={() => setLanguage(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </footer>
      </div>
    </main>
  );
}

function Alert({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div className="auth-alert" role="alert" id={id}>
      <CircleAlert size={18} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

type FieldName = 'name' | 'password' | 'repeat' | 'key';

/** Label above, a 44 px input, an optional helper on the label line and a hint below. */
function Field({
  id,
  label,
  invalid,
  errorId,
  helper,
  hint,
  ...input
}: {
  id: string;
  label: string;
  invalid: boolean;
  errorId: string;
  helper?: ReactNode;
  hint?: ReactNode;
} & InputHTMLAttributes<HTMLInputElement>) {
  const hintId = hint ? `${id}-hint` : undefined;
  const describedBy = [invalid ? errorId : '', hintId ?? ''].filter(Boolean).join(' ');
  return (
    <div className={`auth-field${invalid ? ' is-invalid' : ''}`}>
      <div className="auth-label-row">
        <label htmlFor={id}>{label}</label>
        {helper}
      </div>
      <input
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy || undefined}
        {...input}
      />
      {hint && (
        <small className="auth-hint" id={hintId}>
          {hint}
        </small>
      )}
    </div>
  );
}

function SubmitButton({ busy, label }: { busy: boolean; label: string }) {
  return (
    <button className="button primary auth-submit" disabled={busy} aria-busy={busy || undefined}>
      {busy && <LoaderCircle className="auth-spinner" size={18} aria-hidden="true" />}
      <span>{label}</span>
    </button>
  );
}

function AuthScreen({
  setup,
  needsKey,
  passwordLogin,
  oidcName,
  initialError,
  linkKey,
  onDone,
}: {
  setup: boolean;
  needsKey: boolean;
  passwordLogin: boolean;
  oidcName: string;
  initialError: string;
  /** Access key from the setup link (`#setup-key=…`), empty without one. */
  linkKey: string;
  onDone: () => Promise<void>;
}) {
  useLanguage();
  const uid = useId();
  const ids = {
    title: `${uid}title`,
    error: `${uid}error`,
    name: `${uid}name`,
    password: `${uid}password`,
    repeat: `${uid}repeat`,
    key: `${uid}key`,
    qr: `${uid}qr`,
  };
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [key, setKey] = useState(linkKey);
  const [keyFromLink, setKeyFromLink] = useState(!!linkKey);
  const [error, setError] = useState(initialError);
  const [invalid, setInvalid] = useState<FieldName | null>(null);
  const [busy, setBusy] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  function fail(message: string, field: FieldName | null) {
    setError(message);
    setInvalid(field);
    // A wrong key from the link: show the field so it can be corrected.
    if (field === 'key') setKeyFromLink(false);
    if (field) requestAnimationFrame(() => document.getElementById(ids[field])?.focus());
  }
  /** The first problem the server would refuse anyway, checked here with a clearer message. */
  function check(): [string, FieldName] | null {
    if (!name.trim()) return [t('auth.missing.name'), 'name'];
    if (!password) return [t('auth.missing.password'), 'password'];
    if (!setup) return null;
    if (password.length < 8) return [t('auth.passwordShort'), 'password'];
    if (password !== repeat) return [t('auth.passwordMismatch'), 'repeat'];
    if (needsKey && !key) return [t('auth.missing.key'), 'key'];
    return null;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setInvalid(null);
    const problem = check();
    if (problem) return fail(...problem);
    setBusy(true);
    try {
      await api(setup ? '/auth/setup' : '/auth/login', {
        method: 'POST',
        body: JSON.stringify(setup ? { name, password, key } : { name, password }),
      });
      await onDone();
    } catch (e) {
      // 401 means the access key (setup) or the name and password (sign-in) were wrong.
      const field = e instanceof ApiError && e.status === 401 ? (setup ? 'key' : 'password') : null;
      fail(e instanceof Error ? e.message : t('auth.failed'), field);
    } finally {
      setBusy(false);
    }
  }

  const title = setup ? t('auth.title.setup') : t('auth.title.login');
  const sso = oidcName ? (
    <a
      className={`button ${passwordLogin ? 'secondary' : 'primary'} auth-sso`}
      href="/api/auth/oidc/start"
    >
      <KeyRound size={17} aria-hidden="true" />
      {t('auth.sso.signInWith', { name: oidcName })}
    </a>
  ) : null;
  const alert = error && <Alert id={ids.error}>{error}</Alert>;

  // Single sign-on only: no form, just the button.
  if (!passwordLogin)
    return (
      <AuthLayout titleId={ids.title} help={setup ? undefined : t('auth.help.login')}>
        <h1 id={ids.title}>{title}</h1>
        <p className="auth-lead">
          {t(setup ? 'auth.sso.setupLead' : 'auth.sso.loginLead', {
            name: oidcName || t('auth.sso.generic'),
          })}
        </p>
        {alert}
        {sso ?? <p className="auth-lead">{t('auth.sso.notConfigured')}</p>}
      </AuthLayout>
    );

  const field = (id: FieldName) => ({
    id: ids[id],
    invalid: invalid === id,
    errorId: ids.error,
  });
  return (
    <AuthLayout
      titleId={ids.title}
      busy={busy}
      help={setup ? t('auth.help.setup') : t('auth.help.login')}
      helpWideOnly={!setup}
    >
      <h1 id={ids.title}>{title}</h1>
      {setup && <p className="auth-lead">{t('auth.lead.setup')}</p>}
      <form className="auth-form" noValidate onSubmit={(e) => void submit(e)}>
        {alert}
        {sso && (
          <>
            {sso}
            <div className="auth-divider" role="separator">
              <span>{t('auth.or')}</span>
            </div>
          </>
        )}
        <fieldset className="auth-fields" disabled={busy}>
          <Field
            {...field('name')}
            label={t('auth.field.name')}
            autoComplete="username"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={60}
            autoFocus={!sso}
          />
          <Field
            {...field('password')}
            label={t('auth.field.password')}
            type="password"
            autoComplete={setup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={setup ? 8 : undefined}
            maxLength={200}
            hint={setup ? t('auth.field.passwordHint') : undefined}
            helper={
              setup ? undefined : (
                <button
                  type="button"
                  className="auth-link auth-qr-toggle"
                  aria-expanded={qrOpen}
                  aria-controls={ids.qr}
                  onClick={() => setQrOpen((open) => !open)}
                >
                  {t('auth.qr.toggle')}
                </button>
              )
            }
          />
          {!setup && (
            <p className="auth-qr" id={ids.qr} hidden={!qrOpen}>
              {t('auth.qr.steps')}
            </p>
          )}
          {setup && (
            <Field
              {...field('repeat')}
              label={t('auth.field.repeat')}
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              required
              maxLength={200}
            />
          )}
          {setup && needsKey && keyFromLink && (
            <p className="auth-key-link">
              <KeyRound size={16} aria-hidden="true" />
              <span>{t('auth.field.keyFromLink')}</span>
              <button type="button" className="auth-link" onClick={() => setKeyFromLink(false)}>
                {t('auth.field.keyShow')}
              </button>
            </p>
          )}
          {setup && needsKey && !keyFromLink && (
            <Field
              {...field('key')}
              label={t('auth.field.key')}
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
              hint={tx('auth.field.keyHint', {
                file: <code>.env</code>,
                name: <code>REPLAYHAVEN_ACCESS_TOKEN</code>,
              })}
            />
          )}
        </fieldset>
        <SubmitButton busy={busy} label={setup ? t('auth.submit.setup') : t('auth.submit.login')} />
      </form>
    </AuthLayout>
  );
}

/** Target of the QR code: signs this device in with the one-time code and opens the library. */
function ConnectPage() {
  useLanguage();
  const uid = useId();
  const [error, setError] = useState('');
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code') || '';
    api('/auth/qr/redeem', { method: 'POST', body: JSON.stringify({ code }) })
      .then(() => window.location.replace('/'))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : t('auth.connect.codeFailed')),
      );
  }, []);
  const titleId = `${uid}title`;
  if (!error)
    return (
      <AuthLayout titleId={titleId} busy>
        <div className="auth-pending">
          <LoaderCircle className="auth-spinner" size={22} aria-hidden="true" />
          <h1 id={titleId}>{t('auth.connect.signingIn')}</h1>
        </div>
      </AuthLayout>
    );
  return (
    <AuthLayout titleId={titleId} help={t('auth.help.connect')}>
      <h1 id={titleId}>{t('auth.connect.failedTitle')}</h1>
      <Alert id={`${uid}error`}>{error}</Alert>
      <p className="auth-lead">{t('auth.connect.failedLead')}</p>
      <a className="button primary auth-submit" href="/">
        {t('auth.connect.toLogin')}
      </a>
    </AuthLayout>
  );
}
