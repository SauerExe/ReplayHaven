import { useCallback, useEffect, useState } from 'react';
import { api } from '../../data/api';
import { perLanguage, t } from '../../i18n';

const whenFormat = perLanguage(
  (tag) => new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' }),
);
const dayFormat = perLanguage((tag) => new Intl.DateTimeFormat(tag, { dateStyle: 'medium' }));
/** Date and time, e.g. "Sep 25, 2026, 9:52 PM". */
export const when = (at: string) => whenFormat().format(new Date(at));
/** Date only, e.g. "Sep 25, 2026". */
export const day = (at: string) => dayFormat().format(new Date(at));

export const failure = (error: unknown) =>
  error instanceof Error && error.message ? error.message : t('settings.failed');

/** A signed-in browser, phone or paired PC of the own account (GET /api/auth/sessions). */
export interface DeviceSession {
  id: string;
  kind: 'browser' | 'client';
  label: string;
  createdAt: string;
  lastSeen: string;
  current: boolean;
}

/** A recording PC waiting for approval (GET /api/pair/pending). */
export interface PendingPairing {
  id: string;
  code: string;
  name: string;
  createdAt: string;
  expiresAt: string;
}

/** The own sessions, refreshed every few seconds while the section is open. */
export function useSessions(enabled = true, interval = 5000) {
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const load = useCallback(async () => {
    setSessions(await api<DeviceSession[]>('/auth/sessions').catch(() => []));
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void load();
    const timer = setInterval(() => void load(), interval);
    return () => clearInterval(timer);
  }, [enabled, load, interval]);
  return { sessions, reload: load };
}

/** Pairing requests; polled so a PC asking to be paired appears without reloading. */
export function usePairingRequests(enabled: boolean) {
  const [pending, setPending] = useState<PendingPairing[]>([]);
  const load = useCallback(async () => {
    setPending(await api<PendingPairing[]>('/pair/pending').catch(() => []));
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [enabled, load]);
  return { pending: enabled ? pending : [], reload: load };
}
export type PairingRequests = ReturnType<typeof usePairingRequests>;
