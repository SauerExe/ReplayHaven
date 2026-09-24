import { describe, expect, it } from 'vitest';
import type { Clip, ClipAnalysis, Game, ServerInfo } from '../domain/models';
import { serverStatus, toStreamLibrary, UNKNOWN_GAME } from './model';

const cs2: Game = {
  id: 'cs2',
  name: 'Counter-Strike 2',
  appId: 730,
  color: '#deae71',
  genre: 'Taktik-Shooter',
  cover: '/media/cs2-cover.webp',
  screenshots: [],
  movies: [],
  source: '',
};

function clip(patch: Partial<Clip> = {}): Clip {
  return {
    id: 'beispiel',
    title: 'Ace auf Inferno',
    gameId: 'cs2',
    thumbnail: '/media/cs2-4.webp',
    duration: 54,
    recordedAt: '2026-09-24T19:14:00.000Z',
    size: 0,
    resolution: '1080p',
    tags: [],
    favorite: false,
    status: 'ready',
    note: '',
    ...patch,
  };
}

const analysis: ClipAnalysis = {
  status: 'ready',
  provider: 'local',
  result: {
    title: 'Ace auf Inferno',
    description: 'Fünf Gegner in einer Runde.',
    game: 'Counter-Strike 2',
    tags: ['Ace', 'Rundensieg'],
    confidence: 'high',
    uncertainty: '',
    highlights: [
      { seconds: 38, title: 'Triple Kill', description: '' },
      { seconds: 12, title: 'Erster Kill', description: '' },
      { seconds: -1, title: 'Kaputt', description: '' },
      { seconds: Number.NaN, title: 'Kaputt', description: '' },
      { seconds: 90, title: 'Nach dem Ende', description: '' },
    ],
  },
};

const library = (clips: Clip[], extra: Partial<Parameters<typeof toStreamLibrary>[0]> = {}) =>
  toStreamLibrary({ clips, collections: [], progress: {}, ...extra }, {}, [cs2]);

describe('toStreamLibrary', () => {
  it('nimmt für Beispiel-Clips Spielname und Cover aus den bekannten Spielen', () => {
    const [result] = library([clip()]).clips;
    expect(result).toMatchObject({
      game: 'Counter-Strike 2',
      gameKey: 'cs2',
      gameCover: '/media/cs2-cover.webp',
      hasAnalysis: false,
      analyzing: false,
      highlights: [],
      description: '',
    });
    expect(result.confidence).toBeUndefined();
    expect(result.downloadUrl).toBeUndefined();
  });

  it('nutzt für Server-Aufnahmen Ordnername, Spielinfos und das KI-Ergebnis', () => {
    const { clips } = toStreamLibrary(
      {
        clips: [
          clip({
            id: 's1',
            gameId: 'recording',
            gameName: 'CS2',
            server: true,
            deviceName: 'Gaming-PC',
            size: 44669338,
            analysis,
          }),
        ],
        collections: [],
        progress: {},
      },
      { CS2: { key: 'cs2', label: 'CS2', name: 'Counter-Strike 2', cover: '/cover.jpg' } },
      [cs2],
    );
    expect(clips[0]).toMatchObject({
      game: 'Counter-Strike 2',
      gameKey: 'name:CS2',
      gameCover: '/cover.jpg',
      downloadUrl: '/api/clips/s1/download',
      description: 'Fünf Gegner in einer Runde.',
      tags: ['Ace', 'Rundensieg'],
      hasAnalysis: true,
      confidence: 'high',
      provider: 'local',
      deviceName: 'Gaming-PC',
    });
    // Unsortierte, negative und nach dem Clipende liegende Zeitmarken fallen weg.
    expect(clips[0].highlights.map((h) => h.seconds)).toEqual([12, 38]);
  });

  it('bevorzugt eigene Beschreibung und Tags vor dem KI-Vorschlag', () => {
    const [result] = library([
      clip({ description: 'Eigener Text', tags: ['Clutch'], analysis }),
    ]).clips;
    expect(result.description).toBe('Eigener Text');
    expect(result.tags).toEqual(['Clutch']);
  });

  it('meldet nur Warteschlange, Vorbereitung und laufende Analyse als „analysiert“', () => {
    const statuses: ClipAnalysis['status'][] = [
      'queued',
      'preparing',
      'analyzing',
      'ready',
      'error',
      'idle',
      'awaiting_client',
      'not_configured',
    ];
    const { clips } = library(
      statuses.map((status, i) => clip({ id: `c${i}`, analysis: { status } })),
    );
    expect(clips.map((c) => c.analyzing)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('fällt ohne Spielinfo auf den Ordnernamen und ganz ohne Spiel auf „Deine Aufnahme“ zurück', () => {
    const { clips } = library([
      clip({ id: 'ordner', gameId: 'recording', gameName: 'Mein Spiel', server: true }),
      clip({ id: 'lokal', gameId: 'local', local: true, videoSource: 'blob:lokal' }),
    ]);
    expect(clips[0]).toMatchObject({ game: 'Mein Spiel', gameKey: 'name:Mein Spiel' });
    expect(clips[0].gameCover).toBeUndefined();
    expect(clips[1]).toMatchObject({
      game: UNKNOWN_GAME,
      gameKey: '',
      downloadUrl: 'blob:lokal',
    });
  });

  it('hängt den Fortschritt an und entfernt fehlende Clips aus Sammlungen', () => {
    const progress = { seconds: 13, duration: 54, updatedAt: '2026-09-24T19:30:00.000Z' };
    const result = library([clip({ id: 'a' })], {
      progress: { a: progress },
      collections: [
        { id: 'k', title: 'Beste Clutches', description: '', clipIds: ['a', 'weg'], updatedAt: '' },
      ],
    });
    expect(result.clips[0].progress).toEqual(progress);
    expect(result.collections).toEqual([{ id: 'k', title: 'Beste Clutches', clipIds: ['a'] }]);
  });
});

describe('serverStatus', () => {
  const now = Date.parse('2026-09-24T19:40:00.000Z');
  const device = (patch: Partial<ServerInfo['devices'][number]>) => ({
    id: 'd',
    name: 'Gaming-PC',
    folder: '',
    lastSeen: '2026-09-24T19:39:30.000Z',
    error: '',
    uploaded: 0,
    ...patch,
  });

  it('zählt nur Geräte, die online und nicht pausiert sind', () => {
    expect(serverStatus({ connected: false, devices: [] }, now)).toEqual({
      connected: false,
      text: 'Server nicht verbunden',
    });
    expect(serverStatus({ connected: true, devices: [] }, now).text).toBe('Server verbunden');
    expect(
      serverStatus(
        {
          connected: true,
          devices: [
            device({ id: 'a' }),
            device({ id: 'b', paused: true }),
            device({ id: 'c', lastSeen: '2026-09-24T18:00:00.000Z' }),
          ],
        },
        now,
      ).text,
    ).toBe('Server verbunden · 1 Gerät lädt neue Aufnahmen automatisch hoch');
  });
});
