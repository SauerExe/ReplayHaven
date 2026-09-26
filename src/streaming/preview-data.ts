import type {
  AnalysisResult,
  Clip,
  Collection,
  PlaybackProgress,
  ServerGame,
  ServerInfo,
} from '../domain/models';

// Beispieldaten für /streaming-preview.html. Platzhalter, keine echten Aufnahmen oder Namen.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Feste Abendzeit, damit die Vorschau wie der Entwurf „Heute, 21:14“ zeigt, egal wann sie läuft. */
export function previewNow(): number {
  const date = new Date();
  date.setHours(21, 40, 0, 0);
  return date.getTime();
}

const games = {
  cs2: 'Counter-Strike 2',
  apex: 'Apex Legends',
  elden: 'Elden Ring',
  cyberpunk: 'Cyberpunk 2077',
  forza: 'Forza Horizon 5',
} as const;
type GameId = keyof typeof games;

export const previewGames: Record<string, ServerGame> = Object.fromEntries(
  (Object.keys(games) as GameId[]).map((id) => [
    games[id],
    { key: id, label: games[id], name: games[id], cover: `/media/${id}-cover.webp` },
  ]),
);

interface Sample {
  id: string;
  title: string;
  game: GameId;
  image: string;
  duration: number;
  /** Minuten vor der Vorschau-Zeit. */
  ago: number;
  tags: string[];
  favorite?: boolean;
  progress?: [seconds: number, watchedMinutesAgo: number];
  analysis?:
    | 'analyzing'
    | (Pick<AnalysisResult, 'confidence' | 'description' | 'highlights'> & {
        provider: 'local' | 'gemini';
      });
}

const mark = (seconds: number, title: string) => ({ seconds, title, description: '' });

const samples: Sample[] = [
  {
    id: 'ace-inferno',
    title: 'Ace auf Inferno',
    game: 'cs2',
    image: 'cs2-4',
    duration: 54,
    ago: 26,
    tags: ['Ace', 'Rundensieg', 'Inferno'],
    favorite: true,
    analysis: {
      provider: 'local',
      confidence: 'high',
      description:
        'Fünf Gegner in einer Runde, der letzte hinter den Fässern in der Gasse. Die Runde endet mit dem Rundensieg.',
      highlights: [
        mark(12, 'Erster Kill'),
        mark(21, 'Doppel-Kill'),
        mark(38, 'Triple Kill hinter den Fässern'),
        mark(47, 'Ace'),
        mark(51, 'Rundensieg'),
      ],
    },
  },
  {
    id: 'triple-mirage',
    title: 'Triple Kill auf Mirage',
    game: 'cs2',
    image: 'cs2-3',
    duration: 47,
    ago: 48,
    tags: ['Triple Kill', 'Mirage'],
    analysis: {
      provider: 'gemini',
      confidence: 'medium',
      description:
        'Drei Gegner nacheinander am Palast, der dritte mit einem Schuss durch die Rauchwand.',
      highlights: [
        mark(9, 'Erster Treffer'),
        mark(22, 'Doppel-Kill am Palast'),
        mark(31, 'Triple Kill'),
      ],
    },
  },
  {
    id: 'neuer-clip',
    title: 'Neuer Clip',
    game: 'apex',
    image: 'apex-5',
    duration: 72,
    ago: 60,
    tags: [],
    analysis: 'analyzing',
  },
  {
    id: 'falscher-ort',
    title: 'Zur richtigen Zeit am falschen Ort',
    game: 'apex',
    image: 'apex-1',
    duration: 64,
    ago: 102,
    tags: ['Teamplay', 'Mit Freunden'],
    analysis: {
      provider: 'gemini',
      confidence: 'high',
      description:
        'Das Team landet mitten im Feuergefecht zweier Squads und räumt am Ende beide ab.',
      highlights: [
        mark(18, 'Landung im Gefecht'),
        mark(40, 'Erstes Squad erledigt'),
        mark(58, 'Zweites Squad erledigt'),
      ],
    },
  },
  {
    id: 'normaler-auftrag',
    title: 'Ein ganz normaler Auftrag',
    game: 'cyberpunk',
    image: 'cyberpunk-4',
    duration: 36,
    ago: 24 * 60 + 35,
    tags: ['Verfolgung', 'Nacht'],
  },
  {
    id: 'eine-kurve',
    title: 'Nur noch diese eine Kurve',
    game: 'forza',
    image: 'forza-4',
    duration: 29,
    ago: 27 * 60 + 55,
    tags: ['Racing'],
  },
  {
    id: 'boss-plaene',
    title: 'Dieser Boss hatte andere Pläne',
    game: 'elden',
    image: 'elden-5',
    duration: 66,
    ago: 27 * 60 + 10,
    tags: ['Bossfight'],
    favorite: true,
    progress: [25, 35],
  },
  {
    id: 'clutch-inferno',
    title: 'Clutch 1 gegen 3 auf Inferno',
    game: 'cs2',
    image: 'cs2-2',
    duration: 58,
    ago: 23 * 60 + 30,
    tags: ['Clutch', 'Rundensieg'],
    favorite: true,
    progress: [38, 5 * 60],
    analysis: {
      provider: 'local',
      confidence: 'high',
      description:
        'Allein gegen drei auf der Bombenstelle. Der letzte Gegner fällt eine Sekunde vor der Detonation.',
      highlights: [
        mark(14, 'Erster Gegner'),
        mark(33, 'Zweiter Gegner'),
        mark(49, 'Clutch gewonnen'),
      ],
    },
  },
  {
    id: 'schrotflinte',
    title: 'Dreifach-Kill mit der Schrotflinte',
    game: 'apex',
    image: 'apex-0',
    duration: 43,
    ago: 2 * 24 * 60 + 90,
    tags: ['Triple Kill'],
    progress: [13, 3 * 60],
  },
  {
    id: 'plan-b',
    title: 'Plan B: einfach weiterfahren',
    game: 'cyberpunk',
    image: 'cyberpunk-3',
    duration: 55,
    ago: 2 * 24 * 60 + 200,
    tags: ['Verfolgung'],
    progress: [43, 2 * 60],
  },
  {
    id: 'sauberster-drift',
    title: 'Der sauberste Drift bisher',
    game: 'forza',
    image: 'forza-1',
    duration: 31,
    ago: 2 * 24 * 60 + 400,
    tags: ['Drift'],
    progress: [23, 4 * 60],
  },
  {
    id: 'headshot-inferno',
    title: 'Doppel-Kill per Headshot',
    game: 'cs2',
    image: 'cs2-5',
    duration: 23,
    ago: 3 * 24 * 60 + 60,
    tags: ['Headshot', 'Inferno'],
    favorite: true,
    analysis: {
      provider: 'local',
      confidence: 'high',
      description:
        'Zwei Kopftreffer in weniger als einer Sekunde, beide durch die Tür am Bananengang.',
      highlights: [mark(8, 'Erster Headshot'), mark(15, 'Doppel-Kill')],
    },
  },
  {
    id: 'letzter-versuch',
    title: 'Ein letzter Versuch. Versprochen.',
    game: 'elden',
    image: 'elden-2',
    duration: 58,
    ago: 3 * 24 * 60 + 180,
    tags: ['Bossfight'],
  },
  {
    id: 'weg-highlight',
    title: 'Der Weg ist das Highlight',
    game: 'elden',
    image: 'elden-0',
    duration: 52,
    ago: 3 * 24 * 60 + 300,
    tags: ['Open World'],
  },
  {
    id: 'fuenf-treffer',
    title: 'Eine Runde. Fünf Treffer.',
    game: 'cs2',
    image: 'cs2-1',
    duration: 42,
    ago: 4 * 24 * 60,
    tags: ['Mit Freunden'],
  },
  {
    id: 'nachts-stadt',
    title: 'Nachts gehört uns die Stadt',
    game: 'cyberpunk',
    image: 'cyberpunk-5',
    duration: 71,
    ago: 4 * 24 * 60 + 120,
    tags: ['Atmosphäre'],
    progress: [21, 6 * 60],
  },
  {
    id: 'champion',
    title: 'Champion mit dem letzten Schuss',
    game: 'apex',
    image: 'apex-4',
    duration: 51,
    ago: 5 * 24 * 60,
    tags: ['Champion', 'Sieg'],
    favorite: true,
  },
  {
    id: 'letzte-sekunde',
    title: 'Rundensieg in letzter Sekunde',
    game: 'cs2',
    image: 'cs2-0',
    duration: 35,
    ago: 6 * 24 * 60,
    tags: ['Rundensieg'],
  },
  {
    id: 'nicht-geplant',
    title: 'So war das nicht geplant',
    game: 'forza',
    image: 'forza-3',
    duration: 44,
    ago: 6 * 24 * 60 + 240,
    tags: ['Crash'],
  },
  {
    id: 'plan-apex',
    title: 'Wir hatten einen Plan',
    game: 'apex',
    image: 'apex-3',
    duration: 39,
    ago: 8 * 24 * 60,
    tags: ['Teamplay'],
  },
  {
    id: 'aussicht',
    title: 'Die Aussicht war es wert',
    game: 'elden',
    image: 'elden-3',
    duration: 31,
    ago: 9 * 24 * 60,
    tags: ['Atmosphäre'],
  },
];

export interface PreviewState {
  clips: Clip[];
  collections: Collection[];
  progress: Record<string, PlaybackProgress>;
}

/** `video` setzt für alle Beispiel-Clips dieselbe Videodatei, etwa über ?video=/pfad/clip.mp4. */
export function createPreviewState(now: number, video?: string): PreviewState {
  const clips = samples.map((sample): Clip => {
    const analysis = sample.analysis;
    return {
      id: sample.id,
      title: sample.title,
      gameId: 'recording',
      gameName: games[sample.game],
      thumbnail: `/media/${sample.image}.webp`,
      videoSource: video,
      duration: sample.duration,
      recordedAt: new Date(now - sample.ago * MINUTE).toISOString(),
      size: Math.round(sample.duration * 827_000),
      resolution: '1080p',
      tags: sample.tags,
      favorite: !!sample.favorite,
      status: 'ready',
      note: '',
      server: true,
      deviceName: 'Gaming-PC',
      analysis:
        analysis === 'analyzing'
          ? { status: 'analyzing', provider: 'local' }
          : analysis
            ? {
                status: 'ready',
                provider: analysis.provider,
                result: {
                  title: sample.title,
                  description: analysis.description,
                  game: games[sample.game],
                  tags: sample.tags,
                  confidence: analysis.confidence,
                  uncertainty: '',
                  highlights: analysis.highlights,
                },
              }
            : undefined,
    };
  });
  const progress = Object.fromEntries(
    samples
      .filter((s) => s.progress)
      .map((s) => {
        const [seconds, watched] = s.progress!;
        return [
          s.id,
          {
            seconds,
            duration: s.duration,
            updatedAt: new Date(now - watched * MINUTE).toISOString(),
          },
        ];
      }),
  );
  const collection = (id: string, title: string, clipIds: string[], daysAgo: number) => ({
    id,
    title,
    description: '',
    clipIds,
    updatedAt: new Date(now - daysAgo * DAY).toISOString(),
  });
  return {
    clips,
    progress,
    collections: [
      collection(
        'clutches',
        'Beste Clutches',
        ['clutch-inferno', 'champion', 'headshot-inferno', 'letzte-sekunde'],
        1,
      ),
      collection(
        'freunde',
        'Mit Freunden',
        ['falscher-ort', 'plan-apex', 'fuenf-treffer', 'plan-b'],
        2,
      ),
      collection(
        'montage',
        'Montage-Material',
        ['sauberster-drift', 'triple-mirage', 'boss-plaene', 'ace-inferno', 'nachts-stadt'],
        3,
      ),
      collection('bosse', 'Bosskämpfe', ['boss-plaene', 'letzter-versuch', 'aussicht'], 4),
    ],
  };
}

export function previewServer(now: number): Pick<ServerInfo, 'connected' | 'devices'> {
  return {
    connected: true,
    devices: [
      {
        id: 'gaming-pc',
        name: 'Gaming-PC',
        folder: '',
        lastSeen: new Date(now - 20_000).toISOString(),
        error: '',
        uploaded: samples.length,
      },
    ],
  };
}
