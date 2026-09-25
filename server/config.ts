import { resolve } from 'node:path';

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  token: string;
  publicOrigin: string;
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
  /** Spielinfos (Name, Beschreibung, Cover) bei Steam nachschlagen. */
  gameMetadata: boolean;
  /** Twitch-Anwendung für IGDB, die zweite Quelle für Spiele ohne Steam-Eintrag. */
  igdb?: { clientId: string; clientSecret: string };
}
export function loadConfig(): ServerConfig {
  const provider = process.env.REPLAYHAVEN_AI_PROVIDER || 'none';
  if (!['none', 'gemini', 'local'].includes(provider)) throw new Error('Ungültiger KI-Anbieter.');
  const host = process.env.REPLAYHAVEN_HOST || '127.0.0.1';
  const token = process.env.REPLAYHAVEN_ACCESS_TOKEN || '';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && token.length < 24)
    throw new Error(
      'Für Netzwerkbetrieb REPLAYHAVEN_ACCESS_TOKEN mit mindestens 24 Zeichen setzen.',
    );
  const clientDownloadUrl = (process.env.REPLAYHAVEN_CLIENT_DOWNLOAD_URL || '').trim();
  if (clientDownloadUrl && !/^https?:\/\/\S+$/.test(clientDownloadUrl))
    throw new Error('REPLAYHAVEN_CLIENT_DOWNLOAD_URL muss eine HTTP(S)-Adresse sein.');
  return {
    host,
    port: Number(process.env.REPLAYHAVEN_PORT || 8787),
    dataDir: resolve(process.env.REPLAYHAVEN_DATA_DIR || 'vault-data'),
    token,
    publicOrigin: process.env.REPLAYHAVEN_PUBLIC_ORIGIN || 'http://localhost:5173',
    provider: provider as ServerConfig['provider'],
    model: process.env.REPLAYHAVEN_AI_MODEL || '',
    geminiKey: process.env.GEMINI_API_KEY || '',
    localUrl: process.env.REPLAYHAVEN_LOCAL_AI_URL || 'http://127.0.0.1:8000/v1',
    localKey: process.env.REPLAYHAVEN_LOCAL_AI_KEY || '',
    ffmpeg: process.env.REPLAYHAVEN_FFMPEG,
    ffprobe: process.env.REPLAYHAVEN_FFPROBE,
    releaseDir: process.env.REPLAYHAVEN_RELEASE_DIR || 'release',
    clientDownloadUrl,
    // Der Server fragt dafuer nur den Spielnamen bei Steam an, nichts ueber Aufnahmen oder
    // Nutzer. Wer keine ausgehenden Verbindungen will, setzt die Variable auf 0.
    gameMetadata: !['0', 'false', 'off'].includes(
      (process.env.REPLAYHAVEN_GAME_METADATA || '1').toLowerCase(),
    ),
    // IGDB nur mit beiden Angaben; sonst bleibt es bei Steam.
    ...(process.env.REPLAYHAVEN_IGDB_CLIENT_ID?.trim() &&
    process.env.REPLAYHAVEN_IGDB_CLIENT_SECRET?.trim()
      ? {
          igdb: {
            clientId: process.env.REPLAYHAVEN_IGDB_CLIENT_ID.trim(),
            clientSecret: process.env.REPLAYHAVEN_IGDB_CLIENT_SECRET.trim(),
          },
        }
      : {}),
  };
}
export function aiConfigured(config: ServerConfig) {
  return (
    !!config.model &&
    (config.provider === 'local' || (config.provider === 'gemini' && !!config.geminiKey))
  );
}
