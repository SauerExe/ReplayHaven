import type {
  Clip,
  Game,
  PlaybackProgress,
  ServerGame,
  ServerInfo,
  VaultState,
} from '../domain/models';
import { games as seedGames } from '../data/seed';
import { gameKey } from '../domain/gameKey';
import { t, tp } from '../i18n';
import type { Confidence } from './format';

export interface StreamHighlight {
  seconds: number;
  title: string;
  description: string;
}

export interface StreamClip {
  id: string;
  title: string;
  /** Display name of the game, "Your recording" if unknown. */
  game: string;
  /** As in the library filter: `cs2` or `name:<folder name>`; empty if the game is unknown. */
  gameKey: string;
  gameCover?: string;
  thumbnail: string;
  videoUrl?: string;
  downloadUrl?: string;
  duration: number;
  recordedAt: string;
  resolution: string;
  size: number;
  tags: string[];
  favorite: boolean;
  status: Clip['status'];
  analyzing: boolean;
  description: string;
  highlights: StreamHighlight[];
  /** An AI result exists; title and highlights then come from the analysis. */
  hasAnalysis: boolean;
  confidence?: Confidence;
  provider?: string;
  deviceName?: string;
  /** Name of the account whose PC uploaded the clip. */
  uploadedBy?: string;
  progress?: PlaybackProgress;
}

export interface StreamCollection {
  id: string;
  title: string;
  description?: string;
  clipIds: string[];
  updatedAt?: string;
}

/** Game info as in "Your games": from the server (Steam) or from the sample data. */
export interface StreamGame {
  /** Like StreamClip.gameKey. */
  key: string;
  name: string;
  cover?: string;
  genre?: string;
  /** Release date as Steam delivers it, e.g. "21 Aug, 2012". */
  released?: string;
  description?: string;
  /** The game's Steam page. */
  source?: string;
}

export interface StreamLibrary {
  clips: StreamClip[];
  collections: StreamCollection[];
  /** Per gameKey; clips without a detected game are not listed here. */
  games: Record<string, StreamGame>;
}

/** Display name for clips whose game is unknown, in the current UI language. */
export function unknownGame(): string {
  return t('stream.unknownGame');
}

const RUNNING = new Set(['queued', 'preparing', 'analyzing']);

export function toStreamClip(
  clip: Clip,
  progress: PlaybackProgress | undefined,
  gameInfo: Record<string, ServerGame>,
  knownGames: Game[],
): StreamClip {
  const analysis = clip.analysis;
  const result = analysis?.result;
  // Server recordings carry the folder name, sample clips a game ID; the library filters the same way.
  const seedGame = clip.gameName ? undefined : knownGames.find((g) => g.id === clip.gameId);
  const info = clip.gameName
    ? (gameInfo[clip.gameName] ?? gameInfo[gameKey(clip.gameName)])
    : undefined;
  const duration = Number.isFinite(clip.duration) && clip.duration > 0 ? clip.duration : 0;
  const highlights = (result?.highlights ?? [])
    .filter(
      (h) =>
        Number.isFinite(h.seconds) && h.seconds >= 0 && (!duration || h.seconds <= duration + 1),
    )
    .map((h) => ({ seconds: h.seconds, title: h.title, description: h.description }))
    .sort((a, b) => a.seconds - b.seconds);
  return {
    id: clip.id,
    title: clip.title,
    game: info?.name || clip.gameName || seedGame?.name || result?.game || unknownGame(),
    gameKey: clip.gameName ? `name:${clip.gameName}` : (seedGame?.id ?? ''),
    gameCover: info?.cover || seedGame?.cover || undefined,
    thumbnail: clip.thumbnail || '',
    videoUrl: clip.videoSource || undefined,
    downloadUrl: clip.server
      ? `/api/clips/${encodeURIComponent(clip.id)}/download`
      : clip.local && clip.videoSource
        ? clip.videoSource
        : undefined,
    duration,
    recordedAt: clip.recordedAt,
    resolution: clip.resolution || '',
    size: clip.size || 0,
    tags: clip.tags.length ? clip.tags : (result?.tags ?? []),
    favorite: clip.favorite,
    status: clip.status,
    analyzing: RUNNING.has(analysis?.status ?? ''),
    description: clip.description || result?.description || '',
    highlights,
    hasAnalysis: !!result,
    confidence: result?.confidence,
    provider: result ? analysis?.provider || undefined : undefined,
    deviceName: clip.deviceName || undefined,
    uploadedBy: clip.uploadedBy?.name || undefined,
    progress,
  };
}

function toStreamGame(
  clip: Clip,
  gameInfo: Record<string, ServerGame>,
  knownGames: Game[],
): StreamGame | undefined {
  if (clip.gameName) {
    const info = gameInfo[clip.gameName] ?? gameInfo[gameKey(clip.gameName)];
    return {
      key: `name:${clip.gameName}`,
      name: info?.name || clip.gameName,
      cover: info?.cover || undefined,
      genre: info?.genre || undefined,
      released: info?.released || undefined,
      description: info?.description || undefined,
      source: info?.source || undefined,
    };
  }
  const seed = knownGames.find((g) => g.id === clip.gameId);
  return (
    seed && {
      key: seed.id,
      name: seed.name,
      cover: seed.cover || undefined,
      genre: seed.genre || undefined,
      source: seed.source || undefined,
    }
  );
}

export function toStreamLibrary(
  state: Pick<VaultState, 'clips' | 'collections' | 'progress'>,
  gameInfo: Record<string, ServerGame> = {},
  knownGames: Game[] = seedGames,
): StreamLibrary {
  const clips = state.clips.map((clip) =>
    toStreamClip(clip, state.progress[clip.id], gameInfo, knownGames),
  );
  const ids = new Set(clips.map((c) => c.id));
  const games: Record<string, StreamGame> = {};
  for (const clip of state.clips) {
    const game = toStreamGame(clip, gameInfo, knownGames);
    if (game && !games[game.key]) games[game.key] = game;
  }
  return {
    clips,
    collections: state.collections.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description || undefined,
      clipIds: c.clipIds.filter((id) => ids.has(id)),
      updatedAt: c.updatedAt || undefined,
    })),
    games,
  };
}

export interface StreamStatus {
  connected: boolean;
  text: string;
}

/** Home page footer; "online" as on the devices page: contact within the last 90 seconds. */
export function serverStatus(
  server: Pick<ServerInfo, 'connected' | 'devices'>,
  now: number,
): StreamStatus {
  if (!server.connected) return { connected: false, text: t('stream.server.disconnected') };
  const uploading = server.devices.filter(
    (d) => !d.paused && now - Date.parse(d.lastSeen) < 90000,
  ).length;
  return {
    connected: true,
    text: uploading === 0 ? t('stream.server.connected') : tp('stream.server.uploading', uploading),
  };
}
