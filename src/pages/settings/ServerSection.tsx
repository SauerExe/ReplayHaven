import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Check, RefreshCw, Server } from 'lucide-react';
import { useVault } from '../../data/store';
import { useAuth } from '../../components/AuthGate';
import {
  ListRow,
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  StatusBadge,
  Switch,
} from '../../components/settings';
import type { ServerInfo } from '../../domain/models';
import { t, tp } from '../../i18n';
import { failure } from './shared';

/** Local mode: the access key form that connects this browser to a server. */
function ConnectServer() {
  const { server, connectServer, toast } = useVault();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <SettingsGroup
        title={t('settings.server.connect.title')}
        description={
          server.authRequired
            ? t('settings.server.connect.locked')
            : t('settings.server.connect.text')
        }
        footer={t('settings.server.connect.footer')}
      >
        <form
          className="st-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              await connectServer(token);
              setToken('');
              toast(t('settings.server.connect.checked'));
            } catch (error) {
              toast(failure(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            {t('settings.server.connect.key')}
            <input
              type="password"
              autoComplete="off"
              value={token}
              required
              onChange={(event) => setToken(event.target.value)}
              placeholder={t('settings.server.connect.keyPlaceholder')}
            />
          </label>
          <button className="button primary" disabled={busy || !token.trim()}>
            <Check size={16} aria-hidden="true" />
            {t('settings.server.connect.submit')}
          </button>
        </form>
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow
          label={t('settings.server.noServer.label')}
          description={t('settings.server.noServer.text')}
        >
          <Link className="button secondary" to="/setup#server">
            <BookOpen size={15} aria-hidden="true" />
            {t('settings.server.noServer.guide')}
          </Link>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

function providerLabel(server: ServerInfo) {
  if (server.provider === 'local') return t('settings.server.provider.local');
  if (server.provider === 'gemini') return t('settings.server.provider.gemini');
  return t('settings.server.provider.client');
}

/** Connection status, activity (queue, smooth playback), sign-in and analysis options. */
export function ServerSection() {
  const { server, refreshServer, updateAnalysisSettings, toast } = useVault();
  const { auth } = useAuth();
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  async function change(key: keyof ServerInfo['settings'], value: boolean) {
    setBusy(true);
    try {
      await updateAnalysisSettings({ ...server.settings, [key]: value });
    } catch (error) {
      toast(failure(error));
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setRefreshing(true);
    try {
      await refreshServer();
    } finally {
      setRefreshing(false);
    }
  }

  if (!server.connected && !auth)
    return (
      <SettingsPage
        id="server"
        title={t('settings.server.title')}
        description={t('settings.server.localDescription')}
      >
        <ConnectServer />
      </SettingsPage>
    );

  const playback = server.connected && server.playback?.mode === 'web' ? server.playback : null;
  const planned = playback ? playback.done + playback.pending : 0;
  const percent = playback && planned ? Math.round((playback.done / planned) * 100) : 100;
  const oidc = auth?.oidc?.enabled ? auth.oidc : null;
  const signIn = !auth
    ? t('settings.server.signIn.key')
    : oidc
      ? auth.passwordLogin === false
        ? t('settings.server.signIn.ssoOnly', { provider: oidc.name })
        : t('settings.server.signIn.both', { provider: oidc.name })
      : t('settings.server.signIn.password');
  const meta = [
    window.location.host,
    server.version && t('settings.server.version', { version: server.version }),
  ]
    .filter(Boolean)
    .join(' · ');
  const role = (auth?.user?.role ?? auth?.role) === 'user' ? 'user' : 'admin';

  return (
    <SettingsPage
      id="server"
      title={t('settings.server.title')}
      description={t('settings.server.description')}
      actions={
        <button
          type="button"
          className="button secondary"
          aria-label={t('settings.server.refreshLabel')}
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} aria-hidden="true" data-spinning={refreshing || undefined} />
          {t('settings.server.refresh')}
        </button>
      }
    >
      <SettingsGroup
        list
        footer={
          !server.connected && (
            <>
              {t('settings.server.unreachableHelp')}{' '}
              <Link className="st-inline-link" to="/setup#help">
                {t('settings.server.troubleshoot')}
              </Link>
            </>
          )
        }
      >
        <ListRow
          icon={
            <span className="st-status-icon" data-state={server.connected ? 'ok' : 'error'}>
              <Server size={20} />
            </span>
          }
          title={t('settings.server.status')}
          badges={
            <StatusBadge tone={server.connected ? 'ok' : 'error'} dot>
              {server.connected ? t('settings.server.connected') : t('settings.server.offline')}
            </StatusBadge>
          }
          meta={server.connected ? meta : t('settings.server.unreachable')}
          detail={
            auth?.user &&
            t('settings.server.signedInAs', {
              name: auth.user.name,
              role: role === 'user' ? t('settings.role.user') : t('settings.role.admin'),
            })
          }
        />
      </SettingsGroup>

      {server.connected && (
        <SettingsGroup title={t('settings.server.activity')}>
          <SettingsRow
            label={t('settings.server.queueLabel')}
            description={
              server.queue
                ? tp('settings.server.queue', server.queue)
                : t('settings.server.queueIdle')
            }
          >
            <StatusBadge tone={server.queue ? 'info' : 'neutral'} dot={!!server.queue}>
              {server.queue ? t('settings.server.working') : t('settings.server.idle')}
            </StatusBadge>
          </SettingsRow>
          {playback && (
            <SettingsRow
              label={t('settings.server.playback')}
              description={
                playback.pending > 0 ? (
                  <>
                    {tp('settings.server.playbackPending', playback.pending)}
                    <span
                      className="st-progress"
                      role="progressbar"
                      aria-label={t('settings.server.playback')}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                    >
                      <span style={{ width: `${percent}%` }} />
                    </span>
                  </>
                ) : (
                  t('settings.server.playbackReady')
                )
              }
            >
              <StatusBadge tone={playback.pending > 0 ? 'info' : 'ok'}>
                {playback.pending > 0
                  ? t('settings.server.playbackPreparing')
                  : t('settings.server.playbackDone')}
              </StatusBadge>
            </SettingsRow>
          )}
          <SettingsRow label={t('settings.server.signIn')} description={signIn} />
        </SettingsGroup>
      )}

      {server.connected && (
        <SettingsGroup
          title={t('settings.server.analysis')}
          description={t('settings.server.analysisHint')}
          footer={
            server.provider === 'gemini' ? (
              t('settings.server.geminiNotice')
            ) : (
              <Link className="st-inline-link" to="/settings/pcs">
                {t('settings.server.toPcs')}
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            )
          }
        >
          <SettingsRow
            label={providerLabel(server)}
            description={server.configured ? server.model : t('settings.server.clientModeText')}
          >
            <StatusBadge tone={server.configured ? 'info' : 'neutral'}>
              {server.configured
                ? t('settings.server.optionalProvider')
                : t('settings.server.clientMode')}
            </StatusBadge>
          </SettingsRow>
          {server.configured && (
            <SettingsRow
              label={t('settings.server.autoAnalyze')}
              description={t('settings.server.autoAnalyzeHint')}
            >
              <Switch
                checked={server.settings.autoAnalyze}
                disabled={busy}
                onChange={(value) => void change('autoAnalyze', value)}
              />
            </SettingsRow>
          )}
          <SettingsRow
            label={t('settings.server.autoTitle')}
            description={t('settings.server.autoTitleHint')}
          >
            <Switch
              checked={server.settings.autoTitle}
              disabled={busy}
              onChange={(value) => void change('autoTitle', value)}
            />
          </SettingsRow>
          {server.provider === 'gemini' && (
            <SettingsRow
              label={t('settings.server.includeAudio')}
              description={t('settings.server.includeAudioHint')}
            >
              <Switch
                checked={server.settings.includeAudio}
                disabled={busy}
                onChange={(value) => void change('includeAudio', value)}
              />
            </SettingsRow>
          )}
        </SettingsGroup>
      )}
    </SettingsPage>
  );
}
