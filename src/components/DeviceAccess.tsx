import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Globe, Monitor, QrCode, Smartphone, X } from 'lucide-react';
import { api } from '../data/api';
import { useAuth } from './AuthGate';
import { useVault } from '../data/store';

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
const when = (at: string) =>
  new Date(at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Kopplung und Geräte (server/auth-routes.ts): Aufnahme-PCs, die um Freigabe bitten, ein
 * QR-Code für das Handy und alle angemeldeten Geräte. Nur mit einem Server, der Konten kennt.
 */
export function DeviceAccess() {
  const { auth } = useAuth();
  const { toast } = useVault();
  const [pending, setPending] = useState<PendingPairing[]>([]);
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [qr, setQr] = useState<{ image: string; url: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const manage = !!auth && auth.kind !== 'client';

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([
      api<PendingPairing[]>('/pair/pending').catch(() => []),
      api<DeviceSession[]>('/auth/sessions').catch(() => []),
    ]);
    setPending(p);
    setSessions(s);
  }, []);
  useEffect(() => {
    if (!manage) return;
    void load();
    // Ein PC, der gerade um Kopplung bittet, soll ohne Neuladen erscheinen.
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [manage, load]);
  useEffect(() => {
    if (!qr) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [qr]);
  if (!manage) return null;

  async function decide(id: string, approve: boolean) {
    try {
      await api(`/pair/${id}/${approve ? 'approve' : 'deny'}`, { method: 'POST' });
      toast(
        approve ? 'PC freigegeben. Er verbindet sich in wenigen Sekunden.' : 'Anfrage abgelehnt.',
      );
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    }
  }
  async function revoke(session: DeviceSession) {
    const what =
      session.kind === 'client'
        ? 'Dieser PC lädt dann nichts mehr hoch'
        : 'Das Gerät wird abgemeldet';
    if (!window.confirm(`„${session.label}“ entfernen? ${what}.`)) return;
    try {
      await api(`/auth/sessions/${session.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
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
      toast(e instanceof Error ? e.message : 'Der QR-Code ließ sich nicht erstellen.');
    }
  }
  const left = qr ? Math.max(0, Math.round((qr.expiresAt - now) / 1000)) : 0;

  return (
    <>
      {pending.length > 0 && (
        <section className="access-section pairing-requests" aria-live="polite">
          <div className="section-heading">
            <h2>Neue Aufnahme-PCs</h2>
          </div>
          {pending.map((request) => (
            <div className="pair-request" key={request.id}>
              <span className="device-icon">
                <Monitor size={26} />
              </span>
              <div>
                <h3>{request.name} möchte sich verbinden</h3>
                <p>
                  Gib nur frei, wenn dein PC denselben Code zeigt:{' '}
                  <strong className="pair-code">
                    {request.code.slice(0, 3)} {request.code.slice(3)}
                  </strong>
                </p>
              </div>
              <div className="pair-actions">
                <button className="button secondary" onClick={() => void decide(request.id, false)}>
                  <X size={16} /> Ablehnen
                </button>
                <button className="button primary" onClick={() => void decide(request.id, true)}>
                  <Check size={16} /> Freigeben
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
      <section className="access-section">
        <div className="section-heading">
          <h2>Angemeldete Geräte</h2>
          <button className="button secondary" onClick={() => void (qr ? setQr(null) : showQr())}>
            <QrCode size={16} />
            {qr ? 'QR-Code schließen' : 'Handy verbinden'}
          </button>
        </div>
        {qr && (
          <div className="qr-box">
            <img
              src={qr.image}
              alt="QR-Code zum Anmelden eines weiteren Geräts"
              width="220"
              height="220"
            />
            <div>
              <h3>Mit der Handy-Kamera scannen</h3>
              <p>
                Der Code meldet genau ein Gerät mit deinem Konto an, ohne Passwort. Er gilt noch{' '}
                <strong>
                  {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
                </strong>{' '}
                Minuten.
              </p>
              {left === 0 && (
                <button className="button primary" onClick={() => void showQr()}>
                  Neuen Code zeigen
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
                    {session.current && <span className="demo-label">Dieses Gerät</span>}
                    {session.kind === 'client' && <span className="demo-label">Aufnahme-PC</span>}
                  </strong>
                  <p>
                    Zuletzt aktiv {when(session.lastSeen)} · seit {when(session.createdAt)}
                  </p>
                </div>
                {!session.current && (
                  <button className="button secondary" onClick={() => void revoke(session)}>
                    Entfernen
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
