import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Accounts, sessions and the pairing of recording PCs. Like Immich, every device signs in with
 * its own account; a recording PC gets its access by requesting a pairing that an admin approves
 * in the web UI. The database only stores hashes of secrets, never the secrets themselves.
 */

export type Role = 'admin' | 'user';
export interface Account {
  id: string;
  name: string;
  /** Empty for accounts that only sign in through OIDC. */
  salt: string;
  hash: string;
  createdAt: string;
  role: Role;
  disabled?: boolean;
}
export interface Session {
  id: string;
  userId: string;
  /** browser: a signed-in browser; client: a paired recording PC. */
  kind: 'browser' | 'client';
  label: string;
  createdAt: string;
  lastSeen: string;
  /** Browser sessions expire, paired PCs only when their access is revoked. */
  expiresAt: string | null;
}
export interface Pairing {
  id: string;
  secretHash: string;
  /** Six digits that both the PC and the web UI show. */
  code: string;
  name: string;
  deviceId: string;
  status: 'pending' | 'approved' | 'denied' | 'delivered';
  createdAt: string;
  expiresAt: string;
  /** Only kept between approval and pickup by the PC, deleted afterwards. */
  token?: string;
}
export interface OidcIdentity {
  issuer: string;
  sub: string;
  userId: string;
  createdAt: string;
  lastLogin: string;
}

/** A rule of account management was violated; the message is meant for the user. */
export class AccountError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

/** Browser sessions: 30 days, each use (counted at most once a day) extends them. */
export const SESSION_DAYS = 30;
const PAIRING_MINUTES = 10;
const LOGIN_CODE_MINUTES = 5;
interface LoginCode {
  userId: string;
  expiresAt: string;
  usedAt?: string;
  /** The device that signed in with the code. */
  label?: string;
}
const DEVICE_PREFIX = 'rhd_';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
function scrypt(password: string, salt: string) {
  return new Promise<Buffer>((done, fail) =>
    scryptCallback(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) =>
      error ? fail(error) : done(key),
    ),
  );
}
export function sameSecret(a: string, b: string) {
  return timingSafeEqual(Buffer.from(sha(a), 'hex'), Buffer.from(sha(b), 'hex'));
}
async function passwordFields(password: string | null) {
  if (password === null) return { salt: '', hash: '' };
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: (await scrypt(password, salt)).toString('hex') };
}

export class Accounts {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(key TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pairings(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS login_codes(key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS oidc_identities(issuer TEXT NOT NULL, sub TEXT NOT NULL, user_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(issuer, sub));`);
    this.migrateRoles();
  }

  /**
   * Accounts from before roles existed have no `role`. Back then a server had exactly one
   * account that managed everything, so the first of them becomes admin and any others users.
   */
  private migrateRoles() {
    const rows = this.db.prepare('SELECT id, data FROM users ORDER BY rowid').all() as {
      id: string;
      data: string;
    }[];
    let hasAdmin = rows.some((r) => (JSON.parse(r.data) as Account).role === 'admin');
    for (const row of rows) {
      const account = JSON.parse(row.data) as Partial<Account>;
      if (account.role === 'admin' || account.role === 'user') continue;
      const role: Role = hasAdmin ? 'user' : 'admin';
      hasAdmin = true;
      this.save({ ...(account as Account), role });
    }
  }
  private save(account: Account) {
    this.db
      .prepare('UPDATE users SET name=?, data=? WHERE id=?')
      .run(account.name, JSON.stringify(account), account.id);
  }

  hasUsers() {
    return !!this.db.prepare('SELECT 1 FROM users LIMIT 1').get();
  }
  users(): Account[] {
    return (
      this.db.prepare('SELECT data FROM users ORDER BY rowid').all() as { data: string }[]
    ).map((r) => JSON.parse(r.data) as Account);
  }
  firstAdmin(): Account | undefined {
    const all = this.users();
    return all.find((u) => u.role === 'admin' && !u.disabled) ?? all[0];
  }
  user(id: string): Account | undefined {
    const row = this.db.prepare('SELECT data FROM users WHERE id=?').get(id) as
      { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  byName(name: string): Account | undefined {
    const row = this.db.prepare('SELECT data FROM users WHERE name=?').get(name.trim()) as
      { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  /** Admins that can still sign in. */
  activeAdmins() {
    return this.users().filter((u) => u.role === 'admin' && !u.disabled).length;
  }
  /**
   * Creates an account. Without a role the very first account becomes admin, every later one a
   * user. A `null` password makes an account that can only sign in through OIDC.
   */
  async createUser(name: string, password: string | null, role?: Role) {
    const trimmed = name.trim();
    if (this.byName(trimmed)) throw new AccountError('An account with this name already exists.');
    const account: Account = {
      id: randomUUID(),
      name: trimmed,
      ...(await passwordFields(password)),
      createdAt: new Date().toISOString(),
      role: role ?? (this.hasUsers() ? 'user' : 'admin'),
    };
    this.db
      .prepare('INSERT INTO users(id,name,data) VALUES(?,?,?)')
      .run(account.id, account.name, JSON.stringify(account));
    return account;
  }
  /** A free account name based on `wanted`: "name", "name-2", "name-3" … */
  freeName(wanted: string) {
    const base =
      wanted
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[^\p{L}\p{N} ._@-]/gu, '')
        .slice(0, 50) || 'user';
    if (!this.byName(base)) return base;
    for (let i = 2; ; i++) if (!this.byName(`${base}-${i}`)) return `${base}-${i}`;
  }
  /** The account for name and password, otherwise undefined; also hashes for unknown names. */
  async verify(name: string, password: string) {
    const account = this.byName(name);
    const usable = account && account.hash ? account : undefined;
    const key = await scrypt(password, usable?.salt ?? 'no-account');
    const expected = Buffer.from(usable?.hash ?? '0'.repeat(128), 'hex');
    return usable && timingSafeEqual(key, expected) ? usable : undefined;
  }
  async changePassword(userId: string, password: string) {
    const account = this.user(userId);
    if (!account) throw new AccountError('Account not found.', 404);
    this.save({ ...account, ...(await passwordFields(password)) });
  }

  /* User management (admins only, see auth-routes.ts) */

  private mustKeepAdmin(account: Account) {
    if (account.role === 'admin' && !account.disabled && this.activeAdmins() <= 1)
      throw new AccountError('The last admin cannot be removed, disabled or demoted.');
  }
  setRole(id: string, role: Role) {
    const account = this.user(id);
    if (!account) throw new AccountError('Account not found.', 404);
    if (account.role === role) return account;
    if (role === 'user') this.mustKeepAdmin(account);
    const next = { ...account, role };
    this.save(next);
    return next;
  }
  setDisabled(id: string, disabled: boolean) {
    const account = this.user(id);
    if (!account) throw new AccountError('Account not found.', 404);
    if (!!account.disabled === disabled) return account;
    if (disabled) this.mustKeepAdmin(account);
    const next: Account = { ...account, disabled };
    if (!disabled) delete next.disabled;
    this.save(next);
    // A disabled account is signed out everywhere, paired PCs included.
    if (disabled) this.revokeAll(id);
    return next;
  }
  deleteUser(id: string) {
    const account = this.user(id);
    if (!account) throw new AccountError('Account not found.', 404);
    this.mustKeepAdmin(account);
    this.revokeAll(id);
    this.db.prepare('DELETE FROM oidc_identities WHERE user_id=?').run(id);
    this.db.prepare('DELETE FROM users WHERE id=?').run(id);
  }

  /* OIDC identities, linked by issuer + subject */

  identityUser(issuer: string, sub: string): Account | undefined {
    const row = this.db
      .prepare('SELECT user_id FROM oidc_identities WHERE issuer=? AND sub=?')
      .get(issuer, sub) as { user_id: string } | undefined;
    return row ? this.user(row.user_id) : undefined;
  }
  identities(userId: string): OidcIdentity[] {
    return (
      this.db.prepare('SELECT data FROM oidc_identities WHERE user_id=?').all(userId) as {
        data: string;
      }[]
    ).map((r) => JSON.parse(r.data) as OidcIdentity);
  }
  linkIdentity(issuer: string, sub: string, userId: string, now = Date.now()) {
    const existing = this.identityUser(issuer, sub);
    if (existing && existing.id !== userId)
      throw new AccountError('This sign-in is already linked to another account.');
    const at = new Date(now).toISOString();
    const identity: OidcIdentity = { issuer, sub, userId, createdAt: at, lastLogin: at };
    const previous = this.identities(userId).find((i) => i.issuer === issuer && i.sub === sub);
    this.db
      .prepare(
        'INSERT INTO oidc_identities(issuer,sub,user_id,data) VALUES(?,?,?,?) ON CONFLICT(issuer,sub) DO UPDATE SET data=excluded.data',
      )
      .run(
        issuer,
        sub,
        userId,
        JSON.stringify(previous ? { ...previous, lastLogin: at } : identity),
      );
  }
  unlinkIdentities(userId: string) {
    this.db.prepare('DELETE FROM oidc_identities WHERE user_id=?').run(userId);
  }

  /** Creates a session; the returned secret is only ever seen here in plain text. */
  createSession(userId: string, kind: Session['kind'], label: string, now = Date.now()) {
    const secret = kind === 'client' ? `${DEVICE_PREFIX}${token()}` : token();
    const session: Session = {
      id: randomUUID(),
      userId,
      kind,
      label: label.slice(0, 100),
      createdAt: new Date(now).toISOString(),
      lastSeen: new Date(now).toISOString(),
      expiresAt: kind === 'client' ? null : new Date(now + SESSION_DAYS * 86400_000).toISOString(),
    };
    this.db
      .prepare('INSERT INTO sessions(key,id,data) VALUES(?,?,?)')
      .run(sha(secret), session.id, JSON.stringify(session));
    return { secret, session };
  }
  /**
   * The session for a secret. `renewed` reports that a browser session was extended and its
   * cookie should be set again.
   */
  session(secret: string, now = Date.now()): { session: Session; renewed: boolean } | undefined {
    if (!secret) return undefined;
    const key = sha(secret);
    const row = this.db.prepare('SELECT data FROM sessions WHERE key=?').get(key) as
      { data: string } | undefined;
    if (!row) return undefined;
    const session: Session = JSON.parse(row.data);
    if (session.expiresAt && Date.parse(session.expiresAt) <= now) {
      this.db.prepare('DELETE FROM sessions WHERE key=?').run(key);
      return undefined;
    }
    if (now - Date.parse(session.lastSeen) < 86400_000 / 24) return { session, renewed: false };
    const renewed = session.kind === 'browser' && now - Date.parse(session.lastSeen) >= 86400_000;
    const next: Session = {
      ...session,
      lastSeen: new Date(now).toISOString(),
      ...(renewed ? { expiresAt: new Date(now + SESSION_DAYS * 86400_000).toISOString() } : {}),
    };
    this.db.prepare('UPDATE sessions SET data=? WHERE key=?').run(JSON.stringify(next), key);
    return { session: next, renewed };
  }
  private allSessions(): Session[] {
    return (this.db.prepare('SELECT data FROM sessions').all() as { data: string }[]).map(
      (r) => JSON.parse(r.data) as Session,
    );
  }
  sessions(userId: string): Session[] {
    return this.allSessions()
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  }
  /** Number of sessions per account, for the user list. */
  sessionCounts() {
    const counts = new Map<string, { browser: number; client: number }>();
    for (const s of this.allSessions()) {
      const entry = counts.get(s.userId) ?? { browser: 0, client: 0 };
      entry[s.kind]++;
      counts.set(s.userId, entry);
    }
    return counts;
  }
  revoke(userId: string, id: string) {
    const row = this.db.prepare('SELECT data FROM sessions WHERE id=?').get(id) as
      { data: string } | undefined;
    if (!row || (JSON.parse(row.data) as Session).userId !== userId) return false;
    this.db.prepare('DELETE FROM sessions WHERE id=?').run(id);
    return true;
  }
  /** Signs an account out everywhere; `kind` limits it to browsers or paired PCs. */
  revokeAll(userId: string, kind?: Session['kind']) {
    let count = 0;
    for (const s of this.sessions(userId))
      if (!kind || s.kind === kind) {
        this.db.prepare('DELETE FROM sessions WHERE id=?').run(s.id);
        count++;
      }
    return count;
  }
  endSession(secret: string) {
    this.db.prepare('DELETE FROM sessions WHERE key=?').run(sha(secret));
  }

  /* Pairing a recording PC */

  private pairings(now: number): Pairing[] {
    const all = (this.db.prepare('SELECT data FROM pairings').all() as { data: string }[]).map(
      (r) => JSON.parse(r.data) as Pairing,
    );
    // Expired requests disappear, including approved ones the PC never picked up.
    const stale = all.filter((p) => Date.parse(p.expiresAt) <= now);
    for (const p of stale) this.db.prepare('DELETE FROM pairings WHERE id=?').run(p.id);
    return all.filter((p) => !stale.includes(p));
  }
  private savePairing(pairing: Pairing) {
    this.db
      .prepare(
        'INSERT INTO pairings(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(pairing.id, JSON.stringify(pairing));
  }
  /** A PC asks to be paired. At most five open requests at a time. */
  requestPairing(name: string, deviceId: string, now = Date.now()) {
    const open = this.pairings(now).filter((p) => p.status === 'pending');
    if (open.length >= 5)
      throw new Error('Too many open pairing requests. Try again in a few minutes.');
    // When the same PC asks again, its new request replaces the old one.
    for (const p of open.filter((p) => p.deviceId === deviceId))
      this.db.prepare('DELETE FROM pairings WHERE id=?').run(p.id);
    const secret = token();
    const pairing: Pairing = {
      id: randomUUID(),
      secretHash: sha(secret),
      code: String(randomInt(0, 1_000_000)).padStart(6, '0'),
      name: name.slice(0, 100),
      deviceId,
      status: 'pending',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + PAIRING_MINUTES * 60000).toISOString(),
    };
    this.savePairing(pairing);
    return { id: pairing.id, secret, code: pairing.code, expiresAt: pairing.expiresAt };
  }
  pendingPairings(now = Date.now()) {
    return this.pairings(now)
      .filter((p) => p.status === 'pending')
      .map(({ id, code, name, createdAt, expiresAt }) => ({
        id,
        code,
        name,
        createdAt,
        expiresAt,
      }));
  }
  /** Approves a request: the PC gets its own session that can be revoked. */
  approvePairing(id: string, userId: string, now = Date.now()) {
    const pairing = this.pairings(now).find((p) => p.id === id && p.status === 'pending');
    if (!pairing) return false;
    const { secret } = this.createSession(userId, 'client', pairing.name, now);
    this.savePairing({
      ...pairing,
      status: 'approved',
      token: secret,
      // The PC polls every few seconds; this is how long the pickup may take.
      expiresAt: new Date(now + PAIRING_MINUTES * 60000).toISOString(),
    });
    return true;
  }
  denyPairing(id: string, now = Date.now()) {
    const pairing = this.pairings(now).find((p) => p.id === id && p.status === 'pending');
    if (!pairing) return false;
    this.savePairing({ ...pairing, status: 'denied' });
    return true;
  }
  /** What the waiting PC learns about its request; the access token exactly once. */
  pairingStatus(id: string, secret: string, now = Date.now()) {
    const pairing = this.pairings(now).find((p) => p.id === id);
    if (!pairing || !sameSecret(sha(secret), pairing.secretHash))
      return { status: 'expired' as const };
    if (pairing.status === 'approved' && pairing.token) {
      this.savePairing({ ...pairing, status: 'delivered', token: undefined });
      return { status: 'approved' as const, token: pairing.token };
    }
    return { status: pairing.status === 'delivered' ? ('expired' as const) : pairing.status };
  }

  /* Signing in another device with a QR code */

  /** The id is the code's hash: the showing page can ask for its state, but not redeem it. */
  loginCode(userId: string, now = Date.now()) {
    const code = token();
    const id = sha(code);
    const expiresAt = new Date(now + LOGIN_CODE_MINUTES * 60000).toISOString();
    // Old codes are only kept long enough for the showing page to learn their outcome.
    const stale = now - (LOGIN_CODE_MINUTES + 10) * 60000;
    for (const row of this.db.prepare('SELECT key, data FROM login_codes').all() as {
      key: string;
      data: string;
    }[])
      if (Date.parse((JSON.parse(row.data) as LoginCode).expiresAt) < stale)
        this.db.prepare('DELETE FROM login_codes WHERE key=?').run(row.key);
    this.db
      .prepare('INSERT INTO login_codes(key,data) VALUES(?,?)')
      .run(id, JSON.stringify({ userId, expiresAt } satisfies LoginCode));
    return { code, id, expiresAt };
  }
  /** Redeems a QR code exactly once and notes which device used it. */
  redeemLoginCode(code: string, now = Date.now()) {
    const key = sha(code);
    const row = this.db.prepare('SELECT data FROM login_codes WHERE key=?').get(key) as
      { data: string } | undefined;
    if (!row) return undefined;
    const data = JSON.parse(row.data) as LoginCode;
    if (data.usedAt || Date.parse(data.expiresAt) <= now) return undefined;
    return {
      userId: data.userId,
      /** Called once the session exists, with the device's label. */
      used: (label: string) =>
        this.db
          .prepare('UPDATE login_codes SET data=? WHERE key=?')
          .run(JSON.stringify({ ...data, usedAt: new Date(now).toISOString(), label }), key),
    };
  }
  /** What became of a QR code, for the account that created it. */
  loginCodeState(userId: string, id: string, now = Date.now()) {
    const row = this.db.prepare('SELECT data FROM login_codes WHERE key=?').get(id) as
      { data: string } | undefined;
    const data = row && (JSON.parse(row.data) as LoginCode);
    if (!data || data.userId !== userId) return undefined;
    if (data.usedAt) return { status: 'used' as const, label: data.label };
    return {
      status: Date.parse(data.expiresAt) > now ? ('waiting' as const) : ('expired' as const),
    };
  }
}

/** Counts failed sign-ins; after too many, sign-in pauses for a while. */
export class Throttle {
  private readonly failures: number[] = [];
  constructor(
    private readonly limit = 20,
    private readonly windowMs = 15 * 60000,
  ) {}
  blocked(now = Date.now()) {
    while (this.failures.length && this.failures[0] <= now - this.windowMs) this.failures.shift();
    return this.failures.length >= this.limit;
  }
  fail(now = Date.now()) {
    this.failures.push(now);
  }
}
