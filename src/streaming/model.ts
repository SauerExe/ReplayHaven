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
import type { Confidence } from './format';

export interface StreamHighlight {
  seconds: number;
  title: string;
  description: string;
}

export interface StreamClip {
  id: string;
  title: string;
  /** Anzeigename des Spiels, „Deine Aufnahme“ wenn unbekannt. */
  game: string;
  /** Wie im Bibliotheksfilter: `cs2` oder `name:<Ordnername>`; leer, wenn das Spiel unbekannt ist. */
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
  /** Ein KI-Ergebnis liegt vor; Titel und Zeitmarken stammen dann aus der Analyse. */
  hasAnalysis: boolean;
  confidence?: Confidence;
  provider?: string;
  deviceName?: string;
  progress?: PlaybackProgress;
}

export interface StreamCollection {
  id: string;
  title: string;
  description?: string;
  clipIds: string[];
  updatedAt?: string;
}

/** Spielinfos wie in „Deine Spiele“: vom Server (Steam) oder aus den Beispieldaten. */
export interface StreamGame {
  /** Wie StreamClip.gameKey. */
  key: string;
  name: string;
  cover?: string;
  genre?: string;
  /** Erscheinungsdatum, wie Steam es liefert, etwa „21. Aug. 2012“. */
  released?: string;
  description?: string;
  /** Steam-Seite des Spiels. */
  source?: string;
}

export interface StreamLibrary {
  clips: StreamClip[];
  collections: StreamCollection[];
  /** Je gameKey; Clips ohne erkanntes Spiel stehen hier nicht. */
  games: Record<string, StreamGame>;
}

export const UNKNOWN_GAME = 'Deine Aufnahme';

const RUNNING = new Set(['queued', 'preparing', 'analyzing']);

export function toStreamClip(
  clip: Clip,
  progress: PlaybackProgress | undefined,
  gameInfo: Record<string, ServerGame>,
  knownGames: Game[],
): StreamClip {
  const analysis = clip.analysis;
  const result = analysis?.result;
  // Server-Aufnahmen tragen den Ordnernamen, Beispiel-Clips eine Spiel-ID; so filtert auch die Bibliothek.
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
    game: info?.name || clip.gameName || seedGame?.name || result?.game || UNKNOWN_GAME,
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

/** Fußzeile der Startseite; „online“ wie auf der Geräteseite: Kontakt in den letzten 90 Sekunden. */
export function serverStatus(
  server: Pick<ServerInfo, 'connected' | 'devices'>,
  now: number,
): StreamStatus {
  if (!server.connected) return { connected: false, text: 'Server nicht verbunden' };
  const uploading = server.devices.filter(
    (d) => !d.paused && now - Date.parse(d.lastSeen) < 90000,
  ).length;
  return {
    connected: true,
    text:
      uploading === 0
        ? 'Server verbunden'
        : `Server verbunden · ${uploading} ${uploading === 1 ? 'Gerät lädt' : 'Geräte laden'} neue Aufnahmen automatisch hoch`,
  };
}
