import { useSyncExternalStore } from 'react';
import {
  Database,
  Gamepad2,
  Monitor,
  Palette,
  Play,
  Server,
  Smartphone,
  UserRound,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { isAdmin, useAuth } from '../AuthGate';
import { useVault } from '../../data/store';
import type { MessageKey } from '../../i18n';

export const SECTION_IDS = [
  'account',
  'devices',
  'appearance',
  'playback',
  'server',
  'pcs',
  'users',
  'games',
  'storage',
] as const;
export type SectionId = (typeof SECTION_IDS)[number];
export const isSectionId = (value: unknown): value is SectionId =>
  SECTION_IDS.includes(value as SectionId);

export interface SectionInfo {
  id: SectionId;
  label: MessageKey;
  icon: LucideIcon;
}
export const SECTION_GROUPS: {
  id: 'you' | 'archive';
  label: MessageKey;
  sections: SectionInfo[];
}[] = [
  {
    id: 'you',
    label: 'settings.nav.you',
    sections: [
      { id: 'account', label: 'settings.account.title', icon: UserRound },
      { id: 'devices', label: 'settings.devices.title', icon: Smartphone },
      { id: 'appearance', label: 'settings.appearance.title', icon: Palette },
      { id: 'playback', label: 'settings.playback.title', icon: Play },
    ],
  },
  {
    id: 'archive',
    label: 'settings.nav.archive',
    sections: [
      { id: 'server', label: 'settings.server.title', icon: Server },
      { id: 'pcs', label: 'settings.pcs.title', icon: Monitor },
      { id: 'users', label: 'settings.users.title', icon: Users },
      { id: 'games', label: 'settings.games.title', icon: Gamepad2 },
      { id: 'storage', label: 'settings.storage.title', icon: Database },
    ],
  },
];
export const sectionInfo = (id: SectionId) =>
  SECTION_GROUPS.flatMap((group) => group.sections).find((section) => section.id === id)!;

/** Anchors of the old single settings page and where they live now. */
export const LEGACY_ANCHORS: Record<string, SectionId> = {
  analysis: 'server',
  server: 'server',
  games: 'games',
  profile: 'account',
  account: 'account',
  playback: 'playback',
  appearance: 'appearance',
  storage: 'storage',
  devices: 'pcs',
  users: 'users',
};

/**
 * Who sees which section. Accounts: the server knows accounts (signed in). Local mode: neither
 * accounts nor a connected server; then only the personal sections, Server (to connect one) and
 * Storage remain. Admin-only sections are hidden for plain users.
 */
export function useSettingsAccess() {
  const { auth } = useAuth();
  const { server } = useVault();
  const accounts = !!auth;
  const admin = isAdmin(auth);
  const signedInUser = !!auth?.user;
  const archive = accounts || server.connected;
  const visible: Record<SectionId, boolean> = {
    account: signedInUser,
    devices: signedInUser && auth?.kind !== 'client',
    appearance: true,
    playback: true,
    server: admin,
    pcs: admin && archive,
    users: admin && accounts,
    games: admin && archive,
    storage: true,
  };
  return { auth, accounts, admin, local: !archive, visible };
}

/** Where "Devices" links point: recording PCs for admins, own devices for users. */
export function useDevicesHref() {
  const { visible } = useSettingsAccess();
  if (visible.pcs) return '/settings/pcs';
  if (visible.devices) return '/settings/devices';
  return '/settings/server';
}

/** Server section for admins, otherwise the settings start (e.g. for status links). */
export function useServerHref() {
  const { visible } = useSettingsAccess();
  return visible.server ? '/settings/server' : '/settings';
}

const PHONE_QUERY = '(max-width: 719px)';
function subscribePhone(callback: () => void) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}
/** Below 720 px the section list is its own screen. */
export function useIsPhone() {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}
