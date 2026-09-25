import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, LogOut, ShieldCheck, Trash2, UserPlus, UserRound } from 'lucide-react';
import { api } from '../data/api';
import { useVault } from '../data/store';
import { PageHeading } from '../components/PageHeading';
import { isAdmin, useAuth } from '../components/AuthGate';
import { perLanguage, t, tp } from '../i18n';

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
const dayFormat = perLanguage((tag) => new Intl.DateTimeFormat(tag, { dateStyle: 'medium' }));
const day = (at: string) => dayFormat().format(new Date(at));

/** User management for admins: create accounts, roles, disable, reset password, remove. */
export default function Users() {
  const { auth } = useAuth();
  const { toast } = useVault();
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [busy, setBusy] = useState(false);
  const admin = !!auth && isAdmin(auth);
  const oidc = auth?.oidc?.enabled ? auth.oidc : null;

  const load = useCallback(async () => {
    try {
      setUsers(await api<ManagedUser[]>('/users'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('users.loadFailed'));
    }
  }, []);
  useEffect(() => {
    if (admin) void load();
  }, [admin, load]);

  async function run(action: () => Promise<unknown>, done?: string) {
    try {
      await action();
      if (done) toast(done);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : t('users.failed'));
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    await run(
      () =>
        api('/users', {
          method: 'POST',
          body: JSON.stringify({ name, role, ...(password ? { password } : {}) }),
        }),
      t('users.created', { name: name.trim() }),
    );
    setName('');
    setPassword('');
    setRole('user');
    setBusy(false);
  }
  const patch = (user: ManagedUser, body: object, done: string) =>
    run(() => api(`/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(body) }), done);
  function resetPassword(user: ManagedUser) {
    const next = window.prompt(t('users.passwordPrompt', { name: user.name }));
    if (!next) return;
    void run(
      () =>
        api(`/users/${user.id}/password`, {
          method: 'POST',
          body: JSON.stringify({ password: next }),
        }),
      t('users.passwordChanged', { name: user.name }),
    );
  }
  function signOut(user: ManagedUser) {
    if (!window.confirm(t('users.signOutConfirm', { name: user.name }))) return;
    void run(
      () => api(`/users/${user.id}/sessions`, { method: 'DELETE' }),
      t('users.signedOut', { name: user.name }),
    );
  }
  function remove(user: ManagedUser) {
    if (!window.confirm(t('users.deleteConfirm', { name: user.name }))) return;
    void run(
      () => api(`/users/${user.id}`, { method: 'DELETE' }),
      t('users.deleted', { name: user.name }),
    );
  }

  if (!admin)
    return (
      <div className="page users-page">
        <PageHeading
          eyebrow={t('users.eyebrow')}
          title={t('users.title')}
          description={t('users.adminOnly')}
        >
          <Link className="button secondary" to="/devices">
            {t('users.backToDevices')}
          </Link>
        </PageHeading>
      </div>
    );

  return (
    <div className="page users-page">
      <PageHeading
        eyebrow={t('users.eyebrow')}
        title={t('users.title')}
        description={t('users.description')}
        count={users?.length}
      >
        <Link className="button secondary" to="/devices">
          {t('users.devices')}
        </Link>
      </PageHeading>

      <section className="access-section">
        <div className="section-heading">
          <h2>{t('users.new')}</h2>
        </div>
        <form className="user-create" onSubmit={(e) => void create(e)}>
          <label className="field">
            {t('users.name')}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={60}
              autoComplete="off"
            />
          </label>
          <label className="field">
            {t('users.password')}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required={!oidc}
              autoComplete="new-password"
              placeholder={oidc ? t('users.passwordOidcPlaceholder', { provider: oidc.name }) : ''}
            />
          </label>
          <label className="field">
            {t('users.role')}
            <select value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')}>
              <option value="user">{t('users.roleUserOption')}</option>
              <option value="admin">{t('users.roleAdminOption')}</option>
            </select>
          </label>
          <button className="button primary" disabled={busy}>
            <UserPlus size={16} /> {t('users.create')}
          </button>
        </form>
        {oidc && <p className="users-hint">{t('users.oidcHint', { provider: oidc.name })}</p>}
      </section>

      <section className="access-section">
        <div className="section-heading">
          <h2>{t('users.accounts')}</h2>
        </div>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <div className="session-list">
          {users?.map((user) => (
            <div
              className={`session-row user-row${user.disabled ? ' is-disabled' : ''}`}
              key={user.id}
            >
              {user.role === 'admin' ? <ShieldCheck size={20} /> : <UserRound size={20} />}
              <div>
                <strong>
                  {user.name}
                  <span className="demo-label">
                    {user.role === 'admin' ? t('users.role.admin') : t('users.role.user')}
                  </span>
                  {user.self && <span className="demo-label">{t('users.you')}</span>}
                  {user.disabled && <span className="demo-label">{t('users.disabled')}</span>}
                  {user.oidcLinked && (
                    <span className="demo-label">
                      <KeyRound size={12} /> {oidc?.name ?? 'SSO'}
                    </span>
                  )}
                </strong>
                <p>
                  {[
                    t('users.since', { date: day(user.createdAt) }),
                    tp('users.browsers', user.sessions.browser),
                    tp('users.pcs', user.sessions.client),
                    ...(user.hasPassword ? [] : [t('users.noPassword')]),
                  ].join(' · ')}
                </p>
              </div>
              <div className="user-actions">
                <select
                  aria-label={t('users.roleOf', { name: user.name })}
                  value={user.role}
                  onChange={(e) =>
                    void patch(
                      user,
                      { role: e.target.value },
                      t(e.target.value === 'admin' ? 'users.nowAdmin' : 'users.nowUser', {
                        name: user.name,
                      }),
                    )
                  }
                >
                  <option value="user">{t('users.role.user')}</option>
                  <option value="admin">{t('users.role.admin')}</option>
                </select>
                {!user.self && (
                  <button
                    className="button secondary"
                    onClick={() =>
                      void patch(
                        user,
                        { disabled: !user.disabled },
                        user.disabled
                          ? t('users.enabled', { name: user.name })
                          : t('users.disabledDone', { name: user.name }),
                      )
                    }
                  >
                    {user.disabled ? t('users.enable') : t('users.disable')}
                  </button>
                )}
                <button
                  className="button secondary"
                  title={t('users.setPassword')}
                  onClick={() => resetPassword(user)}
                >
                  <KeyRound size={15} /> {t('users.passwordButton')}
                </button>
                {!user.self && (
                  <button
                    className="button secondary"
                    title={t('users.signOutEverywhere')}
                    aria-label={t('users.signOutLabel', { name: user.name })}
                    onClick={() => signOut(user)}
                  >
                    <LogOut size={15} />
                  </button>
                )}
                {!user.self && (
                  <button
                    className="button secondary danger"
                    title={t('users.deleteAccount')}
                    aria-label={t('users.deleteLabel', { name: user.name })}
                    onClick={() => remove(user)}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
          ))}
          {users === null && !error && <p className="users-hint">{t('users.loading')}</p>}
        </div>
      </section>
    </div>
  );
}
