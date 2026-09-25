import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Accounts, SESSION_DAYS, sameSecret, Throttle } from './auth';
import type { Session } from './auth';
import type { ServerConfig } from './config';

/**
 * Wer eine Anfrage stellt: ein angemeldeter Browser, ein gekoppelter Aufnahme-PC oder jemand mit
 * dem Zugangsschlüssel aus der Server-Einrichtung (ältere Clients, Skripte).
 */
export interface Identity {
  kind: 'browser' | 'client' | 'key';
  session?: Session;
}
declare module 'fastify' {
  interface FastifyRequest {
    identity?: Identity;
  }
}

/** Ohne Anmeldung erreichbar: Anmelden, Einrichten, Kopplung anfragen, QR-Code einlösen. */
const OPEN = new Set([
  '/api/auth/state',
  '/api/auth/setup',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/qr/redeem',
  '/api/pair/request',
  '/api/pair/status',
  '/api/session',
]);
const COOKIE = 'rh_session';
const nameSchema = z.string().trim().min(1).max(60);
const passwordSchema = z.string().min(8, 'Das Passwort braucht mindestens 8 Zeichen.').max(200);

/** Kurzer Name eines Browsers für die Geräteliste, aus seiner Kennung. */
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
            : 'Gerät';
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Firefox\//.test(agent)
      ? 'Firefox'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : 'Browser';
  return `${browser} auf ${system}`;
}

export function registerAuth(app: FastifyInstance, accounts: Accounts, config: ServerConfig) {
  const throttle = new Throttle();
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: config.publicOrigin.startsWith('https:'),
    path: '/api',
    maxAge: SESSION_DAYS * 86400,
  };
  const startSession = (req: FastifyRequest, reply: FastifyReply, userId: string) => {
    const { secret } = accounts.createSession(
      userId,
      'browser',
      browserLabel(req.headers['user-agent']),
    );
    reply.setCookie(COOKIE, secret, cookieOptions);
  };

  function identify(req: FastifyRequest, reply: FastifyReply): Identity | undefined {
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
    if (bearer) {
      if (config.token && sameSecret(bearer, config.token)) return { kind: 'key' };
      const found = accounts.session(bearer);
      if (found) return { kind: found.session.kind, session: found.session };
    }
    const cookie = req.cookies[COOKIE];
    if (cookie) {
      const found = accounts.session(cookie);
      if (found) {
        if (found.renewed) reply.setCookie(COOKIE, cookie, cookieOptions);
        return { kind: found.session.kind, session: found.session };
      }
    }
    // Sitzungen aus der Zeit vor den Konten (Anmeldung mit dem Zugangsschlüssel), bis sie ablaufen.
    const legacy = req.cookies.vault_session ? req.unsignCookie(req.cookies.vault_session) : null;
    if (legacy?.valid && legacy.value === 'vault') return { kind: 'key' };
    return undefined;
  }

  /** Für den onRequest-Haken in app.ts; true, wenn die Anfrage beantwortet wurde. */
  function guard(req: FastifyRequest, reply: FastifyReply) {
    req.identity = identify(req, reply);
    if (OPEN.has(req.url.split('?')[0])) return false;
    // Ohne Schlüssel und ohne Konto (nur auf dem eigenen Rechner erlaubt) bleibt alles offen.
    if (req.identity || (!config.token && !accounts.hasUsers())) return false;
    void reply.code(401).send({ error: 'Bitte melde dich an.' });
    return true;
  }
  /** Das Konto hinter der Anfrage; ein gekoppelter PC darf keine Konten- und Geräteverwaltung. */
  function owner(req: FastifyRequest, reply: FastifyReply) {
    const identity = req.identity;
    if (identity?.kind === 'browser' && identity.session) return identity.session.userId;
    if (identity?.kind === 'key' || (!config.token && !accounts.hasUsers())) {
      // Mit dem Schlüssel verwaltet man das erste Konto.
      const first = accounts.firstUser();
      if (first) return first.id;
    }
    void reply.code(403).send({ error: 'Das geht nur angemeldet im Browser.' });
    return undefined;
  }

  app.get('/api/auth/state', async (req) => {
    const identity = req.identity;
    const user = identity?.session ? accounts.user(identity.session.userId) : undefined;
    return {
      accounts: true,
      setupRequired: !accounts.hasUsers(),
      setupNeedsKey: !!config.token,
      loggedIn: !!identity || (!config.token && !accounts.hasUsers()),
      kind: identity?.kind ?? null,
      user: user ? { name: user.name } : null,
    };
  });

  app.post('/api/auth/setup', async (req, reply) => {
    const body = z
      .object({ name: nameSchema, password: passwordSchema, key: z.string().max(1000).default('') })
      .parse(req.body);
    if (accounts.hasUsers())
      return reply.code(409).send({ error: 'Es gibt schon ein Konto. Melde dich damit an.' });
    // Ein neuer Server ist oft schon aus dem Internet erreichbar: Das erste Konto legt nur an,
    // wer den Zugangsschlüssel aus der Einrichtung kennt.
    if (config.token && !sameSecret(body.key, config.token)) {
      throttle.fail();
      return reply
        .code(401)
        .send({ error: 'Der Zugangsschlüssel aus der Server-Einrichtung stimmt nicht.' });
    }
    const account = await accounts.createUser(body.name, body.password);
    startSession(req, reply, account.id);
    return { user: { name: account.name } };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = z
      .object({ name: z.string().max(60), password: z.string().max(200) })
      .parse(req.body);
    if (throttle.blocked())
      return reply.code(429).send({ error: 'Zu viele Fehlversuche. Warte ein paar Minuten.' });
    const account = await accounts.verify(body.name, body.password);
    if (!account) {
      throttle.fail();
      return reply.code(401).send({ error: 'Name oder Passwort stimmt nicht.' });
    }
    startSession(req, reply, account.id);
    return { user: { name: account.name } };
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
    const body = z.object({ current: z.string().max(200), next: passwordSchema }).parse(req.body);
    const account = accounts.user(userId);
    if (!account || !(await accounts.verify(account.name, body.current))) {
      throttle.fail();
      return reply.code(401).send({ error: 'Das bisherige Passwort stimmt nicht.' });
    }
    await accounts.changePassword(userId, body.next);
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
      return reply.code(404).send({ error: 'Gerät nicht gefunden.' });
    return { revoked: true };
  });

  // Ein weiteres Gerät per QR-Code anmelden: Der Code gilt fünf Minuten und nur einmal.
  app.post('/api/auth/qr', async (req, reply) => {
    const userId = owner(req, reply);
    if (!userId) return;
    const { code, expiresAt } = accounts.loginCode(userId);
    const origin = req.headers.origin || config.publicOrigin;
    return { url: `${origin}/connect?code=${code}`, expiresAt };
  });
  app.post('/api/auth/qr/redeem', async (req, reply) => {
    const { code } = z.object({ code: z.string().min(20).max(100) }).parse(req.body);
    if (throttle.blocked())
      return reply.code(429).send({ error: 'Zu viele Fehlversuche. Warte ein paar Minuten.' });
    const userId = accounts.redeemLoginCode(code);
    if (!userId) {
      throttle.fail();
      return reply.code(401).send({
        error: 'Der Code ist abgelaufen oder schon benutzt. Lass dir einen neuen zeigen.',
      });
    }
    startSession(req, reply, userId);
    return { user: { name: accounts.user(userId)?.name ?? '' } };
  });

  // Kopplung eines Aufnahme-PCs: Er fragt an, jemand mit Konto gibt frei, der PC holt den Zugang ab.
  app.post('/api/pair/request', async (req, reply) => {
    const body = z
      .object({ deviceId: z.string().uuid(), name: z.string().trim().min(1).max(100) })
      .parse(req.body);
    try {
      return accounts.requestPairing(body.name, body.deviceId);
    } catch (error) {
      return reply.code(429).send({ error: (error as Error).message });
    }
  });
  app.post('/api/pair/status', async (req) => {
    const body = z.object({ id: z.string().uuid(), secret: z.string().max(200) }).parse(req.body);
    return accounts.pairingStatus(body.id, body.secret);
  });
  app.get('/api/pair/pending', async (req, reply) => {
    if (!owner(req, reply)) return;
    return accounts.pendingPairings();
  });
  app.post<{ Params: { id: string } }>('/api/pair/:id/approve', async (req, reply) => {
    const userId = owner(req, reply);
    if (!userId) return;
    if (!accounts.approvePairing(z.string().uuid().parse(req.params.id), userId))
      return reply
        .code(404)
        .send({ error: 'Die Anfrage ist abgelaufen. Starte die Kopplung am PC neu.' });
    return { approved: true };
  });
  app.post<{ Params: { id: string } }>('/api/pair/:id/deny', async (req, reply) => {
    if (!owner(req, reply)) return;
    accounts.denyPairing(z.string().uuid().parse(req.params.id));
    return { denied: true };
  });

  return { guard };
}
