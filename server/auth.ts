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
 * Konten, Sitzungen und die Kopplung von Aufnahme-PCs. Wie bei Immich meldet sich jedes Gerät
 * mit dem eigenen Konto an; ein Aufnahme-PC bekommt seinen Zugang, indem er um Kopplung bittet
 * und jemand mit Konto sie in der Web-Oberfläche freigibt. In der Datenbank liegen nur Hashes
 * der Zugänge, nie die Zugänge selbst.
 */

export interface Account {
  id: string;
  name: string;
  salt: string;
  hash: string;
  createdAt: string;
}
export interface Session {
  id: string;
  userId: string;
  /** browser: Anmeldung im Browser; client: gekoppelter Aufnahme-PC. */
  kind: 'browser' | 'client';
  label: string;
  createdAt: string;
  lastSeen: string;
  /** Browser-Sitzungen laufen ab, gekoppelte PCs erst, wenn man sie entzieht. */
  expiresAt: string | null;
}
export interface Pairing {
  id: string;
  secretHash: string;
  /** Sechs Ziffern, die PC und Web-Oberfläche gleichermaßen zeigen. */
  code: string;
  name: string;
  deviceId: string;
  status: 'pending' | 'approved' | 'denied' | 'delivered';
  createdAt: string;
  expiresAt: string;
  /** Nur zwischen Freigabe und Abholung durch den PC, danach gelöscht. */
  token?: string;
}

/** Browser-Sitzungen: 30 Tage, jede Nutzung (höchstens einmal am Tag gezählt) verlängert sie. */
export const SESSION_DAYS = 30;
const PAIRING_MINUTES = 10;
const LOGIN_CODE_MINUTES = 5;
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

export class Accounts {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(key TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pairings(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS login_codes(key TEXT PRIMARY KEY, data TEXT NOT NULL);`);
  }

  hasUsers() {
    return !!this.db.prepare('SELECT 1 FROM users LIMIT 1').get();
  }
  firstUser(): Account | undefined {
    const row = this.db.prepare('SELECT data FROM users ORDER BY rowid LIMIT 1').get() as
      { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  user(id: string): Account | undefined {
    const row = this.db.prepare('SELECT data FROM users WHERE id=?').get(id) as
      { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  async createUser(name: string, password: string) {
    const salt = randomBytes(16).toString('hex');
    const account: Account = {
      id: randomUUID(),
      name: name.trim(),
      salt,
      hash: (await scrypt(password, salt)).toString('hex'),
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare('INSERT INTO users(id,name,data) VALUES(?,?,?)')
      .run(account.id, account.name, JSON.stringify(account));
    return account;
  }
  /** Das Konto zu Name und Passwort, sonst undefined; rechnet auch für unbekannte Namen. */
  async verify(name: string, password: string) {
    const row = this.db.prepare('SELECT data FROM users WHERE name=?').get(name.trim()) as
      { data: string } | undefined;
    const account: Account | undefined = row ? JSON.parse(row.data) : undefined;
    const key = await scrypt(password, account?.salt ?? 'kein-konto');
    const expected = Buffer.from(account?.hash ?? '0'.repeat(128), 'hex');
    return account && timingSafeEqual(key, expected) ? account : undefined;
  }
  async changePassword(userId: string, password: string) {
    const account = this.user(userId);
    if (!account) throw new Error('Konto nicht gefunden.');
    const salt = randomBytes(16).toString('hex');
    const next = { ...account, salt, hash: (await scrypt(password, salt)).toString('hex') };
    this.db.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify(next), userId);
  }

  /** Legt eine Sitzung an; der zurückgegebene Zugang wird nur hier einmal im Klartext gesehen. */
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
   * Die Sitzung zu einem Zugang. `renewed` meldet, dass eine Browser-Sitzung verlängert wurde
   * und ihr Cookie neu gesetzt werden sollte.
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
  sessions(userId: string): Session[] {
    return (this.db.prepare('SELECT data FROM sessions').all() as { data: string }[])
      .map((r) => JSON.parse(r.data) as Session)
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  }
  revoke(userId: string, id: string) {
    const row = this.db.prepare('SELECT data FROM sessions WHERE id=?').get(id) as
      { data: string } | undefined;
    if (!row || (JSON.parse(row.data) as Session).userId !== userId) return false;
    this.db.prepare('DELETE FROM sessions WHERE id=?').run(id);
    return true;
  }
  endSession(secret: string) {
    this.db.prepare('DELETE FROM sessions WHERE key=?').run(sha(secret));
  }

  /* Kopplung eines Aufnahme-PCs */

  private pairings(now: number): Pairing[] {
    const all = (this.db.prepare('SELECT data FROM pairings').all() as { data: string }[]).map(
      (r) => JSON.parse(r.data) as Pairing,
    );
    // Abgelaufene Anfragen verschwinden, auch freigegebene, die der PC nie abgeholt hat.
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
  /** Ein PC bittet um Kopplung. Höchstens fünf offene Anfragen gleichzeitig. */
  requestPairing(name: string, deviceId: string, now = Date.now()) {
    const open = this.pairings(now).filter((p) => p.status === 'pending');
    if (open.length >= 5)
      throw new Error('Zu viele offene Kopplungsanfragen. Versuch es in ein paar Minuten erneut.');
    // Fragt derselbe PC erneut, ersetzt die neue Anfrage seine alte.
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
  /** Gibt eine Anfrage frei: Der PC bekommt eine eigene, entziehbare Sitzung. */
  approvePairing(id: string, userId: string, now = Date.now()) {
    const pairing = this.pairings(now).find((p) => p.id === id && p.status === 'pending');
    if (!pairing) return false;
    const { secret } = this.createSession(userId, 'client', pairing.name, now);
    this.savePairing({
      ...pairing,
      status: 'approved',
      token: secret,
      // Der PC fragt alle paar Sekunden; so lange darf die Abholung dauern.
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
  /** Was der wartende PC über seine Anfrage erfährt; den Zugang genau einmal. */
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

  /* Anmeldung per QR-Code auf einem weiteren Gerät */

  loginCode(userId: string, now = Date.now()) {
    const code = token();
    const expiresAt = new Date(now + LOGIN_CODE_MINUTES * 60000).toISOString();
    this.db
      .prepare('INSERT INTO login_codes(key,data) VALUES(?,?)')
      .run(sha(code), JSON.stringify({ userId, expiresAt }));
    return { code, expiresAt };
  }
  /** Löst einen QR-Code genau einmal ein. */
  redeemLoginCode(code: string, now = Date.now()) {
    const key = sha(code);
    const row = this.db.prepare('SELECT data FROM login_codes WHERE key=?').get(key) as
      { data: string } | undefined;
    this.db.prepare('DELETE FROM login_codes WHERE key=?').run(key);
    if (!row) return undefined;
    const { userId, expiresAt } = JSON.parse(row.data) as { userId: string; expiresAt: string };
    return Date.parse(expiresAt) > now ? userId : undefined;
  }
}

/** Zählt fehlgeschlagene Anmeldungen; nach zu vielen ist für eine Weile Schluss. */
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
