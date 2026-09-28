import { resolve } from 'node:path';

/** OpenID Connect sign-in (Authelia, Authentik, Keycloak, Pocket ID …). */
export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Label of the login button: "Sign in with <name>". */
  name: string;
  scopes: string;
  /** Members of this group (claim `groups`) become admins when they sign in. */
  adminGroup: string;
  /** Create an account on the first OIDC sign-in of an unknown identity. */
  autoCreate: boolean;
}

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  token: string;
  /** Canonical browser origin: redirect URI, QR links and Secure cookies derive from it. */
  publicOrigin: string;
  /**
   * Further origins browsers may use (REPLAYHAVEN_PUBLIC_ORIGIN is a comma-separated list, the
   * first entry is canonical).
   */
  extraOrigins?: string[];
  /** Fastify trustProxy: true, a hop count or a comma-separated list of proxy addresses. */
  trustProxy?: boolean | number | string;
  provider: 'none' | 'gemini' | 'local';
  model: string;
  geminiKey: string;
  localUrl: string;
  localKey: string;
  ffmpeg?: string;
  ffprobe?: string;
  /** Directory that may contain ReplayHaven-Client-Setup.exe for local downloads. */
  releaseDir?: string;
  /** External download for the Windows client, used when no local installer is mounted. */
  clientDownloadUrl?: string;
  /** Look up game info (name, description, cover) on Steam. */
  gameMetadata: boolean;
  /** Twitch application for IGDB, the second source for games without a Steam entry. */
  igdb?: { clientId: string; clientSecret: string };
  oidc?: OidcConfig;
  /** Local name + password sign-in; only switchable off while OIDC is configured. */
  passwordLogin?: boolean;
  /**
   * web (default): a light H.264 rendition for streaming over the internet; original: play the
   * original file whenever a browser can.
   */
  playback?: 'web' | 'original';
  /** Log level (REPLAYHAVEN_LOG_LEVEL, default info); without it (tests) nothing is logged. */
  logLevel?: 'error' | 'warn' | 'info' | 'debug' | 'silent';
  /** Whether admins see the request to tip the developer in the web library (default on). */
  supportBanner?: boolean;
  /** Language of content the server writes or fetches: AI titles and Steam game descriptions. */
  contentLanguage?: 'en' | 'de';
}

const flag = (value: string | undefined, fallback: boolean) =>
  value === undefined || value.trim() === ''
    ? fallback
    : !['0', 'false', 'off', 'no'].includes(value.trim().toLowerCase());

function origin(value: string) {
  const url = new URL(value.trim());
  if (!/^https?:$/.test(url.protocol)) throw new Error('not http');
  return url.origin;
}

export function parseOrigins(value: string | undefined) {
  const list = (value || 'http://localhost:5173')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  try {
    return list.map(origin);
  } catch {
    throw new Error(
      'REPLAYHAVEN_PUBLIC_ORIGIN must be one or more comma-separated http(s) origins such as https://clips.example.com.',
    );
  }
}

export function parseTrustProxy(value: string | undefined): ServerConfig['trustProxy'] {
  const text = (value || '').trim();
  if (!text || ['0', 'false', 'off', 'no'].includes(text.toLowerCase())) return false;
  if (['true', 'on', 'yes'].includes(text.toLowerCase())) return true;
  // A number counts the proxies in front of the server: "1" trusts only the nearest one, so a
  // client cannot add addresses of its own to X-Forwarded-For.
  if (/^\d+$/.test(text)) return Number(text);
  // Addresses or CIDR ranges of the proxies, e.g. "10.0.0.0/8,172.16.0.0/12".
  return text;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const provider = env.REPLAYHAVEN_AI_PROVIDER || 'none';
  if (!['none', 'gemini', 'local'].includes(provider))
    throw new Error('REPLAYHAVEN_AI_PROVIDER must be none, local or gemini.');
  const host = env.REPLAYHAVEN_HOST || '127.0.0.1';
  const token = env.REPLAYHAVEN_ACCESS_TOKEN || '';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && token.length < 24)
    throw new Error(
      'Set REPLAYHAVEN_ACCESS_TOKEN to at least 24 characters before listening on the network.',
    );
  // An empty override falls back to the address baked into release images.
  const clientDownloadUrl =
    (env.REPLAYHAVEN_CLIENT_DOWNLOAD_URL || '').trim() ||
    (env.REPLAYHAVEN_RELEASE_DOWNLOAD_URL || '').trim();
  if (clientDownloadUrl && !/^https?:\/\/\S+$/.test(clientDownloadUrl))
    throw new Error('REPLAYHAVEN_CLIENT_DOWNLOAD_URL must be an http(s) URL.');
  const [publicOrigin, ...extraOrigins] = parseOrigins(env.REPLAYHAVEN_PUBLIC_ORIGIN);

  const issuer = (env.REPLAYHAVEN_OIDC_ISSUER || '').trim();
  const clientId = (env.REPLAYHAVEN_OIDC_CLIENT_ID || '').trim();
  let oidc: OidcConfig | undefined;
  if (issuer || clientId) {
    if (!issuer || !clientId)
      throw new Error('OIDC needs both REPLAYHAVEN_OIDC_ISSUER and REPLAYHAVEN_OIDC_CLIENT_ID.');
    try {
      new URL(issuer);
    } catch {
      throw new Error('REPLAYHAVEN_OIDC_ISSUER must be a URL such as https://auth.example.com.');
    }
    oidc = {
      issuer,
      clientId,
      clientSecret: env.REPLAYHAVEN_OIDC_CLIENT_SECRET || '',
      name: (env.REPLAYHAVEN_OIDC_NAME || '').trim() || 'Single sign-on',
      scopes: (env.REPLAYHAVEN_OIDC_SCOPES || '').trim() || 'openid profile email groups',
      adminGroup: (env.REPLAYHAVEN_OIDC_ADMIN_GROUP || '').trim(),
      // Off unless enabled: with open registration at the provider anyone could get an account.
      autoCreate: flag(env.REPLAYHAVEN_OIDC_AUTO_CREATE, false),
    };
  }
  const playback = (env.REPLAYHAVEN_PLAYBACK || 'web').trim().toLowerCase();
  if (!['web', 'original'].includes(playback))
    throw new Error('REPLAYHAVEN_PLAYBACK must be web or original.');
  const logLevel = (env.REPLAYHAVEN_LOG_LEVEL || 'info').trim().toLowerCase();
  if (!['error', 'warn', 'info', 'debug', 'silent'].includes(logLevel))
    throw new Error('REPLAYHAVEN_LOG_LEVEL must be error, warn, info, debug or silent.');
  const portText = (env.REPLAYHAVEN_PORT || '8787').trim();
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || port < 1 || port > 65535)
    throw new Error('REPLAYHAVEN_PORT must be a whole number from 1 to 65535.');
  const contentLanguage = (env.REPLAYHAVEN_CONTENT_LANGUAGE || 'en').trim().toLowerCase();
  if (!['en', 'de'].includes(contentLanguage))
    throw new Error('REPLAYHAVEN_CONTENT_LANGUAGE must be en or de.');

  return {
    host,
    port,
    dataDir: resolve(env.REPLAYHAVEN_DATA_DIR || 'vault-data'),
    token,
    publicOrigin,
    extraOrigins,
    trustProxy: parseTrustProxy(env.REPLAYHAVEN_TRUST_PROXY),
    provider: provider as ServerConfig['provider'],
    model: env.REPLAYHAVEN_AI_MODEL || '',
    geminiKey: env.GEMINI_API_KEY || '',
    localUrl: env.REPLAYHAVEN_LOCAL_AI_URL || 'http://127.0.0.1:8000/v1',
    localKey: env.REPLAYHAVEN_LOCAL_AI_KEY || '',
    ffmpeg: env.REPLAYHAVEN_FFMPEG,
    ffprobe: env.REPLAYHAVEN_FFPROBE,
    releaseDir: env.REPLAYHAVEN_RELEASE_DIR || 'release',
    clientDownloadUrl,
    // Only the game name is sent to Steam, nothing about recordings or users. Set the variable
    // to 0 to avoid outgoing connections.
    gameMetadata: flag(env.REPLAYHAVEN_GAME_METADATA, true),
    // IGDB only with both values; otherwise Steam stays the only source.
    ...(env.REPLAYHAVEN_IGDB_CLIENT_ID?.trim() && env.REPLAYHAVEN_IGDB_CLIENT_SECRET?.trim()
      ? {
          igdb: {
            clientId: env.REPLAYHAVEN_IGDB_CLIENT_ID.trim(),
            clientSecret: env.REPLAYHAVEN_IGDB_CLIENT_SECRET.trim(),
          },
        }
      : {}),
    oidc,
    // Password sign-in can only be switched off when another way in exists.
    passwordLogin: oidc ? flag(env.REPLAYHAVEN_PASSWORD_LOGIN, true) : true,
    playback: playback as 'web' | 'original',
    contentLanguage: contentLanguage as 'en' | 'de',
    supportBanner: flag(env.REPLAYHAVEN_SUPPORT_BANNER, true),
    logLevel: logLevel as ServerConfig['logLevel'],
  };
}
export function aiConfigured(config: ServerConfig) {
  return (
    !!config.model &&
    (config.provider === 'local' || (config.provider === 'gemini' && !!config.geminiKey))
  );
}
