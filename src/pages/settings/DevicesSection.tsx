import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { CircleCheck, Globe, LogOut, QrCode, Smartphone } from 'lucide-react';
import { api } from '../../data/api';
import { useVault } from '../../data/store';
import {
  ConfirmDialog,
  EmptyGroup,
  InfoDialog,
  ListRow,
  OverflowMenu,
  SettingsGroup,
  SettingsPage,
  StatusBadge,
  useDialog,
} from '../../components/settings';
import { t, tx } from '../../i18n';
import { failure, useSessions, when, type DeviceSession } from './shared';

const isPhone = (label: string) => /iPhone|iPad|Android|Mobile/i.test(label);

interface QrState {
  id: string;
  image: string;
  expiresAt: number;
}

/**
 * The QR code that signs one more device in, with its countdown. It asks the server every two
 * seconds whether a device has used the code and then confirms the sign-in.
 */
function QrContent({
  qr,
  onRenew,
  onUsed,
}: {
  qr: QrState | null;
  onRenew: () => void;
  onUsed: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const [used, setUsed] = useState<{ id: string; label: string } | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!qr) return;
    let stopped = false;
    const timer = setInterval(() => {
      if (Date.now() > qr.expiresAt + 5000) return clearInterval(timer);
      void api<{ status: string; label?: string }>(`/auth/qr/${qr.id}`)
        .then((state) => {
          if (stopped || state.status !== 'used') return;
          clearInterval(timer);
          setUsed({ id: qr.id, label: state.label ?? '' });
          onUsed();
        })
        .catch(() => {});
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [qr, onUsed]);
  if (!qr) return <div className="st-qr st-qr-loading" aria-busy="true" />;
  if (used?.id === qr.id)
    return (
      <div className="st-qr st-qr-done" role="status">
        <span className="st-qr-check" aria-hidden="true">
          <CircleCheck size={40} />
        </span>
        <strong>{t('settings.devices.qr.done')}</strong>
        <p>
          {used.label
            ? t('settings.devices.qr.doneDevice', { label: used.label })
            : t('settings.devices.qr.doneText')}
        </p>
      </div>
    );
  const left = Math.max(0, Math.round((qr.expiresAt - now) / 1000));
  return (
    <div className="st-qr">
      <img
        src={qr.image}
        alt={t('settings.devices.qr.alt')}
        width="220"
        height="220"
        data-expired={left === 0 || undefined}
      />
      <p role="status">
        {left > 0
          ? tx('settings.devices.qr.valid', {
              time: (
                <strong>
                  {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
                </strong>
              ),
            })
          : t('settings.devices.qr.expired')}
      </p>
      {left === 0 && (
        <button type="button" className="button primary" onClick={onRenew}>
          {t('settings.devices.qr.renew')}
        </button>
      )}
    </div>
  );
}

/** Browsers and phones signed in to the own account; connect a phone by QR code. */
export function DevicesSection() {
  const { toast } = useVault();
  const { sessions, reload } = useSessions();
  const qrDialog = useDialog<true>();
  const revoke = useDialog<DeviceSession>();
  const [qr, setQr] = useState<QrState | null>(null);
  const browsers = sessions?.filter((session) => session.kind === 'browser') ?? null;
  // The new device shows up in the list right away.
  const onUsed = useCallback(() => void reload(), [reload]);

  async function createQr() {
    setQr(null);
    try {
      const { url, id, expiresAt } = await api<{ url: string; id: string; expiresAt: string }>(
        '/auth/qr',
        {
          method: 'POST',
        },
      );
      const svg = await QRCode.toString(url, {
        type: 'svg',
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#0b0b0f', light: '#ffffff' },
      });
      setQr({
        id,
        image: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
        expiresAt: Date.parse(expiresAt),
      });
    } catch (error) {
      qrDialog.close();
      toast(error instanceof Error ? error.message : t('settings.devices.qr.failed'));
    }
  }

  return (
    <SettingsPage
      id="devices"
      title={t('settings.devices.title')}
      description={t('settings.devices.description')}
      actions={
        <button
          type="button"
          className="button primary"
          onClick={(event) => {
            qrDialog.open(true, event.currentTarget);
            void createQr();
          }}
        >
          <QrCode size={16} aria-hidden="true" />
          {t('settings.devices.connectPhone')}
        </button>
      }
    >
      <SettingsGroup
        title={t('settings.devices.signedIn')}
        list
        footer={t('settings.devices.footer')}
      >
        {browsers === null ? (
          <p className="st-loading">{t('settings.loading')}</p>
        ) : browsers.length === 0 ? (
          <EmptyGroup icon={<Smartphone size={20} />}>{t('settings.devices.empty')}</EmptyGroup>
        ) : (
          browsers.map((session) => {
            const Icon = isPhone(session.label) ? Smartphone : Globe;
            return (
              <ListRow
                key={session.id}
                icon={<Icon size={18} />}
                title={session.label}
                badges={
                  session.current && (
                    <StatusBadge tone="info">{t('settings.devices.thisDevice')}</StatusBadge>
                  )
                }
                meta={t('settings.devices.meta', {
                  lastSeen: when(session.lastSeen),
                  since: when(session.createdAt),
                })}
                menu={
                  !session.current && (
                    <OverflowMenu
                      label={t('settings.devices.actionsFor', { label: session.label })}
                      items={[
                        {
                          label: t('settings.devices.signOut'),
                          icon: LogOut,
                          destructive: true,
                          onSelect: (trigger) => revoke.open(session, trigger),
                        },
                      ]}
                    />
                  )
                }
              />
            );
          })
        )}
      </SettingsGroup>

      {qrDialog.value && (
        <InfoDialog
          control={qrDialog}
          title={t('settings.devices.qr.title')}
          description={t('settings.devices.qr.text')}
          icon={QrCode}
        >
          <QrContent qr={qr} onRenew={() => void createQr()} onUsed={onUsed} />
        </InfoDialog>
      )}
      {revoke.value && (
        <ConfirmDialog
          control={revoke}
          title={t('settings.devices.signOutTitle', { label: revoke.value.label })}
          description={t('settings.devices.signOutText')}
          icon={LogOut}
          confirmLabel={t('settings.devices.signOut')}
          onConfirm={async () => {
            try {
              await api(`/auth/sessions/${revoke.value!.id}`, { method: 'DELETE' });
              toast(t('settings.devices.signedOut', { label: revoke.value!.label }));
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
