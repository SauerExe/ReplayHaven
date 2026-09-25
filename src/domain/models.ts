export interface Game {
  id: string;
  name: string;
  appId: number;
  color: string;
  genre: string;
  cover: string;
  screenshots: string[];
  movies: { name: string; url: string }[];
  source: string;
}
export interface Clip {
  id: string;
  title: string;
  gameId: string;
  thumbnail: string;
  videoSource?: string;
  sourcePage?: string;
  sourceTitle?: string;
  duration: number;
  recordedAt: string;
  size: number;
  resolution: string;
  tags: string[];
  favorite: boolean;
  status: 'ready' | 'processing' | 'error';
  note: string;
  local?: boolean;
  server?: boolean;
  originalName?: string;
  gameName?: string;
  description?: string;
  deviceName?: string;
  analysis?: ClipAnalysis;
}
export interface AnalysisResult {
  title: string;
  description: string;
  game: string;
  tags: string[];
  confidence: 'low' | 'medium' | 'high';
  uncertainty: string;
  highlights: { seconds: number; title: string; description: string }[];
}
export interface ClipAnalysis {
  status:
    | 'not_configured'
    | 'idle'
    | 'queued'
    | 'preparing'
    | 'analyzing'
    | 'ready'
    | 'error'
    | 'awaiting_client';
  result?: AnalysisResult;
  error?: string;
  provider?: string;
  model?: string;
  updatedAt?: string;
  input?: 'frames' | 'video' | 'video_audio';
}
export interface GameMetadataStatus {
  enabled: boolean;
  pending: number;
  total: number;
  matched: number;
  missing: number;
  failed: number;
}
export interface ServerInfo {
  connected: boolean;
  /** Release of the server; missing on older servers. */
  version?: string;
  authRequired?: boolean;
  provider: 'none' | 'local' | 'gemini';
  configured: boolean;
  model: string;
  settings: { autoAnalyze: boolean; autoTitle: boolean; includeAudio: boolean };
  queue: number;
  clientDownloadAvailable?: boolean;
  gameMetadata?: GameMetadataStatus;
  /** Background creation of web playback copies (server/playback.ts); missing on older servers. */
  playback?: { mode: string; pending: number; current?: string; done: number };
  devices: {
    id: string;
    name: string;
    folder: string;
    lastSeen: string;
    error: string;
    uploaded: number;
    analysisLocation?: string;
    paused?: boolean;
  }[];
}
export interface Collection {
  id: string;
  title: string;
  description: string;
  clipIds: string[];
  updatedAt: string;
}
export interface Device {
  id: string;
  name: string;
  lastSeen: string | null;
  folders: { path: string; gameId: string }[];
  connected: boolean;
}
export interface UploadJob {
  id: string;
  name: string;
  progress: number;
  status: 'reading' | 'complete' | 'error';
  error?: string;
  clipId?: string;
  server?: boolean;
}
export interface PlaybackProgress {
  seconds: number;
  duration: number;
  updatedAt: string;
}
export interface UserPreferences {
  name: string;
  speed: number;
  reducedMotion: boolean;
  compact: boolean;
}
export interface VaultState {
  version: 1;
  clips: Clip[];
  collections: Collection[];
  progress: Record<string, PlaybackProgress>;
  preferences: UserPreferences;
}
export interface ClipFilters {
  query?: string;
  game?: string;
  favorite?: boolean;
  tag?: string;
  period?: string;
  status?: string;
  sort?: string;
}

/** Game info from the server, looked up on Steam. Without an exact match only `label` is set. */
export interface ServerGame {
  key: string;
  label: string;
  name?: string;
  description?: string;
  genre?: string;
  released?: string;
  source?: string;
  cover?: string;
}
