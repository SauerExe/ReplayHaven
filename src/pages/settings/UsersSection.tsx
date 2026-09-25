import { useCallback, useEffect, useState } from 'react';
import {
  Ban,
  CircleCheck,
  KeyRound,
  LogOut,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '../../data/api';
import { useVault } from '../../data/store';
import { useAuth } from '../../components/AuthGate';
import {
  Avatar,
  ConfirmDialog,
  FormDialog,
  ListRow,
  OverflowMenu,
  SettingsGroup,
  SettingsPage,
  StatusBadge,
  useDialog,
} from '../../components/settings';
import { t, tp } from '../../i18n';
import { day, failure } from './shared';

/** One account as GET /api/users returns it (server/auth-routes.ts). */
interface ManagedUser {
  id: string;
  name: string;
  role: 'admin' | 'user';
  disabled: boolean;
  createdAt: string;
  hasPassword: boolean;
  oidcLinked: boolean;
  sessions: { browser: number; client: number };
  self: boolean;
}
type Confirm = 'disable' | 'signOut' | 'delete';

const confirmIcons: Record<Confirm, LucideIcon> = { disable: Ban, signOut: LogOut, delete: Trash2 };

/** User management for admins: list, add (dialog), roles, disable, reset password, remove. */
export function UsersSection() {
  const { auth } = useAuth();
  const { toast } = useVault();
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [error, setError] = useState('');
  const add = useDialog<true>();
  const password = useDialog<ManagedUser>();
  const confirm = useDialog<{ kind: Confirm; user: ManagedUser }>();
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const oidc = auth?.oidc?.enabled ? auth.oidc : null;

  const load = useCallback(async () => {
    try {
      setUsers(await api<ManagedUser[]>('/users'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.users.loadFailed'));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  /** Runs a change, reports it and reloads the list; true when it worked. */
  async function run(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      toast(done);
      await load();
      return true;
    } catch (e) {
      toast(failure(e));
      return false;
    }
  }
  const patch = (user: ManagedUser, body: object, done: string) =>
    run(() => api(`/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(body) }), done);

  const confirmText = (kind: Confirm, user: ManagedUser) =>
    ({
      disable: {
        title: t('settings.users.disableTitle', { name: user.name }),
        text: t('settings.users.disableText'),
        button: t('settings.users.disable'),
      },
      signOut: {
        title: t('settings.users.signOutTitle', { name: user.name }),
        text: t('settings.users.signOutText'),
        button: t('settings.users.signOut'),
      },
      delete: {
        title: t('settings.users.deleteTitle', { name: user.name }),
        text: t('settings.users.deleteText'),
        button: t('settings.users.delete'),
      },
    })[kind];

  return (
    <SettingsPage
      id="users"
      title={t('settings.users.title')}
      description={t('settings.users.description')}
      badge={
        users && (
          <span className="st-count" aria-hidden="true">
            {users.length}
          </span>
        )
      }
      actions={
        <button
          type="button"
          className="button primary"
          onClick={(event) => {
            setName('');
            setSecret('');
            setRole('user');
            add.open(true, event.currentTarget);
          }}
        >
          <UserPlus size={16} aria-hidden="true" />
          {t('settings.users.add')}
        </button>
      }
    >
      <SettingsGroup title={t('settings.users.accounts')} list footer={t('settings.users.roles')}>
        {error && (
          <p className="st-alert" role="alert">
            {error}
          </p>
        )}
        {users === null && !error && <p className="st-loading">{t('settings.loading')}</p>}
        {users?.map((user) => (
          <ListRow
            key={user.id}
            muted={user.disabled}
            icon={<Avatar name={user.name} />}
            title={user.name}
            badges={
              <>
                <StatusBadge tone={user.role === 'admin' ? 'accent' : 'neutral'}>
                  {user.role === 'admin' ? t('settings.role.admin') : t('settings.role.user')}
                </StatusBadge>
                {user.self && <StatusBadge tone="info">{t('settings.users.you')}</StatusBadge>}
                {user.disabled && (
                  <StatusBadge tone="warning">{t('settings.users.disabled')}</StatusBadge>
                )}
                {user.oidcLinked && <StatusBadge tone="neutral">{oidc?.name ?? 'SSO'}</StatusBadge>}
              </>
            }
            meta={[
              t('settings.users.since', { date: day(user.createdAt) }),
              tp('settings.users.browsers', user.sessions.browser),
              tp('settings.users.pcs', user.sessions.client),
              ...(user.hasPassword ? [] : [t('settings.users.noPassword')]),
            ].join(' · ')}
            menu={
              <OverflowMenu
                label={t('settings.users.actionsFor', { name: user.name })}
                items={[
                  {
                    label:
                      user.role === 'admin'
                        ? t('settings.users.makeUser')
                        : t('settings.users.makeAdmin'),
                    icon: user.role === 'admin' ? UserRound : ShieldCheck,
                    // Nobody demotes themselves by accident and locks the server.
                    hidden: user.self,
                    onSelect: () =>
                      void patch(
                        user,
                        { role: user.role === 'admin' ? 'user' : 'admin' },
                        user.role === 'admin'
                          ? t('settings.users.nowUser', { name: user.name })
                          : t('settings.users.nowAdmin', { name: user.name }),
                      ),
                  },
                  {
                    label: t('settings.users.resetPassword'),
                    icon: KeyRound,
                    onSelect: (trigger) => {
                      setSecret('');
                      password.open(user, trigger);
                    },
                  },
                  {
                    label: t('settings.users.enable'),
                    icon: CircleCheck,
                    hidden: user.self || !user.disabled,
                    onSelect: () =>
                      void patch(
                        user,
                        { disabled: false },
                        t('settings.users.enabled', { name: user.name }),
                      ),
                  },
                  {
                    label: t('settings.users.signOut'),
                    icon: LogOut,
                    hidden: user.self,
                    destructive: true,
                    onSelect: (trigger) => confirm.open({ kind: 'signOut', user }, trigger),
                  },
                  {
                    label: t('settings.users.disable'),
                    icon: Ban,
                    hidden: user.self || user.disabled,
                    destructive: true,
                    onSelect: (trigger) => confirm.open({ kind: 'disable', user }, trigger),
                  },
                  {
                    label: t('settings.users.delete'),
                    icon: Trash2,
                    hidden: user.self,
                    destructive: true,
                    onSelect: (trigger) => confirm.open({ kind: 'delete', user }, trigger),
                  },
                ]}
              />
            }
          />
        ))}
      </SettingsGroup>

      {add.value && (
        <FormDialog
          control={add}
          title={t('settings.users.addTitle')}
          description={
            oidc
              ? t('settings.users.addTextOidc', { provider: oidc.name })
              : t('settings.users.addText')
          }
          icon={UserPlus}
          submitLabel={t('settings.users.create')}
          disabled={!name.trim()}
          onSubmit={() =>
            run(
              () =>
                api('/users', {
                  method: 'POST',
                  body: JSON.stringify({ name, role, ...(secret ? { password: secret } : {}) }),
                }),
              t('settings.users.created', { name: name.trim() }),
            )
          }
        >
          <label className="field">
            {t('settings.users.name')}
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={60}
              autoComplete="off"
            />
          </label>
          <label className="field">
            {t('settings.users.password')}
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              minLength={8}
              required={!oidc}
              autoComplete="new-password"
              placeholder={
                oidc ? t('settings.users.passwordOidcPlaceholder', { provider: oidc.name }) : ''
              }
            />
            <small className="st-field-hint">{t('settings.passwordRule')}</small>
          </label>
          <label className="field">
            {t('settings.users.role')}
            <select value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')}>
              <option value="user">{t('settings.users.roleUserOption')}</option>
              <option value="admin">{t('settings.users.roleAdminOption')}</option>
            </select>
          </label>
        </FormDialog>
      )}
      {password.value && (
        <FormDialog
          control={password}
          title={t('settings.users.passwordTitle', { name: password.value.name })}
          description={t('settings.users.passwordText')}
          icon={KeyRound}
          submitLabel={t('common.save')}
          onSubmit={() => {
            const user = password.value!;
            return run(
              () =>
                api(`/users/${user.id}/password`, {
                  method: 'POST',
                  body: JSON.stringify({ password: secret }),
                }),
              t('settings.users.passwordChanged', { name: user.name }),
            );
          }}
        >
          <label className="field">
            {t('settings.users.newPassword')}
            <input
              autoFocus
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              minLength={8}
              required
              autoComplete="new-password"
            />
            <small className="st-field-hint">{t('settings.passwordRule')}</small>
          </label>
        </FormDialog>
      )}
      {confirm.value && (
        <ConfirmDialog
          control={confirm}
          title={confirmText(confirm.value.kind, confirm.value.user).title}
          description={confirmText(confirm.value.kind, confirm.value.user).text}
          icon={confirmIcons[confirm.value.kind]}
          confirmLabel={confirmText(confirm.value.kind, confirm.value.user).button}
          onConfirm={() => {
            const { kind, user } = confirm.value!;
            if (kind === 'disable')
              return patch(
                user,
                { disabled: true },
                t('settings.users.disabledDone', { name: user.name }),
              );
            if (kind === 'signOut')
              return run(
                () => api(`/users/${user.id}/sessions`, { method: 'DELETE' }),
                t('settings.users.signedOut', { name: user.name }),
              );
            return run(
              () => api(`/users/${user.id}`, { method: 'DELETE' }),
              t('settings.users.deleted', { name: user.name }),
            );
          }}
        />
      )}
    </SettingsPage>
  );
}
