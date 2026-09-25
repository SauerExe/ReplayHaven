import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  KeyRound,
  Link2,
  LogOut,
  RefreshCw,
  Unlink,
  UserRound,
} from 'lucide-react';
import { api } from '../data/api';
import { useAuth, useIsAdmin, type AuthState } from './AuthGate';
import { useVault } from '../data/store';
import { SettingsSection } from './SettingsSection';
import { t, tp } from '../i18n';
export function ServerSettings() {
  const { server, refreshServer, connectServer, updateAnalysisSettings, toast } = useVault();
  const { auth } = useAuth();
  // Plain accounts see the analysis settings but may not change them (the server answers 403).
  const admin = useIsAdmin();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  async function change(key: keyof typeof server.settings, value: boolean) {
    setBusy(true);
    try {
      await updateAnalysisSettings({ ...server.settings, [key]: value });
    } catch (e) {
      toast(e instanceof Error ? e.message : t('pages.server.saveFailed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsSection
      id="analysis"
      title={t('pages.server.title')}
      description={t('pages.server.description')}
    >
      <div className={`server-status-card${server.connected ? ' online' : ''}`}>
        <div className="server-status-text">
          <strong>
            <span className="server-status-dot" />
            {server.connected
              ? t('pages.server.connected')
              : server.authRequired
                ? t('pages.server.locked')
                : t('pages.server.disconnected')}
          </strong>
          <p>
            {server.connected
              ? tp('pages.server.queue', server.queue)
              : t('pages.server.startHint')}
          </p>
          {server.connected && server.playback?.mode === 'web' && server.playback.pending > 0 && (
            <p className="server-playback" role="status">
              {tp('pages.server.playbackPending', server.playback.pending)}
            </p>
          )}
        </div>
        <button
          className="icon-button"
          aria-label={t('pages.server.refresh')}
          onClick={() => void refreshServer()}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      {auth?.user && <AccountCard auth={auth} user={auth.user} />}
      {!server.connected && !auth && (
        <form
          className="server-login"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await connectServer(token);
              setToken('');
              toast(t('pages.server.connectionChecked'));
            } catch (error) {
              toast(error instanceof Error ? error.message : t('pages.server.connectFailed'));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span className="server-login-label">
              <KeyRound size={14} />
              {t('pages.server.token')}
            </span>
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t('pages.server.tokenPlaceholder')}
            />
          </label>
          <button disabled={busy} className="button primary">
            <Check size={16} />
            {t('pages.server.connect')}
          </button>
          <p className="server-login-hint">{t('pages.server.tokenHint')}</p>
        </form>
      )}
      {server.connected && (
        <>
          <div className="settings-card">
            <div className="setting-row">
              <div>
                <h3>
                  {server.provider === 'local'
                    ? t('pages.server.providerLocal')
                    : server.provider === 'gemini'
                      ? t('pages.server.providerGemini')
                      : t('pages.server.providerClient')}
                </h3>
                <p>{server.configured ? server.model : t('pages.server.clientModeText')}</p>
              </div>
              <span className="demo-label">
                {server.configured
                  ? t('pages.server.optionalProvider')
                  : t('pages.server.clientMode')}
              </span>
            </div>
            {server.configured && (
              <div className="setting-row">
                <div>
                  <h3>{t('pages.server.autoAnalyze')}</h3>
                  <p>{t('pages.server.autoAnalyzeHint')}</p>
                </div>
                <div className="switch-field">
                  <span className="switch-state">
                    {server.settings.autoAnalyze ? t('pages.settings.on') : t('pages.settings.off')}
                  </span>
                  <button
                    className="switch"
                    role="switch"
                    aria-label={t('pages.server.autoAnalyzeLabel')}
                    aria-checked={server.settings.autoAnalyze}
                    disabled={busy || !admin}
                    onClick={() => void change('autoAnalyze', !server.settings.autoAnalyze)}
                  >
                    <span />
                  </button>
                </div>
              </div>
            )}
            <div className="setting-row">
              <div>
                <h3>{t('pages.server.autoTitle')}</h3>
                <p>{t('pages.server.autoTitleHint')}</p>
              </div>
              <div className="switch-field">
                <span className="switch-state">
                  {server.settings.autoTitle ? t('pages.settings.on') : t('pages.settings.off')}
                </span>
                <button
                  className="switch"
                  role="switch"
                  aria-label={t('pages.server.autoTitle')}
                  aria-checked={server.settings.autoTitle}
                  disabled={busy || !admin}
                  onClick={() => void change('autoTitle', !server.settings.autoTitle)}
                >
                  <span />
                </button>
              </div>
            </div>
            {server.provider === 'gemini' && (
              <div className="setting-row">
                <div>
                  <h3>{t('pages.server.includeAudio')}</h3>
                  <p>{t('pages.server.includeAudioHint')}</p>
                </div>
                <div className="switch-field">
                  <span className="switch-state">
                    {server.settings.includeAudio
                      ? t('pages.settings.on')
                      : t('pages.settings.off')}
                  </span>
                  <button
                    className="switch"
                    role="switch"
                    aria-label={t('pages.server.includeAudioLabel')}
                    aria-checked={server.settings.includeAudio}
                    disabled={busy || !admin}
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
              <p>{t('pages.server.geminiNotice')}</p>
            </div>
          )}
          <Link className="text-link" to="/devices">
            {t('pages.server.devicesLink')} <ArrowRight size={15} />
          </Link>
        </>
      )}
    </SettingsSection>
  );
}

/**
 * The signed-in account: set or change the password, link single sign-on and sign out. An account
 * that so far only signed in through single sign-on has no password yet; it sets one without the
 * current password.
 */
function AccountCard({ auth, user }: { auth: AuthState; user: NonNullable<AuthState['user']> }) {
  const { logout, refresh } = useAuth();
  const { toast } = useVault();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const name = user.name;
  // Older servers do not report it; they always had a password.
  const hasPassword = user.hasPassword !== false;
  const oidc = auth.oidc?.enabled ? auth.oidc : null;
  async function unlink() {
    setBusy(true);
    try {
      await api('/auth/oidc/unlink', { method: 'POST' });
      toast(t('pages.server.account.unlinked'));
      await refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : t('pages.server.account.failed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-card account-card">
      <div className="setting-row">
        <div className="account-name">
          <UserRound size={20} />
          <div>
            <h3>{t('pages.server.account.signedInAs', { name })}</h3>
            <p>{t('pages.server.account.otherDevices')}</p>
          </div>
        </div>
        <div className="account-actions">
          <button className="button secondary" onClick={() => setOpen(!open)}>
            {hasPassword
              ? t('pages.server.account.changePassword')
              : t('pages.server.account.setPassword')}
          </button>
          {oidc &&
            (user.oidcLinked ? (
              <button
                className="button secondary"
                disabled={busy || !hasPassword}
                title={hasPassword ? undefined : t('pages.server.account.unlinkNeedsPassword')}
                onClick={() => void unlink()}
              >
                <Unlink size={16} /> {t('pages.server.account.unlink', { name: oidc.name })}
              </button>
            ) : (
              // Full page navigation: the provider's sign-in page takes over and returns here.
              <a className="button secondary" href="/api/auth/oidc/start?link=1">
                <Link2 size={16} /> {t('pages.server.account.link', { name: oidc.name })}
              </a>
            ))}
          <button className="button secondary" onClick={() => void logout()}>
            <LogOut size={16} /> {t('pages.server.account.logout')}
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
                body: JSON.stringify({ current: hasPassword ? current : '', next }),
              });
              toast(
                hasPassword
                  ? t('pages.server.account.passwordChanged')
                  : t('pages.server.account.passwordSet'),
              );
              await refresh();
              setOpen(false);
              setCurrent('');
              setNext('');
            } catch (error) {
              toast(error instanceof Error ? error.message : t('pages.server.account.failed'));
            } finally {
              setBusy(false);
            }
          }}
        >
          {hasPassword && (
            <label className="field">
              {t('pages.server.account.currentPassword')}
              <input
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
              />
            </label>
          )}
          <label className="field">
            {t('pages.server.account.newPassword')}
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
            <Check size={16} /> {t('common.save')}
          </button>
        </form>
      )}
    </div>
  );
}
