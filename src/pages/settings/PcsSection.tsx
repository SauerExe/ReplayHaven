import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  Link2,
  Monitor,
  RefreshCw,
  Unplug,
  X,
} from 'lucide-react';
import { api } from '../../data/api';
import { useVault } from '../../data/store';
import {
  ConfirmDialog,
  EmptyGroup,
  ListRow,
  OverflowMenu,
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  StatusBadge,
  useDialog,
  useSettingsAccess,
} from '../../components/settings';
import type { ServerInfo } from '../../domain/models';
import { t, tp } from '../../i18n';
import { pairingLink } from './pairing-link';
import { failure, useSessions, when, type DeviceSession, type PairingRequests } from './shared';

type RecordingPc = ServerInfo['devices'][number];
/** A PC counts as online while its heartbeat is younger than 90 seconds. */
const ONLINE_MS = 90000;

function PcStatus({ pc }: { pc: RecordingPc }) {
  const online = Date.now() - Date.parse(pc.lastSeen) < ONLINE_MS;
  if (!online) return <StatusBadge tone="neutral">{t('settings.pcs.offline')}</StatusBadge>;
  if (pc.paused)
    return (
      <StatusBadge tone="warning" dot>
        {t('settings.pcs.paused')}
      </StatusBadge>
    );
  return (
    <StatusBadge tone="ok" dot>
      {t('settings.pcs.online')}
    </StatusBadge>
  );
}

/** Pairing requests, paired recording PCs with their heartbeat, and the Windows client. */
export function PcsSection({ pairing }: { pairing: PairingRequests }) {
  const { server, refreshServer, toast } = useVault();
  const { accounts } = useSettingsAccess();
  const { sessions, reload } = useSessions(accounts, 10000);
  const remove = useDialog<{ session: DeviceSession; name: string }>();
  const clientSessions = accounts ? (sessions ?? []).filter((s) => s.kind === 'client') : [];
  // Paired PCs have a client session named like the PC; match them to their heartbeat.
  const sessionFor = (name: string) => clientSessions.find((s) => s.label === name);
  const silent = clientSessions.filter((s) => !server.devices.some((pc) => pc.name === s.label));
  const download = server.connected && server.clientDownloadAvailable;
  const [link, setLink] = useState('');

  async function connectThisPc() {
    try {
      const { ticket } = await api<{ ticket: string }>('/pair/ticket', { method: 'POST' });
      const next = pairingLink(window.location.origin, ticket);
      setLink(next);
      // Opens the client if it is installed; otherwise nothing happens and the hint below helps.
      window.location.href = next;
    } catch (error) {
      toast(failure(error));
    }
  }

  async function decide(id: string, approve: boolean) {
    try {
      await api(`/pair/${id}/${approve ? 'approve' : 'deny'}`, { method: 'POST' });
      toast(approve ? t('settings.pcs.approved') : t('settings.pcs.denied'));
      await pairing.reload();
      if (approve) void reload();
    } catch (error) {
      toast(failure(error));
    }
  }

  return (
    <SettingsPage
      id="pcs"
      title={t('settings.pcs.title')}
      description={t('settings.pcs.description')}
      actions={
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            void refreshServer();
            void pairing.reload();
            if (accounts) void reload();
          }}
        >
          <RefreshCw size={15} aria-hidden="true" />
          {t('settings.pcs.refresh')}
        </button>
      }
    >
      {pairing.pending.length > 0 && (
        <SettingsGroup
          tone="accent"
          list
          live
          title={t('settings.pcs.requests')}
          description={t('settings.pcs.requestsHint')}
        >
          {pairing.pending.map((request) => (
            <ListRow
              key={request.id}
              icon={<Monitor size={18} />}
              title={t('settings.pcs.wantsToConnect', { name: request.name })}
              meta={
                <>
                  {t('settings.pcs.code')}{' '}
                  <strong className="st-code">
                    {request.code.slice(0, 3)} {request.code.slice(3)}
                  </strong>
                </>
              }
              action={
                <>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => void decide(request.id, false)}
                  >
                    <X size={15} aria-hidden="true" />
                    {t('settings.pcs.deny')}
                  </button>
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => void decide(request.id, true)}
                  >
                    <Check size={15} aria-hidden="true" />
                    {t('settings.pcs.approve')}
                  </button>
                </>
              }
            />
          ))}
        </SettingsGroup>
      )}

      {accounts && (
        <SettingsGroup
          title={t('settings.pcs.link.title')}
          description={t('settings.pcs.link.text')}
          footer={link ? t('settings.pcs.link.fallback') : undefined}
        >
          <SettingsRow
            label={t('settings.pcs.link.name')}
            description={link ? t('settings.pcs.link.opened') : t('settings.pcs.link.hint')}
          >
            {link && (
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(link)
                    .then(() => toast(t('settings.pcs.link.copied')))
                    .catch(() => toast(link))
                }
              >
                <Copy size={15} aria-hidden="true" />
                {t('settings.pcs.link.copy')}
              </button>
            )}
            <button type="button" className="button primary" onClick={() => void connectThisPc()}>
              <Link2 size={15} aria-hidden="true" />
              {t('settings.pcs.link.connect')}
            </button>
          </SettingsRow>
        </SettingsGroup>
      )}

      <SettingsGroup title={t('settings.pcs.paired')} list footer={t('settings.pcs.footer')}>
        {server.devices.length === 0 && silent.length === 0 ? (
          <EmptyGroup
            icon={<Monitor size={20} />}
            action={
              <Link className="button secondary" to="/setup#client">
                {t('settings.pcs.emptyAction')}
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            }
          >
            {server.connected ? t('settings.pcs.empty') : t('settings.pcs.emptyOffline')}
          </EmptyGroup>
        ) : (
          <>
            {server.devices.map((pc) => {
              const session = sessionFor(pc.name);
              return (
                <ListRow
                  key={pc.id}
                  icon={<Monitor size={18} />}
                  title={pc.name}
                  badges={<PcStatus pc={pc} />}
                  meta={[
                    t('settings.pcs.lastSeen', { date: when(pc.lastSeen) }),
                    tp('settings.pcs.uploads', pc.uploaded),
                    pc.analysisLocation === 'client'
                      ? t('settings.pcs.analysisClient')
                      : t('settings.pcs.analysisServer'),
                  ].join(' · ')}
                  detail={
                    <>
                      {pc.folder && <code className="st-path">{pc.folder}</code>}
                      {pc.error && (
                        <span className="st-error-text" role="status">
                          {pc.error}
                        </span>
                      )}
                    </>
                  }
                  menu={
                    session && (
                      <OverflowMenu
                        label={t('settings.pcs.actionsFor', { name: pc.name })}
                        items={[
                          {
                            label: t('settings.pcs.remove'),
                            icon: Unplug,
                            destructive: true,
                            onSelect: (trigger) => remove.open({ session, name: pc.name }, trigger),
                          },
                        ]}
                      />
                    )
                  }
                />
              );
            })}
            {silent.map((session) => (
              <ListRow
                key={session.id}
                icon={<Monitor size={18} />}
                title={session.label}
                badges={<StatusBadge tone="neutral">{t('settings.pcs.waiting')}</StatusBadge>}
                meta={t('settings.pcs.pairedSince', { date: when(session.createdAt) })}
                menu={
                  <OverflowMenu
                    label={t('settings.pcs.actionsFor', { name: session.label })}
                    items={[
                      {
                        label: t('settings.pcs.remove'),
                        icon: Unplug,
                        destructive: true,
                        onSelect: (trigger) =>
                          remove.open({ session, name: session.label }, trigger),
                      },
                    ]}
                  />
                }
              />
            ))}
          </>
        )}
      </SettingsGroup>

      <SettingsGroup
        title={t('settings.pcs.client.title')}
        description={t('settings.pcs.client.text')}
        footer={
          <Link className="st-inline-link" to="/setup#client">
            {t('settings.pcs.client.guide')}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        }
      >
        <SettingsRow
          label={t('settings.pcs.client.name')}
          description={
            download
              ? t('settings.pcs.client.platform')
              : server.connected
                ? t('settings.pcs.client.noInstaller')
                : t('settings.pcs.client.offline')
          }
        >
          {download ? (
            <a className="button secondary" href="/api/downloads/windows" download>
              <Download size={15} aria-hidden="true" />
              {t('settings.pcs.client.download')}
            </a>
          ) : (
            <StatusBadge tone="neutral">{t('settings.pcs.client.unavailable')}</StatusBadge>
          )}
        </SettingsRow>
      </SettingsGroup>

      {remove.value && (
        <ConfirmDialog
          control={remove}
          title={t('settings.pcs.removeTitle', { name: remove.value.name })}
          description={t('settings.pcs.removeText')}
          icon={Unplug}
          confirmLabel={t('settings.pcs.remove')}
          onConfirm={async () => {
            try {
              await api(`/auth/sessions/${remove.value!.session.id}`, { method: 'DELETE' });
              toast(t('settings.pcs.removed', { name: remove.value!.name }));
              await reload();
              return true;
            } catch (error) {
              toast(failure(error));
              return false;
            }
          }}
        />
      )}
    </SettingsPage>
  );
}
