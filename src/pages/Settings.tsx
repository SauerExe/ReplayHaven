import { useEffect } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import {
  EmptyGroup,
  LEGACY_ANCHORS,
  SECTION_GROUPS,
  SettingsGroup,
  SettingsPage,
  SettingsShell,
  isSectionId,
  sectionInfo,
  useIsPhone,
  useSettingsAccess,
  type SectionId,
} from '../components/settings';
import { useAuth } from '../components/AuthGate';
import { useVault } from '../data/store';
import { t } from '../i18n';
import { usePairingRequests, type PairingRequests } from './settings/shared';
import { AccountSection } from './settings/AccountSection';
import { DevicesSection } from './settings/DevicesSection';
import { AppearanceSection } from './settings/AppearanceSection';
import { PlaybackSection } from './settings/PlaybackSection';
import { ServerSection } from './settings/ServerSection';
import { PcsSection } from './settings/PcsSection';
import { UsersSection } from './settings/UsersSection';
import { GamesSection } from './settings/GamesSection';
import { StorageSection } from './settings/StorageSection';

function Section({ id, pairing }: { id: SectionId; pairing: PairingRequests }) {
  switch (id) {
    case 'account':
      return <AccountSection />;
    case 'devices':
      return <DevicesSection />;
    case 'appearance':
      return <AppearanceSection />;
    case 'playback':
      return <PlaybackSection />;
    case 'server':
      return <ServerSection />;
    case 'pcs':
      return <PcsSection pairing={pairing} />;
    case 'users':
      return <UsersSection />;
    case 'games':
      return <GamesSection />;
    case 'storage':
      return <StorageSection />;
  }
}

/** A section this browser cannot use (admin only, or it needs a server with accounts). */
function Unavailable({ id, admin }: { id: SectionId; admin: boolean }) {
  const needsAdmin = !admin && ['server', 'pcs', 'users', 'games'].includes(id);
  return (
    <SettingsPage id={id} title={t(sectionInfo(id).label)}>
      <SettingsGroup>
        <EmptyGroup
          icon={<Lock size={20} />}
          action={
            !needsAdmin && (
              <Link className="button secondary" to="/settings/server">
                {t('settings.unavailable.connect')}
              </Link>
            )
          }
        >
          {needsAdmin ? t('settings.unavailable.admin') : t('settings.unavailable.server')}
        </EmptyGroup>
      </SettingsGroup>
    </SettingsPage>
  );
}

/** Back from linking single sign-on: the server redirects with `?linked=1`. */
function useLinkedNotice() {
  const { toast } = useVault();
  const { refresh } = useAuth();
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('linked') !== '1') return;
    url.searchParams.delete('linked');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    toast(t('settings.account.sso.linkedToast'));
    void refresh();
  }, [toast, refresh]);
}

/** `/settings` and `/settings/:section` (docs/SETTINGS-DESIGN.md). */
export default function Settings() {
  const { section } = useParams();
  const { hash } = useLocation();
  const phone = useIsPhone();
  const { visible, admin, accounts } = useSettingsAccess();
  const pairing = usePairingRequests(visible.pcs && accounts);
  useLinkedNotice();

  const legacy = !section && hash ? LEGACY_ANCHORS[hash.slice(1)] : undefined;
  if (legacy) return <Navigate replace to={`/settings/${legacy}`} />;
  if (section !== undefined && !isSectionId(section)) return <Navigate replace to="/settings" />;
  const current = section ?? null;
  if (!current && !phone) {
    const first = SECTION_GROUPS.flatMap((group) => group.sections).find((s) => visible[s.id])!;
    return <Navigate replace to={`/settings/${first.id}`} />;
  }
  return (
    <SettingsShell
      current={current}
      phone={phone}
      visible={visible}
      badges={{ pcs: pairing.pending.length }}
    >
      {current &&
        (visible[current] ? (
          <Section key={current} id={current} pairing={pairing} />
        ) : (
          <Unavailable id={current} admin={admin} />
        ))}
    </SettingsShell>
  );
}
