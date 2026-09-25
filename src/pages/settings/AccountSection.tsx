import { useState } from 'react';
import { KeyRound, Link2, LogOut, Pencil, Unlink, UserRound } from 'lucide-react';
import { api } from '../../data/api';
import { useVault } from '../../data/store';
import { useAuth } from '../../components/AuthGate';
import {
  Avatar,
  ConfirmDialog,
  FormDialog,
  ListRow,
  RowValue,
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  StatusBadge,
  useDialog,
} from '../../components/settings';
import { t } from '../../i18n';
import { failure } from './shared';

/** The name shown in the app. Stored in this browser; also used in local mode (Appearance). */
export function DisplayNameRow() {
  const { state, setState, toast } = useVault();
  const dialog = useDialog<true>();
  const [name, setName] = useState('');
  const current = state.preferences.name;
  return (
    <>
      <SettingsRow
        label={t('settings.account.name.label')}
        description={t('settings.account.name.hint')}
      >
        <RowValue>{current}</RowValue>
        <button
          type="button"
          className="button secondary"
          aria-label={t('settings.account.name.editLabel')}
          onClick={(event) => {
            setName(current);
            dialog.open(true, event.currentTarget);
          }}
        >
          <Pencil size={15} aria-hidden="true" />
          {t('settings.edit')}
        </button>
      </SettingsRow>
      {dialog.value && (
        <FormDialog
          control={dialog}
          title={t('settings.account.name.dialogTitle')}
          description={t('settings.account.name.hint')}
          icon={UserRound}
          submitLabel={t('common.save')}
          disabled={!name.trim() || name.trim() === current}
          onSubmit={async () => {
            setState((s) => ({ ...s, preferences: { ...s.preferences, name: name.trim() } }));
            toast(t('settings.account.name.saved'));
            return true;
          }}
        >
          <label className="field">
            {t('settings.account.name.field')}
            <input
              autoFocus
              value={name}
              required
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        </FormDialog>
      )}
    </>
  );
}

/** Name, password, single sign-on and signing out of the own account. */
export function AccountSection() {
  const { auth, refresh, logout } = useAuth();
  const { toast } = useVault();
  const password = useDialog<true>();
  const unlink = useDialog<true>();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const user = auth?.user;
  if (!auth || !user) return null;
  // Older servers do not report it; they always had a password.
  const hasPassword = user.hasPassword !== false;
  const oidc = auth.oidc?.enabled ? auth.oidc : null;
  const admin = (user.role ?? auth.role) !== 'user';

  return (
    <SettingsPage
      id="account"
      title={t('settings.account.title')}
      description={t('settings.account.description')}
    >
      <SettingsGroup list>
        <ListRow
          icon={<Avatar name={user.name} />}
          title={user.name}
          badges={
            <StatusBadge tone={admin ? 'accent' : 'neutral'}>
              {admin ? t('settings.role.admin') : t('settings.role.user')}
            </StatusBadge>
          }
          meta={t('settings.account.signedIn')}
          action={
            <button type="button" className="button secondary" onClick={() => void logout()}>
              <LogOut size={15} aria-hidden="true" />
              {t('settings.account.signOut')}
            </button>
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t('settings.account.profile')}>
        <DisplayNameRow />
      </SettingsGroup>

      <SettingsGroup
        title={t('settings.account.signIn')}
        description={t('settings.account.signInHint')}
      >
        <SettingsRow
          label={t('settings.account.password.label')}
          description={
            hasPassword
              ? t('settings.account.password.hint')
              : t('settings.account.password.none', { provider: oidc?.name ?? 'SSO' })
          }
        >
          <button
            type="button"
            className="button secondary"
            onClick={(event) => {
              setCurrent('');
              setNext('');
              password.open(true, event.currentTarget);
            }}
          >
            <KeyRound size={15} aria-hidden="true" />
            {hasPassword
              ? t('settings.account.password.change')
              : t('settings.account.password.set')}
          </button>
        </SettingsRow>
        {oidc && (
          <SettingsRow
            label={t('settings.account.sso.label', { provider: oidc.name })}
            description={
              user.oidcLinked
                ? hasPassword
                  ? t('settings.account.sso.linked', { provider: oidc.name })
                  : t('settings.account.sso.needsPassword')
                : t('settings.account.sso.hint', { provider: oidc.name })
            }
          >
            {user.oidcLinked ? (
              <>
                <StatusBadge tone="ok" dot>
                  {t('settings.account.sso.linkedBadge')}
                </StatusBadge>
                <button
                  type="button"
                  className="button secondary"
                  disabled={!hasPassword}
                  onClick={(event) => unlink.open(true, event.currentTarget)}
                >
                  <Unlink size={15} aria-hidden="true" />
                  {t('settings.account.sso.unlink', { provider: oidc.name })}
                </button>
              </>
            ) : (
              // Full page navigation: the provider's sign-in page takes over and returns here.
              <a className="button secondary" href="/api/auth/oidc/start?link=1">
                <Link2 size={15} aria-hidden="true" />
                {t('settings.account.sso.link', { provider: oidc.name })}
              </a>
            )}
          </SettingsRow>
        )}
      </SettingsGroup>

      {password.value && (
        <FormDialog
          control={password}
          title={
            hasPassword ? t('settings.account.password.change') : t('settings.account.password.set')
          }
          description={
            hasPassword
              ? t('settings.account.password.changeText')
              : t('settings.account.password.setText')
          }
          icon={KeyRound}
          submitLabel={t('common.save')}
          onSubmit={async () => {
            try {
              await api('/auth/password', {
                method: 'POST',
                body: JSON.stringify({ current: hasPassword ? current : '', next }),
              });
              toast(
                hasPassword
                  ? t('settings.account.password.changed')
                  : t('settings.account.password.saved'),
              );
              await refresh();
              return true;
            } catch (error) {
              toast(failure(error));
              return false;
            }
          }}
        >
          {hasPassword && (
            <label className="field">
              {t('settings.account.password.current')}
              <input
                type="password"
                autoComplete="current-password"
                autoFocus
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                required
              />
            </label>
          )}
          <label className="field">
            {t('settings.account.password.new')}
            <input
              type="password"
              autoComplete="new-password"
              autoFocus={!hasPassword}
              minLength={8}
              value={next}
              onChange={(event) => setNext(event.target.value)}
              required
            />
            <small className="st-field-hint">{t('settings.passwordRule')}</small>
          </label>
        </FormDialog>
      )}
      {unlink.value && oidc && (
        <ConfirmDialog
          control={unlink}
          title={t('settings.account.sso.unlinkTitle', { provider: oidc.name })}
          description={t('settings.account.sso.unlinkText', { provider: oidc.name })}
          icon={Unlink}
          confirmLabel={t('settings.account.sso.unlinkConfirm')}
          onConfirm={async () => {
            try {
              await api('/auth/oidc/unlink', { method: 'POST' });
              toast(t('settings.account.sso.unlinked'));
              await refresh();
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
