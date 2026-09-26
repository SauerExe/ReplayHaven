import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import * as client from 'openid-client';
import type { OidcConfig } from './config';

/**
 * Sign-in through an OpenID Connect provider (Authelia, Authentik, Keycloak, Pocket ID …):
 * authorization code flow with PKCE. State, nonce and code verifier travel in a short-lived,
 * signed, HttpOnly cookie between the start of the flow and the callback.
 */

/** What the browser carries between start and callback. */
export interface OidcFlow {
  state: string;
  nonce: string;
  verifier: string;
  /** Epoch milliseconds after which the flow is no longer accepted. */
  expires: number;
  /** Set when a signed-in account links this sign-in instead of signing in. */
  link?: string;
}
export interface OidcProfile {
  issuer: string;
  sub: string;
  /** Preferred account name: preferred_username, name or the local part of the e-mail. */
  username: string;
  groups: string[];
}

export const FLOW_MINUTES = 10;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Signs flow data with a per-process key: a restart only cancels logins in progress. */
export class FlowSealer {
  constructor(private readonly key = randomBytes(32)) {}
  private mac(data: string) {
    return createHmac('sha256', this.key).update(data).digest('base64url');
  }
  seal(flow: OidcFlow) {
    const data = Buffer.from(JSON.stringify(flow)).toString('base64url');
    return `${data}.${this.mac(data)}`;
  }
  open(value: string | undefined, now = Date.now()): OidcFlow | undefined {
    if (!value) return undefined;
    const [data, mac] = value.split('.');
    if (!data || !mac) return undefined;
    const expected = Buffer.from(this.mac(data));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
    try {
      const flow = JSON.parse(Buffer.from(data, 'base64url').toString()) as OidcFlow;
      return typeof flow.expires === 'number' && flow.expires > now ? flow : undefined;
    } catch {
      return undefined;
    }
  }
}

/** A failed sign-in with a message that can be shown to the user. */
export class OidcError extends Error {}

function claimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}
function claimGroups(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((g): g is string => typeof g === 'string');
  if (typeof value === 'string') return value.split(/[,\s]+/).filter(Boolean);
  return [];
}

export class OidcClient {
  private configuration?: Promise<client.Configuration>;
  constructor(
    readonly settings: OidcConfig,
    readonly redirectUri: string,
  ) {}

  /** Discovery once, cached; a failure is retried on the next sign-in. */
  private config() {
    if (!this.configuration) {
      const issuer = new URL(this.settings.issuer);
      // Plain HTTP only for a provider on the same machine (tests, local experiments).
      const insecure = issuer.protocol === 'http:' && LOOPBACK.has(issuer.hostname);
      this.configuration = client
        .discovery(
          issuer,
          this.settings.clientId,
          undefined,
          this.settings.clientSecret
            ? client.ClientSecretBasic(this.settings.clientSecret)
            : client.None(),
          { timeout: 15, ...(insecure ? { execute: [client.allowInsecureRequests] } : {}) },
        )
        .catch((error: unknown) => {
          this.configuration = undefined;
          throw new OidcError(
            `The sign-in provider could not be reached (${error instanceof Error ? error.message : 'discovery failed'}).`,
          );
        });
    }
    return this.configuration;
  }

  /** The URL to send the browser to, and the flow data to remember in a cookie. */
  async start(link?: string, now = Date.now()) {
    const config = await this.config();
    const verifier = client.randomPKCECodeVerifier();
    const flow: OidcFlow = {
      state: client.randomState(),
      nonce: client.randomNonce(),
      verifier,
      expires: now + FLOW_MINUTES * 60000,
      ...(link ? { link } : {}),
    };
    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: this.redirectUri,
      scope: this.settings.scopes,
      response_type: 'code',
      code_challenge: await client.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state: flow.state,
      nonce: flow.nonce,
    });
    return { url: url.href, flow };
  }

  /** Exchanges the code from the callback and returns who signed in. */
  async finish(search: string, flow: OidcFlow): Promise<OidcProfile> {
    const config = await this.config();
    const current = new URL(this.redirectUri);
    current.search = search;
    let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
    try {
      tokens = await client.authorizationCodeGrant(config, current, {
        pkceCodeVerifier: flow.verifier,
        expectedState: flow.state,
        expectedNonce: flow.nonce,
        idTokenExpected: true,
      });
    } catch (error) {
      const description =
        error instanceof client.AuthorizationResponseError ||
        error instanceof client.ResponseBodyError
          ? error.error_description || error.error
          : error instanceof Error
            ? error.message
            : 'unknown error';
      throw new OidcError(`The sign-in could not be completed: ${description}`);
    }
    const idClaims = tokens.claims();
    if (!idClaims) throw new OidcError('The sign-in provider returned no ID token.');
    let claims: Record<string, unknown> = { ...idClaims };
    // Authelia and others put profile claims and groups only into the UserInfo response.
    if (config.serverMetadata().userinfo_endpoint && tokens.access_token)
      try {
        const info = await client.fetchUserInfo(config, tokens.access_token, idClaims.sub);
        claims = { ...info, ...claims, groups: info.groups ?? claims.groups };
        for (const key of ['preferred_username', 'name', 'email'])
          if (!claimString(claims[key]) && claimString(info[key])) claims[key] = info[key];
      } catch {
        // The ID token alone is enough to sign in.
      }
    const email = claimString(claims.email);
    return {
      issuer: String(idClaims.iss),
      sub: idClaims.sub,
      username:
        claimString(claims.preferred_username) ||
        claimString(claims.name) ||
        (email.includes('@') ? email.split('@')[0] : email) ||
        'user',
      groups: claimGroups(claims.groups),
    };
  }
}
