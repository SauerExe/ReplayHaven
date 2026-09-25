import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Link } from 'react-router-dom';
import { Check, Globe, KeyRound, Monitor, QrCode, Smartphone, Users, X } from 'lucide-react';
import { api } from '../data/api';
import { isAdmin, useAuth } from './AuthGate';
import { useVault } from '../data/store';
import { perLanguage, t, tx } from '../i18n';

interface PendingPairing {
  id: string;
  code: string;
  name: string;
  createdAt: string;
  expiresAt: string;
}
interface DeviceSession {
  id: string;
  kind: 'browser' | 'client';
  label: string;
  createdAt: string;
  lastSeen: string;
  current: boolean;
}
const whenFormat = perLanguage(
  (tag) => new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' }),
);
const when = (at: string) => whenFormat().format(new Date(at));

/**
 * Pairing and devices (server/auth-routes.ts): recording PCs asking for approval (admins only), a
 * QR code for the phone, all signed-in devices and the single sign-on link of the own account.
 * Only with a server that knows accounts.
 */
export function DeviceAccess() {
  const { auth, refresh } = useAuth();
  const { toast } = useVault();
  const [pending, setPending] = useState<PendingPairing[]>([]);
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [qr, setQr] = useState<{ image: string; url: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const manage = !!auth && auth.kind !== 'client';
  const admin = isAdmin(auth);

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([
      admin ? api<PendingPairing[]>('/pair/pending').catch(() => []) : Promise.resolve([]),
      api<DeviceSession[]>('/auth/sessions').catch(() => []),
    ]);
    setPending(p);
    setSessions(s);
  }, [admin]);
  useEffect(() => {
    if (!manage) return;
    void load();
    // A PC that is asking to be paired should appear without reloading.
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [manage, load]);
  useEffect(() => {
    if (!qr) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [qr]);
  useEffect(() => {
    // Back from linking single sign-on (server redirects to /devices?linked=1).
    const url = new URL(window.location.href);
    if (url.searchParams.get('linked') !== '1') return;
    url.searchParams.delete('linked');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    toast(t('deviceAccess.linkedToast'));
    void refresh();
  }, [toast, refresh]);
  if (!manage) return null;
  const oidc = auth?.oidc?.enabled ? auth.oidc : null;

  async function unlink() {
    if (
      !window.confirm(
        t('deviceAccess.unlinkConfirm', { provider: oidc?.name ?? t('deviceAccess.sso') }),
      )
    )
      return;
    try {
      await api('/auth/oidc/unlink', { method: 'POST' });
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : t('deviceAccess.failed'));
    }
  }

  async function decide(id: string, approve: boolean) {
    try {
      await api(`/pair/${id}/${approve ? 'approve' : 'deny'}`, { method: 'POST' });
      toast(approve ? t('deviceAccess.approved') : t('deviceAccess.denied'));
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : t('deviceAccess.failed'));
    }
  }
  async function revoke(session: DeviceSession) {
    const consequence =
      session.kind === 'client' ? t('deviceAccess.revokeClient') : t('deviceAccess.revokeBrowser');
    if (!window.confirm(t('deviceAccess.revokeConfirm', { label: session.label, consequence })))
      return;
    try {
      await api(`/auth/sessions/${session.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : t('deviceAccess.failed'));
    }
  }
  async function showQr() {
    try {
      const { url, expiresAt } = await api<{ url: string; expiresAt: string }>('/auth/qr', {
        method: 'POST',
      });
      const svg = await QRCode.toString(url, {
        type: 'svg',
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#0b0b0f', light: '#ffffff' },
      });
      setQr({
        image: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
        url,
        expiresAt: Date.parse(expiresAt),
      });
      setNow(Date.now());
    } catch (e) {
      toast(e instanceof Error ? e.message : t('deviceAccess.qrFailed'));
    }
  }
  const left = qr ? Math.max(0, Math.round((qr.expiresAt - now) / 1000)) : 0;

  return (
    <>
      {pending.length > 0 && (
        <section className="access-section pairing-requests" aria-live="polite">
          <div className="section-heading">
            <h2>{t('deviceAccess.newPcs')}</h2>
          </div>
          {pending.map((request) => (
            <div className="pair-request" key={request.id}>
              <span className="device-icon">
                <Monitor size={26} />
              </span>
              <div>
                <h3>{t('deviceAccess.wantsToConnect', { name: request.name })}</h3>
                <p>
                  {tx('deviceAccess.compareCode', {
                    code: (
                      <strong className="pair-code">
                        {request.code.slice(0, 3)} {request.code.slice(3)}
                      </strong>
                    ),
                  })}
                </p>
              </div>
              <div className="pair-actions">
                <button className="button secondary" onClick={() => void decide(request.id, false)}>
                  <X size={16} /> {t('deviceAccess.deny')}
                </button>
                <button className="button primary" onClick={() => void decide(request.id, true)}>
                  <Check size={16} /> {t('deviceAccess.approve')}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
      {(admin || (oidc && auth?.kind === 'browser')) && (
        <section className="access-section">
          <div className="section-heading">
            <h2>{t('deviceAccess.accountAccess')}</h2>
          </div>
          <div className="access-links">
            {oidc && auth?.kind === 'browser' && (
              <div className="access-link">
                <KeyRound size={20} />
                <div>
                  <strong>{oidc.name}</strong>
                  <p>
                    {auth.user?.oidcLinked
                      ? t('deviceAccess.linked', { provider: oidc.name })
                      : t('deviceAccess.linkHint', { provider: oidc.name })}
                  </p>
                </div>
                {auth.user?.oidcLinked ? (
                  <button className="button secondary" onClick={() => void unlink()}>
                    {t('deviceAccess.unlink')}
                  </button>
                ) : (
                  <a className="button secondary" href="/api/auth/oidc/start?link=1">
                    {t('deviceAccess.link')}
                  </a>
                )}
              </div>
            )}
            {admin && (
              <div className="access-link">
                <Users size={20} />
                <div>
                  <strong>{t('deviceAccess.users')}</strong>
                  <p>{t('deviceAccess.usersHint')}</p>
                </div>
                <Link className="button secondary" to="/users">
                  {t('deviceAccess.manageUsers')}
                </Link>
              </div>
            )}
          </div>
        </section>
      )}
      <section className="access-section">
        <div className="section-heading">
          <h2>{t('deviceAccess.signedIn')}</h2>
          <button className="button secondary" onClick={() => void (qr ? setQr(null) : showQr())}>
            <QrCode size={16} />
            {qr ? t('deviceAccess.closeQr') : t('deviceAccess.connectPhone')}
          </button>
        </div>
        {qr && (
          <div className="qr-box">
            <img src={qr.image} alt={t('deviceAccess.qrAlt')} width="220" height="220" />
            <div>
              <h3>{t('deviceAccess.scan')}</h3>
              <p>
                {tx('deviceAccess.qrText', {
                  time: (
                    <strong>
                      {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
                    </strong>
                  ),
                })}
              </p>
              {left === 0 && (
                <button className="button primary" onClick={() => void showQr()}>
                  {t('deviceAccess.newCode')}
                </button>
              )}
            </div>
          </div>
        )}
        <div className="session-list">
          {sessions.map((session) => {
            const Icon =
              session.kind === 'client'
                ? Monitor
                : /iPhone|Android/.test(session.label)
                  ? Smartphone
                  : Globe;
            return (
              <div className="session-row" key={session.id}>
                <Icon size={20} />
                <div>
                  <strong>
                    {session.label}
                    {session.current && (
                      <span className="demo-label">{t('deviceAccess.thisDevice')}</span>
                    )}
                    {session.kind === 'client' && (
                      <span className="demo-label">{t('deviceAccess.recordingPc')}</span>
                    )}
                  </strong>
                  <p>
                    {t('deviceAccess.lastSeen', {
                      lastSeen: when(session.lastSeen),
                      since: when(session.createdAt),
                    })}
                  </p>
                </div>
                {!session.current && (
                  <button className="button secondary" onClick={() => void revoke(session)}>
                    {t('deviceAccess.remove')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
