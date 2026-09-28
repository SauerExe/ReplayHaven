import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AccountError, Accounts, SESSION_DAYS, sameSecret, Throttle } from './auth';
import type { Account, Role, Session } from './auth';
import type { ServerConfig } from './config';
import { FLOW_MINUTES, FlowSealer, OidcClient, OidcError } from './oidc';

/**
 * Who sent a request: a signed-in browser, a paired recording PC, or, while the server has no
 * account yet, someone holding the access key from the setup. The access key then acts as admin.
 */
export interface Identity {
  kind: 'browser' | 'client' | 'key';
  session?: Session;
  /** Role of the account behind a browser session; the access key counts as admin. */
  role?: Role;
}
declare module 'fastify' {
  interface FastifyRequest {
    identity?: Identity;
  }
}

/** Reachable without signing in: sign in, set up, request pairing, redeem a QR code, OIDC. */
const OPEN = new Set([
  '/api/auth/state',
  '/api/auth/setup',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/qr/redeem',
  '/api/auth/oidc/start',
  '/api/auth/oidc/callback',
  '/api/pair/request',
  '/api/pair/status',
  '/api/pair/redeem',
]);
/** Changing requests every signed-in account may send: its own account and sessions. */
const SELF_SERVICE = new Set([
  'POST /api/auth/setup',
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'POST /api/auth/password',
  'POST /api/auth/qr',
  'POST /api/auth/qr/redeem',
  'POST /api/auth/oidc/unlink',
  'DELETE /api/auth/sessions/:id',
  'POST /api/pair/request',
  'POST /api/pair/status',
  'POST /api/pair/redeem',
]);
/** What a paired recording PC may change besides reading: upload, its result, its heartbeat. */
const CLIENT_ROUTES = new Set([
  'POST /api/clips',
  'POST /api/clips/:id/client-analysis',
  'POST /api/devices/heartbeat',
]);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const COOKIE = 'rh_session';
const FLOW_COOKIE = 'rh_oidc';
const FLOW_PATH = '/api/auth/oidc';
const nameSchema = z.string().trim().min(1).max(60);
const passwordSchema = z.string().min(8, 'The password needs at least 8 characters.').max(200);
const roleSchema = z.enum(['admin', 'user']);

/** Short name of a browser for the device list, from its user agent. */
export function browserLabel(agent = '') {
  const system = /iPhone|iPad/.test(agent)
    ? 'iPhone/iPad'
    : /Android/.test(agent)
      ? 'Android'
      : /Windows/.test(agent)
        ? 'Windows'
        : /Mac OS X/.test(agent)
          ? 'Mac'
          : /Linux/.test(agent)
            ? 'Linux'
            : 'device';
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Firefox\//.test(agent)
      ? 'Firefox'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : 'Browser';
  return `${browser} on ${system}`;
}

const publicUser = (account: Account) => ({
  id: account.id,
  name: account.name,
  role: account.role,
});

export function registerAuth(app: FastifyInstance, accounts: Accounts, config: ServerConfig) {
  const throttle = new Throttle();
  const secure = config.publicOrigin.startsWith('https:');
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure,
    path: '/api',
    maxAge: SESSION_DAYS * 86400,
  };
  const passwordLogin = config.passwordLogin !== false || !config.oidc;
  const oidc = config.oidc
    ? new OidcClient(config.oidc, `${config.publicOrigin}/api/auth/oidc/callback`)
    : undefined;
  const sealer = new FlowSealer();

  const startSession = (req: FastifyRequest, reply: FastifyReply, userId: string) => {
    const { secret } = accounts.createSession(
      userId,
      'browser',
      browserLabel(req.headers['user-agent']),
    );
    reply.setCookie(COOKIE, secret, cookieOptions);
  };
  /**
   * Nobody has set up the server and it is only reachable on this machine. The Host header counts
   * too: a dev proxy (vite --host) forwards LAN requests from 127.0.0.1, but keeps their Host.
   */
  const openLocal = (req?: FastifyRequest) =>
    !config.token &&
    !accounts.hasUsers() &&
    (!req || /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host ?? ''));

  /** A session only counts while its account exists and is enabled. */
  function fromSession(session: Session): Identity | undefined {
    const account = accounts.user(session.userId);
    if (!account || account.disabled) return undefined;
    return { kind: session.kind, session, role: account.role };
  }
  function identify(req: FastifyRequest, reply: FastifyReply): Identity | undefined {
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
    if (bearer) {
      // The access key only sets the server up: once an account exists, it opens nothing.
      if (config.token && !accounts.hasUsers() && sameSecret(bearer, config.token))
        return { kind: 'key', role: 'admin' };
      const found = accounts.session(bearer);
      if (found) return fromSession(found.session);
    }
    const cookie = req.cookies[COOKIE];
    if (cookie) {
      const found = accounts.session(cookie);
      if (found) {
        const identity = fromSession(found.session);
        if (identity && found.renewed) reply.setCookie(COOKIE, cookie, cookieOptions);
        if (identity) return identity;
      }
    }
    return undefined;
  }
  const isAdmin = (identity: Identity | undefined) =>
    identity?.kind === 'key' || (identity?.kind === 'browser' && identity.role === 'admin');

  /**
   * For the onRequest hook in app.ts; true when the request has been answered. Answers 401
   * without a sign-in and 403 when the role does not allow a change: reading is open to every
   * account, changing the archive or the server needs an admin, and a paired PC may upload.
   */
  function guard(req: FastifyRequest, reply: FastifyReply) {
    req.identity = identify(req, reply);
    const path = req.url.split('?')[0];
    if (OPEN.has(path)) return false;
    if (openLocal(req)) return false;
    if (!req.identity) {
      void reply.code(401).send({ error: 'Please sign in.' });
      return true;
    }
    if (SAFE_METHODS.has(req.method) || isAdmin(req.identity)) return false;
    const route = `${req.method} ${req.routeOptions.url ?? path}`;
    if (SELF_SERVICE.has(route)) return false;
    // A paired PC acts for the admin who paired it; demoted, that account's PCs stop uploading.
    if (req.identity.kind === 'client' && req.identity.role === 'admin' && CLIENT_ROUTES.has(route))
      return false;
    void reply.code(403).send({ error: 'This action requires an admin account.' });
    return true;
  }
  /** The account behind a request; a paired PC may not manage accounts or devices. */
  function owner(req: FastifyRequest, reply: FastifyReply) {
    const identity = req.identity;
    if (identity?.kind === 'browser' && identity.session) return identity.session.userId;
    if (identity?.kind === 'key' || openLocal(req)) {
      // The access key manages the first admin account.
      const first = accounts.firstAdmin();
      if (first) return first.id;
    }
    void reply.code(403).send({ error: 'This only works when signed in with a browser.' });
    return undefined;
  }
  /** For routes that read admin data: true when the request has been answered with 403. */
  function adminOnly(req: FastifyRequest, reply: FastifyReply) {
    if (isAdmin(req.identity) || openLocal(req)) return false;
    void reply.code(403).send({ error: 'This action requires an admin account.' });
    return true;
  }
  /** Answers account rule violations with their own status and message. */
  function accountFailure(reply: FastifyReply, error: unknown) {
    if (error instanceof AccountError)
      return reply.code(error.status).send({ error: error.message });
    throw error;
  }

  app.get('/api/auth/state', async (req) => {
    const identity = req.identity;
    const user = identity?.session ? accounts.user(identity.session.userId) : undefined;
    const loggedIn = !!identity || openLocal(req);
    return {
      accounts: true,
      setupRequired: !accounts.hasUsers(),
      setupNeedsKey: !!config.token,
      loggedIn,
      kind: identity?.kind ?? null,
      role: loggedIn ? (isAdmin(identity) || openLocal(req) ? 'admin' : 'user') : null,
      user: user
        ? {
            ...publicUser(user),
            hasPassword: !!user.hash,
            oidcLinked: accounts.identities(user.id).length > 0,
          }
        : null,
      passwordLogin,
      oidc: config.oidc ? { enabled: true, name: config.oidc.name } : null,
    };
  });

  app.post('/api/auth/setup', async (req, reply) => {
    const body = z
      .object({ name: nameSchema, password: passwordSchema, key: z.string().max(1000).default('') })
      .parse(req.body);
    // With password sign-in off, the setup link still creates the first admin, who then links
    // their single sign-on under Settings → Account.
    if (accounts.hasUsers())
      return reply.code(409).send({ error: 'An account already exists. Sign in with it.' });
    if (throttle.blocked(req.ip))
      return reply.code(429).send({ error: 'Too many failed attempts. Wait a few minutes.' });
    // A new server is often already reachable from the internet: only someone who knows the
    // access key from the setup may create the first account.
    if (config.token && !sameSecret(body.key, config.token)) {
      throttle.fail(req.ip);
      return reply.code(401).send({ error: 'The access key from the server setup is wrong.' });
    }
    const account = await accounts.createUser(body.name, body.password, 'admin');
    startSession(req, reply, account.id);
    return { user: publicUser(account) };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = z
      .object({ name: z.string().max(60), password: z.string().max(200) })
      .parse(req.body);
    if (!passwordLogin)
      return reply
        .code(403)
        .send({ error: `Password sign-in is disabled. Sign in with ${config.oidc?.name}.` });
    if (throttle.blocked(req.ip))
      return reply.code(429).send({ error: 'Too many failed attempts. Wait a few minutes.' });
    const account = await accounts.verify(body.name, body.password);
    if (!account) {
      throttle.fail(req.ip);
      return reply.code(401).send({ error: 'Name or password is wrong.' });
    }
    if (account.disabled) return reply.code(403).send({ error: 'This account is disabled.' });
    startSession(req, reply, account.id);
    return { user: publicUser(account) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const cookie = req.cookies[COOKIE];
    if (cookie) accounts.endSession(cookie);
    reply.clearCookie(COOKIE, { path: '/api' });
    return { loggedOut: true };
  });

  app.post('/api/auth/password', async (req, reply) => {
    const userId = owner(req, reply);
    if (!userId) return;
    const body = z
      .object({ current: z.string().max(200).default(''), next: passwordSchema })
      .parse(req.body);
    const account = accounts.user(userId);
    if (!account) return reply.code(404).send({ error: 'Account not found.' });
    if (throttle.blocked(req.ip))
      return reply.code(429).send({ error: 'Too many failed attempts. Wait a few minutes.' });
    // An account that only signed in through OIDC so far sets its first password without one.
    if (account.hash && !(await accounts.verify(account.name, body.current))) {
      throttle.fail(req.ip);
      return reply.code(401).send({ error: 'The current password is wrong.' });
    }
    await accounts.changePassword(userId, body.next);
    // A new password signs out the account's other browsers, as when an admin resets it.
    const current = req.identity?.session?.id;
    for (const s of accounts.sessions(userId))
      if (s.kind === 'browser' && s.id !== current) accounts.revoke(userId, s.id);
    return { changed: true };
  });

  app.get('/api/auth/sessions', async (req, reply) => {
    const userId = owner(req, reply);
    if (!userId) return;
    return accounts.sessions(userId).map((s) => ({
      id: s.id,
      kind: s.kind,
      label: s.label,
      createdAt: s.createdAt,
      lastSeen: s.lastSeen,
      current: s.id === req.identity?.session?.id,
    }));
  });
  app.delete<{ Params: { id: string } }>('/api/auth/sessions/:id', async (req, reply) => {
    const userId = owner(req, reply);
    if (!userId) return;
    if (!accounts.revoke(userId, z.string().uuid().parse(req.params.id)))
      return reply.code(404).send({ error: 'Device not found.' });
    return { revoked: true };
  });

  // Sign in another device with a QR code: the code is valid for five minutes and only once.
  app.post('/api/auth/qr', async (req, reply) => {
    const userId = owner(req, reply);
    if (!userId) return;
    const { code, id, expiresAt } = accounts.loginCode(userId);
    // The origin header was checked against the allowed origins in app.ts.
    const origin = req.headers.origin || config.publicOrigin;
    return { url: `${origin}/connect?code=${code}`, id, expiresAt };
  });
  // The page showing the code asks whether a device has used it yet.
  app.get<{ Params: { id: string } }>('/api/auth/qr/:id', async (req, reply) => {
    const userId = owner(req, reply);
    if (!userId) return;
    const id = z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .parse(req.params.id);
    const state = accounts.loginCodeState(userId, id);
    if (!state) return reply.code(404).send({ error: 'Code not found.' });
    return state;
  });
  app.post('/api/auth/qr/redeem', async (req, reply) => {
    const { code } = z.object({ code: z.string().min(20).max(100) }).parse(req.body);
    if (throttle.blocked(req.ip))
      return reply.code(429).send({ error: 'Too many failed attempts. Wait a few minutes.' });
    const redeemed = accounts.redeemLoginCode(code);
    const account = redeemed ? accounts.user(redeemed.userId) : undefined;
    if (!redeemed || !account || account.disabled) {
      throttle.fail(req.ip);
      return reply.code(401).send({
        error: 'The code has expired or was already used. Show a new one.',
      });
    }
    startSession(req, reply, account.id);
    redeemed.used(browserLabel(req.headers['user-agent']));
    return { user: publicUser(account) };
  });

  /* Sign-in through OpenID Connect */

  const flowCookie = {
    httpOnly: true,
    // The callback arrives as a cross-site navigation from the provider; Strict would drop it.
    sameSite: 'lax' as const,
    secure,
    path: FLOW_PATH,
    maxAge: FLOW_MINUTES * 60,
  };
  const failed = (reply: FastifyReply, message: string) =>
    reply.redirect(`/?login_error=${encodeURIComponent(message.slice(0, 300))}`, 302);

  app.get<{ Querystring: { link?: string } }>('/api/auth/oidc/start', async (req, reply) => {
    if (!oidc) return failed(reply, 'Single sign-on is not configured on this server.');
    // "link=1" from a signed-in browser adds this sign-in to the current account.
    const link =
      req.query.link && req.identity?.kind === 'browser' ? req.identity.session?.userId : undefined;
    try {
      const { url, flow } = await oidc.start(link);
      reply.setCookie(FLOW_COOKIE, sealer.seal(flow), flowCookie);
      return reply.redirect(url, 302);
    } catch (error) {
      return failed(
        reply,
        error instanceof OidcError ? error.message : 'Single sign-on could not be started.',
      );
    }
  });

  app.get('/api/auth/oidc/callback', async (req, reply) => {
    if (!oidc || !config.oidc) return failed(reply, 'Single sign-on is not configured.');
    const flow = sealer.open(req.cookies[FLOW_COOKIE]);
    reply.clearCookie(FLOW_COOKIE, { path: FLOW_PATH });
    const search = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const query = new URLSearchParams(search);
    if (query.get('error'))
      return failed(
        reply,
        `Sign-in was cancelled: ${query.get('error_description') || query.get('error')}`,
      );
    if (!flow) return failed(reply, 'The sign-in took too long or was started elsewhere. Retry.');
    if (throttle.blocked(req.ip))
      return failed(reply, 'Too many failed attempts. Wait a few minutes.');
    let profile;
    try {
      profile = await oidc.finish(search, flow);
    } catch (error) {
      throttle.fail(req.ip);
      return failed(
        reply,
        error instanceof OidcError ? error.message : 'The sign-in could not be completed.',
      );
    }
    const inAdminGroup =
      !!config.oidc.adminGroup && profile.groups.includes(config.oidc.adminGroup);
    try {
      // A signed-in account links this sign-in to itself.
      if (flow.link) {
        const account = accounts.user(flow.link);
        if (!account || account.disabled) return failed(reply, 'Your account is not available.');
        accounts.linkIdentity(profile.issuer, profile.sub, account.id);
        return reply.redirect('/settings/account?linked=1', 302);
      }
      let account = accounts.identityUser(profile.issuer, profile.sub);
      if (!account) {
        // An admin may prepare an account without password under the same name; it is claimed
        // by the first OIDC sign-in with exactly that name, as long as nothing else is linked.
        const prepared = accounts.byName(profile.username);
        if (
          prepared &&
          prepared.name === profile.username &&
          !prepared.hash &&
          accounts.identities(prepared.id).length === 0
        )
          account = prepared;
        // On a server without accounts, only a member of the admin group becomes the first admin
        // right away: with open registration at the provider, anyone could otherwise claim it.
        else if (!accounts.hasUsers() && !inAdminGroup)
          return failed(
            reply,
            'This server has no admin yet. Create the first account with the setup link from the server log, then link this sign-in under Settings → Account.',
          );
        else if (config.oidc.autoCreate || !accounts.hasUsers())
          account = await accounts.createUser(
            accounts.freeName(profile.username),
            null,
            !accounts.hasUsers() || inAdminGroup ? 'admin' : 'user',
          );
        else
          return failed(
            reply,
            'No ReplayHaven account belongs to this sign-in. Ask an admin to create one for you.',
          );
      }
      if (account.disabled) return failed(reply, 'This account is disabled.');
      accounts.linkIdentity(profile.issuer, profile.sub, account.id);
      // Group membership promotes; it never demotes, an admin changes that by hand.
      if (inAdminGroup && account.role !== 'admin') accounts.setRole(account.id, 'admin');
      startSession(req, reply, account.id);
      return reply.redirect('/', 302);
    } catch (error) {
      if (error instanceof AccountError) return failed(reply, error.message);
      throw error;
    }
  });

  app.post('/api/auth/oidc/unlink', async (req, reply) => {
    const userId = owner(req, reply);
    if (!userId) return;
    const account = accounts.user(userId);
    if (account && !account.hash)
      return reply
        .code(409)
        .send({ error: 'Set a password first, otherwise you could no longer sign in.' });
    accounts.unlinkIdentities(userId);
    return { unlinked: true };
  });

  /* User management, admins only */

  const userIdSchema = z.string().uuid();
  const self = (req: FastifyRequest) =>
    req.identity?.kind === 'browser' ? req.identity.session?.userId : undefined;

  app.get('/api/users', async (req, reply) => {
    if (adminOnly(req, reply)) return;
    const counts = accounts.sessionCounts();
    return accounts.users().map((u) => ({
      ...publicUser(u),
      disabled: !!u.disabled,
      createdAt: u.createdAt,
      hasPassword: !!u.hash,
      oidcLinked: accounts.identities(u.id).length > 0,
      sessions: counts.get(u.id) ?? { browser: 0, client: 0 },
      self: u.id === self(req),
    }));
  });
  app.post('/api/users', async (req, reply) => {
    if (adminOnly(req, reply)) return;
    const body = z
      .object({
        name: nameSchema,
        // Without a password the account waits for its first OIDC sign-in with the same name.
        password: passwordSchema.optional(),
        role: roleSchema.default('user'),
      })
      .parse(req.body);
    if (!body.password && !config.oidc)
      return reply.code(400).send({ error: 'Set a password for the new account.' });
    try {
      const account = await accounts.createUser(body.name, body.password ?? null, body.role);
      return reply.code(201).send(publicUser(account));
    } catch (error) {
      return accountFailure(reply, error);
    }
  });
  app.patch<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    if (adminOnly(req, reply)) return;
    const id = userIdSchema.parse(req.params.id);
    const body = z
      .object({ role: roleSchema.optional(), disabled: z.boolean().optional() })
      .parse(req.body);
    if (body.disabled && id === self(req))
      return reply.code(409).send({ error: 'You cannot disable your own account.' });
    try {
      if (body.role) accounts.setRole(id, body.role);
      if (body.disabled !== undefined) accounts.setDisabled(id, body.disabled);
    } catch (error) {
      return accountFailure(reply, error);
    }
    const account = accounts.user(id)!;
    return { ...publicUser(account), disabled: !!account.disabled };
  });
  app.post<{ Params: { id: string } }>('/api/users/:id/password', async (req, reply) => {
    if (adminOnly(req, reply)) return;
    const id = userIdSchema.parse(req.params.id);
    const { password } = z.object({ password: passwordSchema }).parse(req.body);
    try {
      await accounts.changePassword(id, password);
    } catch (error) {
      return accountFailure(reply, error);
    }
    // Whoever knew the old password is signed out; paired PCs keep working.
    if (id !== self(req)) accounts.revokeAll(id, 'browser');
    return { changed: true };
  });
  app.delete<{ Params: { id: string } }>('/api/users/:id/sessions', async (req, reply) => {
    if (adminOnly(req, reply)) return;
    const id = userIdSchema.parse(req.params.id);
    if (!accounts.user(id)) return reply.code(404).send({ error: 'Account not found.' });
    const current = req.identity?.session?.id;
    let revoked = 0;
    for (const s of accounts.sessions(id))
      if (s.id !== current && accounts.revoke(id, s.id)) revoked++;
    return { revoked };
  });
  app.delete<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    if (adminOnly(req, reply)) return;
    const id = userIdSchema.parse(req.params.id);
    if (id === self(req))
      return reply.code(409).send({ error: 'You cannot delete your own account.' });
    try {
      accounts.deleteUser(id);
    } catch (error) {
      return accountFailure(reply, error);
    }
    return { deleted: true };
  });

  // Pairing a recording PC: it asks, an admin approves, the PC picks up its access.
  app.post('/api/pair/request', async (req, reply) => {
    const body = z
      .object({ deviceId: z.string().uuid(), name: z.string().trim().min(1).max(100) })
      .parse(req.body);
    try {
      return accounts.requestPairing(body.name, body.deviceId, Date.now(), req.ip);
    } catch (error) {
      return reply.code(429).send({ error: (error as Error).message });
    }
  });
  app.post('/api/pair/status', async (req) => {
    const body = z.object({ id: z.string().uuid(), secret: z.string().max(200) }).parse(req.body);
    return accounts.pairingStatus(body.id, body.secret);
  });
  // Pairing by link (Accounts.pairingTicket): the admin's click replaces the code comparison.
  app.post('/api/pair/ticket', async (req, reply) => {
    const userId = owner(req, reply);
    if (!userId || adminOnly(req, reply)) return;
    return accounts.pairingTicket(userId);
  });
  app.post('/api/pair/redeem', async (req, reply) => {
    const body = z
      .object({ ticket: z.string().max(200), name: z.string().trim().min(1).max(100) })
      .parse(req.body);
    const token = accounts.redeemTicket(body.ticket, body.name);
    if (!token)
      return reply
        .code(410)
        .send({ error: 'The link has expired or was already used. Create a new one.' });
    return { token };
  });
  app.get('/api/pair/pending', async (req, reply) => {
    if (!owner(req, reply) || adminOnly(req, reply)) return;
    return accounts.pendingPairings();
  });
  app.post<{ Params: { id: string } }>('/api/pair/:id/approve', async (req, reply) => {
    const userId = owner(req, reply);
    if (!userId || adminOnly(req, reply)) return;
    if (!accounts.approvePairing(z.string().uuid().parse(req.params.id), userId))
      return reply
        .code(404)
        .send({ error: 'The request has expired. Start the pairing on the PC again.' });
    return { approved: true };
  });
  app.post<{ Params: { id: string } }>('/api/pair/:id/deny', async (req, reply) => {
    if (!owner(req, reply) || adminOnly(req, reply)) return;
    accounts.denyPairing(z.string().uuid().parse(req.params.id));
    return { denied: true };
  });

  /** Whether a request may see admin details such as the folders of recording PCs. */
  const admin = (req: FastifyRequest) => isAdmin(req.identity) || openLocal(req);
  return { guard, admin };
}
