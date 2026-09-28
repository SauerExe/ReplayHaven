/**
 * Helpers for the server tests: a server in a temporary directory and a tiny OpenID Connect
 * provider on the loopback interface, so no test ever reaches the network.
 */
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { buildServer } from './app';
import type { ServerConfig } from './config';

export const TEST_KEY = 'auth-test-token-with-at-least-32-chars';

const roots: string[] = [];
export async function startServer(overrides: Partial<ServerConfig> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-auth-'));
  roots.push(root);
  const config: ServerConfig = {
    host: '0.0.0.0',
    port: 8787,
    gameMetadata: false,
    dataDir: join(root, 'archive'),
    token: TEST_KEY,
    publicOrigin: 'https://replay.example.org',
    provider: 'none',
    model: '',
    geminiKey: '',
    localUrl: '',
    localKey: '',
    releaseDir: join(root, 'release'),
    ...overrides,
  };
  return { ...(await buildServer(config)), config, root };
}
export async function removeRoots() {
  for (const root of roots.splice(0))
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-auth-'))
      await rm(root, { recursive: true, force: true }).catch(() => {});
}

/** A cookie from a response (`name=value`), for the next request. */
export function cookieOf(response: { headers: Record<string, unknown> }, name = 'rh_session') {
  const set = [response.headers['set-cookie']].flat().join(';');
  const match = new RegExp(`${name}=([^;]+)`).exec(set);
  return match ? `${name}=${match[1]}` : '';
}

export interface FakeUser {
  sub: string;
  preferred_username?: string;
  /** Display name, which users can often change themselves. */
  name?: string;
  email?: string;
  groups?: string[];
}
const b64 = (value: object | Buffer) =>
  (Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))).toString('base64url');

/**
 * A minimal OpenID provider: discovery, JWKS, token endpoint with PKCE and client_secret_basic,
 * UserInfo. Like Authelia by default, groups only come from UserInfo, not from the ID token.
 */
export async function fakeIssuer(clientId = 'replayhaven', clientSecret = 'client-secret') {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256', use: 'sig' };
  const codes = new Map<
    string,
    { user: FakeUser; challenge: string; nonce: string; redirectUri: string }
  >();
  const tokens = new Map<string, FakeUser>();
  const requests: string[] = [];
  let issuer = '';
  const sign = (claims: object) => {
    const input = `${b64({ alg: 'RS256', typ: 'JWT', kid: 'test' })}.${b64(claims)}`;
    const signature = createSign('RSA-SHA256').update(input).sign(privateKey);
    return `${input}.${b64(signature)}`;
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    requests.push(url.pathname);
    const json = (status: number, body: object) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      if (url.pathname === '/.well-known/openid-configuration')
        return json(200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          userinfo_endpoint: `${issuer}/userinfo`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['client_secret_basic'],
        });
      if (url.pathname === '/jwks') return json(200, { keys: [jwk] });
      if (url.pathname === '/token') {
        const form = new URLSearchParams(body);
        // RFC 6749 2.3.1: both parts are form-urlencoded before the Base64 step.
        const [id, secret] = Buffer.from(
          (req.headers.authorization ?? '').replace(/^Basic /, ''),
          'base64',
        )
          .toString()
          .split(':')
          .map((part) => decodeURIComponent(part.replace(/\+/g, ' ')));
        if (id !== clientId || secret !== clientSecret)
          return json(401, { error: 'invalid_client' });
        const grant = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        const verifier = form.get('code_verifier') ?? '';
        if (
          !grant ||
          form.get('redirect_uri') !== grant.redirectUri ||
          createHash('sha256').update(verifier).digest('base64url') !== grant.challenge
        )
          return json(400, { error: 'invalid_grant', error_description: 'Bad code or PKCE.' });
        const access = randomBytes(16).toString('hex');
        tokens.set(access, grant.user);
        const now = Math.floor(Date.now() / 1000);
        return json(200, {
          access_token: access,
          token_type: 'Bearer',
          expires_in: 300,
          id_token: sign({
            iss: issuer,
            aud: clientId,
            sub: grant.user.sub,
            nonce: grant.nonce,
            iat: now,
            exp: now + 300,
          }),
        });
      }
      if (url.pathname === '/userinfo') {
        const user = tokens.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
        return user ? json(200, user) : json(401, { error: 'invalid_token' });
      }
      json(404, { error: 'not_found' });
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    issuer,
    clientId,
    clientSecret,
    requests,
    /** Plays the provider's login page: accepts the authorization request for `user`. */
    authorize(location: string, user: FakeUser) {
      const url = new URL(location);
      if (url.origin !== issuer) throw new Error(`unexpected authorization URL ${location}`);
      const code = randomBytes(12).toString('hex');
      codes.set(code, {
        user,
        challenge: url.searchParams.get('code_challenge') ?? '',
        nonce: url.searchParams.get('nonce') ?? '',
        redirectUri: url.searchParams.get('redirect_uri') ?? '',
      });
      return { code, state: url.searchParams.get('state') ?? '', url };
    },
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
