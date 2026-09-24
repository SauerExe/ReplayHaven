import { afterEach, expect, it, vi } from 'vitest';
import { LocalAnalyzer, PausedError, validateLocalOllama } from './ollama';
import { DeferredError } from './watcher';
import type { ReplayLookup } from './fortnite';
import type { AnalysisTrace } from './ollama';
import { MediaProcessor } from '../server/media';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
afterEach(() => vi.unstubAllGlobals());
// Bilder liegen verschraenkt in eigenen Nachrichten, je Bild eine mit seinem Zeitpunkt.
const imagesOf = (body: { messages: { images?: string[] }[] }) =>
  body.messages.flatMap((m) => m.images ?? []);
it('restricts analysis to local Ollama', () => {
  expect(() => validateLocalOllama('https://cloud.invalid')).toThrow();
  expect(() => validateLocalOllama('http://localhost@cloud.invalid')).toThrow();
  expect(validateLocalOllama('http://127.0.0.1:11434/')).toBe('http://127.0.0.1:11434');
});
it('sends sequential small image batches followed by a text summary, validates results, and cleans work files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-analysis-'));
  try {
    const media = new MediaProcessor({});
    vi.spyOn(media, 'probe').mockResolvedValue({
      duration: 120,
      width: 1920,
      height: 1080,
      codec: 'h264',
      hasAudio: true,
      audio: [],
    });
    vi.spyOn(media, 'frames').mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({ seconds: i * 15, base64: 'test-image' })),
    );
    vi.spyOn(media, 'frameAt').mockResolvedValue('focus-image');
    const result = {
      title: 'Testtitel',
      description: 'Testbeobachtung',
      game: 'Spiel',
      tags: ['Tag'],
      confidence: 'high',
      uncertainty: 'Bildstichprobe',
      highlights: [{ seconds: 15, title: 'Stelle', description: '' }],
    };
    // Die Sichtung der Bildpakete antwortet nach dem Bildschema, erst die Zusammenfassung
    // nach dem Analyseschema. Die Attrappe unterscheidet beides am mitgesendeten Format.
    const batch = (count: number) => ({
      frames: Array.from({ length: count }, (_, frame) => ({
        frame,
        kind: frame === count - 1 ? 'result' : 'gameplay',
        observation: 'Sichtbare Handlung',
        visibleText: '',
      })),
    });
    const requests: {
      messages: { images: string[] }[];
      keep_alive: number;
      format: { properties?: Record<string, unknown> };
    }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        requests.push(body);
        const classifying = !!body.format?.properties?.frames;
        return Response.json({
          message: {
            content: JSON.stringify(classifying ? batch(imagesOf(body).length) : result),
          },
        });
      }),
    );
    const analyzer = new LocalAnalyzer({
      url: 'http://127.0.0.1:11434',
      model: 'test-model',
      frames: 24,
      cacheDir: root,
      media,
      isPaused: () => false,
    });
    const output = await analyzer.analyze('test-only.mp4', 'Spiel');
    // Zwei Sichtungspakete zu vier Bildern, dann die Zusammenfassung mit genau einem
    // Belegbild in voller Auflösung, zuletzt das Entladen des Modells.
    expect(requests.map((r) => imagesOf(r).length)).toEqual([4, 4, 1, 0]);
    expect(requests.map((r) => r.keep_alive)).toEqual([60, 60, 60, 0]);
    // Tags wählt das Modell nicht mehr; ohne gelesene Meldung gibt es keine.
    expect(requests[2].format.properties).not.toHaveProperty('tags');
    expect(output.result.tags).toEqual([]);
    expect(output.result.game).toBe('Spiel');
    expect(output.result.confidence).toBe('medium');
    expect(await readdir(root)).toHaveLength(0);
    const paused = new LocalAnalyzer({ ...analyzer.options, isPaused: () => true });
    await expect(paused.chat('test')).rejects.toThrow('pausiert');
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-analysis-'))
      await rm(root, { recursive: true, force: true });
  }
});

it('never focuses a loading screen and names the player only when known', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-analysis-'));
  try {
    const media = new MediaProcessor({});
    vi.spyOn(media, 'probe').mockResolvedValue({
      duration: 15,
      width: 1920,
      height: 1080,
      codec: 'h264',
      hasAudio: true,
      audio: [],
    });
    // Erste vier Bilder Ladebildschirm, danach Spielgeschehen — wie bei einem echten
    // NVIDIA-Automatikclip (.docs/README.md, Testmaterial FN-15).
    vi.spyOn(media, 'frames').mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({ seconds: i * 2, base64: `bild-${i}` })),
    );
    const focusSeconds: number[] = [];
    vi.spyOn(media, 'frameAt').mockImplementation(async (_clip, _dir, seconds) => {
      focusSeconds.push(seconds);
      return 'focus-image';
    });
    const prompts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        if (!body.messages.length) return Response.json({ done: true });
        prompts.push(body.messages[0]?.content ?? '');
        if (!body.format?.properties?.frames)
          return Response.json({ message: { content: JSON.stringify(validResult) } });
        const images = imagesOf(body);
        const offset = Number(images[0].split('-')[1]);
        return Response.json({
          message: {
            content: JSON.stringify({
              frames: images.map((_: string, frame: number) => ({
                frame,
                kind: offset + frame < 4 ? 'loading' : 'gameplay',
                observation: 'Bild',
                visibleText: '',
              })),
            }),
          },
        });
      }),
    );
    const options = {
      url: 'http://127.0.0.1:11434',
      model: 'test-model',
      frames: 24,
      cacheDir: root,
      media,
      isPaused: () => false,
    };
    await new LocalAnalyzer(options).analyze('test-only.mp4', 'Fortnite');
    // Das Ladebild bei Sekunde 0 darf den Beleg nicht stellen, obwohl es im Schlussfenster
    // eines 15-Sekunden-Clips liegen könnte.
    expect(focusSeconds[0]).toBeGreaterThanOrEqual(8);
    expect(prompts.at(-1)).toContain('Spielername ist unbekannt');
    expect(prompts.at(-1)).toContain('Bildschirm des Nutzers');
    expect(prompts.at(-1)).not.toContain('SpielerEins');

    await new LocalAnalyzer({ ...options, playerName: 'SpielerEins' }).analyze(
      'test-only.mp4',
      'Fortnite',
    );
    expect(prompts.at(-1)).toContain('SpielerEins');
    expect(prompts.at(-1)).toContain('Killfeed-Eintrag');
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-analysis-'))
      await rm(root, { recursive: true, force: true });
  }
});

it('names only the player names that belong to the clip game', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-analysis-'));
  try {
    const media = new MediaProcessor({});
    vi.spyOn(media, 'probe').mockResolvedValue({
      duration: 15,
      width: 1920,
      height: 1080,
      codec: 'h264',
      hasAudio: true,
      audio: [],
    });
    vi.spyOn(media, 'frames').mockResolvedValue(
      Array.from({ length: 4 }, (_, i) => ({ seconds: i * 4, base64: `bild-${i}` })),
    );
    vi.spyOn(media, 'frameAt').mockResolvedValue('focus-image');
    const prompts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        if (!body.messages.length) return Response.json({ done: true });
        prompts.push(body.messages[0]?.content ?? '');
        if (!body.format?.properties?.frames)
          return Response.json({ message: { content: JSON.stringify(validResult) } });
        return Response.json({
          message: {
            content: JSON.stringify({
              frames: imagesOf(body).map((_: string, frame: number) => ({
                frame,
                kind: 'gameplay',
                observation: 'Bild',
                visibleText: '',
              })),
            }),
          },
        });
      }),
    );
    const traces: AnalysisTrace[] = [];
    const analyzer = new LocalAnalyzer({
      url: 'http://127.0.0.1:11434',
      model: 'test-model',
      frames: 24,
      cacheDir: root,
      media,
      isPaused: () => false,
      onTrace: (trace) => traces.push(trace),
      playerNames: [
        { name: 'SpielerEins', game: 'Fortnite' },
        { name: 'SpielerZwei', game: "Tom Clancy's Rainbow Six Siege" },
        { name: 'SpielerDrei', game: 'R6' },
      ],
    });
    await analyzer.analyze('Fortnite/clip.mp4', 'Fortnite');
    // Mit genau einem Namen bleibt der Satz wie bisher.
    expect(prompts.at(-1)).toContain('Er spielt als "SpielerEins"');
    expect(prompts.at(-1)).not.toContain('SpielerZwei');
    expect(traces.at(-1)?.playerNames).toEqual(['SpielerEins']);

    await analyzer.analyze('R6/clip.mp4', "Tom Clancy's Rainbow Six Siege");
    expect(prompts.at(-1)).toContain('einem dieser Namen: "SpielerZwei", "SpielerDrei"');
    expect(prompts.at(-1)).not.toContain('SpielerEins');

    await analyzer.analyze('Valorant/clip.mp4', 'VALORANT');
    expect(prompts.at(-1)).toContain('Spielername ist unbekannt');
    expect(traces.at(-1)?.playerNames).toEqual([]);

    // Der frühere Einzelname gilt weiter, in jedem Spiel.
    await new LocalAnalyzer({ ...analyzer.options, playerName: 'SpielerVier' }).analyze(
      'Valorant/clip.mp4',
      'VALORANT',
    );
    expect(prompts.at(-1)).toContain('Er spielt als "SpielerVier"');
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-analysis-'))
      await rm(root, { recursive: true, force: true });
  }
});

it.each([
  ['Gegner in der Halle ausgeschaltet', 'Gegner in der Halle ausgeschaltet'],
  // Besteht auch die zweite Fassung nicht, trägt das belegte Ereignis den Titel.
  ['Tod am Ende', 'Gegner ausgeschaltet'],
])(
  'survives misnumbered batches, tags what the screen proves, and corrects a contradicting title (%s)',
  async (secondTitle, expectedTitle) => {
    const root = await mkdtemp(join(tmpdir(), 'replayhaven-analysis-'));
    try {
      const media = new MediaProcessor({});
      vi.spyOn(media, 'probe').mockResolvedValue({
        duration: 20,
        width: 1920,
        height: 1080,
        codec: 'h264',
        hasAudio: true,
        audio: [],
      });
      vi.spyOn(media, 'frames').mockResolvedValue(
        Array.from({ length: 8 }, (_, i) => ({ seconds: i * 2.5, base64: `bild-${i}` })),
      );
      vi.spyOn(media, 'frameAt').mockResolvedValue('focus-image');
      const summaries: {
        format: { properties: Record<string, unknown> };
        messages: { role: string; content: string }[];
      }[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init: RequestInit) => {
          const body = JSON.parse(init.body as string);
          if (!body.messages.length) return Response.json({ done: true });
          const images = imagesOf(body);
          if (body.format?.properties?.frames) {
            const offset = Number(images[0].split('-')[1]);
            // Wie im Vorher-Lauf beobachtet: das Modell zählt über Pakete hinweg weiter.
            return Response.json({
              message: {
                content: JSON.stringify({
                  frames: images.map((_: string, i: number) => ({
                    frame: offset + i,
                    kind: 'gameplay',
                    observation: 'Spielansicht',
                    visibleText: offset + i === 6 ? 'ELIMINIERT: Gegner' : '',
                  })),
                }),
              },
            });
          }
          summaries.push(body);
          const title = summaries.length === 1 ? 'Tod durch Feuerwaffe' : secondTitle;
          return Response.json({
            message: {
              thinking: JSON.stringify({
                title,
                description: 'Du triffst den Gegner. Bildstichprobe aus Sekunde 15.00.',
                uncertainty: 'Die Beobachtungen sind unzuverlässig.',
                highlights: [{ seconds: 16, title: 'Tod durch Feuerwaffe', description: '' }],
              }),
            },
          });
        }),
      );
      const output = await new LocalAnalyzer({
        url: 'http://127.0.0.1:11434',
        model: 'test-model',
        frames: 24,
        cacheDir: root,
        media,
        isPaused: () => false,
      }).analyze('Fortnite 2025.02.14 - 16.55.58.18.Eliminierung.DVR.mp4', 'Fortnite');
      expect(summaries[0].messages[0].content).toContain('Du hast einen Gegner ausgeschaltet');
      expect(summaries[1].messages.at(-1)?.content).toContain('behauptet deinen Tod');
      expect(output.result).toMatchObject({
        title: expectedTitle,
        tags: ['Kill'],
        confidence: 'high',
        description: 'Du triffst den Gegner.',
        uncertainty: '',
        highlights: [{ seconds: 11.5, title: 'Gegner ausgeschaltet' }],
      });
    } finally {
      if (
        resolve(root).startsWith(resolve(tmpdir()) + sep) &&
        root.includes('replayhaven-analysis-')
      )
        await rm(root, { recursive: true, force: true });
    }
  },
);

it('retries a batch with the wrong number of frames and keeps what it can', async () => {
  // Im Nachher-Lauf vom 2026-09-23 kam dieser Fehler als ZodError, der in zod 4 kein
  // instanceof Error ist — die Wiederholung griff deshalb nie (.docs/05-experimente.md, E17).
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-analysis-'));
  try {
    const media = new MediaProcessor({});
    vi.spyOn(media, 'probe').mockResolvedValue({
      duration: 20,
      width: 1920,
      height: 1080,
      codec: 'h264',
      hasAudio: true,
      audio: [],
    });
    vi.spyOn(media, 'frames').mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({ seconds: i * 2.5, base64: `bild-${i}` })),
    );
    vi.spyOn(media, 'frameAt').mockResolvedValue('focus-image');
    const batchCalls: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        if (!body.messages.length) return Response.json({ done: true });
        if (!body.format?.properties?.frames)
          return Response.json({ message: { content: JSON.stringify(validResult) } });
        const images = imagesOf(body);
        const offset = Number(images[0].split('-')[1]);
        batchCalls.push(offset);
        // Das erste Paket kommt zweimal mit einem Bild zu wenig zurück.
        const listed = offset === 0 ? images.slice(0, 3) : images;
        return Response.json({
          message: {
            content: JSON.stringify({
              frames: listed.map((_: string, frame: number) => ({
                frame,
                kind: 'gameplay',
                observation: `Bild ${offset + frame}`,
                visibleText: '',
              })),
            }),
          },
        });
      }),
    );
    let trace: AnalysisTrace | undefined;
    const output = await new LocalAnalyzer({
      url: 'http://127.0.0.1:11434',
      model: 'test-model',
      frames: 24,
      cacheDir: root,
      media,
      isPaused: () => false,
      onTrace: (t) => (trace = t),
    }).analyze('test-only.mp4', 'Valorant');
    expect(batchCalls).toEqual([0, 0, 4]);
    expect(trace?.lostFrames).toBe(1);
    expect(trace?.frames.map((f) => f.observation)).toEqual([
      'Bild 0',
      'Bild 1',
      'Bild 2',
      '',
      'Bild 4',
      'Bild 5',
      'Bild 6',
      'Bild 7',
    ]);
    expect(output.result.uncertainty).toMatch(/nicht auswerten/);
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-analysis-'))
      await rm(root, { recursive: true, force: true });
  }
});

const validResult = {
  title: 'Runde gewonnen',
  description: 'Die Rundenmeldung ist sichtbar.',
  game: 'Fortnite',
  tags: ['Sieg'],
  confidence: 'medium',
  uncertainty: 'Bildstichprobe',
  highlights: [],
};

it.each([
  { content: JSON.stringify(validResult), thinking: 'Unstructured reasoning' },
  { content: '', thinking: JSON.stringify(validResult) },
  {
    content: '  ',
    thinking: `\u0060\u0060\u0060json\n${JSON.stringify(validResult)}\n\u0060\u0060\u0060`,
  },
])('accepts schema-valid content or the Ollama thinking fallback: %#', async (message) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ message })));
  const analyzer = new LocalAnalyzer({
    url: 'http://127.0.0.1:11434',
    model: 'test-model',
    frames: 24,
    cacheDir: tmpdir(),
    media: new MediaProcessor({}),
    isPaused: () => false,
  });
  expect(await analyzer.chat('test')).toEqual(validResult);
});

it.each(['I should describe the image.', '{"title":"incomplete"}', ''])(
  'rejects thinking output that is not a complete analysis: %s',
  async (thinking) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ message: { content: '', thinking } })),
    );
    const analyzer = new LocalAnalyzer({
      url: 'http://127.0.0.1:11434',
      model: 'test-model',
      frames: 24,
      cacheDir: tmpdir(),
      media: new MediaProcessor({}),
      isPaused: () => false,
    });
    await expect(analyzer.chat('test')).rejects.toThrow();
  },
);

it.each(['pause', 'abort', 'invalid-json', 'http-error', 'summary-error', 'unload-error'])(
  'releases the retained model and work files after %s without hiding the failure',
  async (failure) => {
    const root = await mkdtemp(join(tmpdir(), 'replayhaven-analysis-'));
    try {
      const media = new MediaProcessor({});
      vi.spyOn(media, 'probe').mockResolvedValue({
        duration: 120,
        width: 1920,
        height: 1080,
        codec: 'h264',
        hasAudio: true,
        audio: [],
      });
      vi.spyOn(media, 'frames').mockResolvedValue(
        Array.from({ length: 8 }, (_, i) => ({ seconds: i * 15, base64: 'test-image' })),
      );
      vi.spyOn(media, 'frameAt').mockResolvedValue('focus-image');
      const aborter = new AbortController();
      const originalError = new Error('Original inference failure');
      let paused = false;
      let inferenceCalls = 0;
      let unloadCalls = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init: RequestInit) => {
          const request = JSON.parse(init.body as string);
          if (!request.messages.length) {
            unloadCalls++;
            expect(request.keep_alive).toBe(0);
            expect(request.model).toBe('test-model');
            expect(init.signal).not.toBe(aborter.signal);
            expect(init.signal?.aborted).toBe(false);
            if (failure === 'unload-error') throw new Error('Cleanup failure');
            return Response.json({ done: true });
          }
          inferenceCalls++;
          if (failure === 'pause') paused = true;
          if (failure === 'abort') {
            aborter.abort(originalError);
            init.signal?.throwIfAborted();
          }
          if (failure === 'http-error') return new Response('', { status: 503 });
          if (failure === 'invalid-json')
            return Response.json({ message: { content: '', thinking: 'Not JSON' } });
          if (failure === 'unload-error' || (failure === 'summary-error' && inferenceCalls === 3))
            throw originalError;
          // Sichtungsaufrufe tragen das Bildschema, die Zusammenfassung das Analyseschema.
          const classifying = !!request.format?.properties?.frames;
          return Response.json({
            message: {
              content: JSON.stringify(
                classifying
                  ? {
                      frames: imagesOf(request).map((_: string, frame: number) => ({
                        frame,
                        kind: 'gameplay',
                        observation: 'Sichtbare Handlung',
                        visibleText: '',
                      })),
                    }
                  : validResult,
              ),
            },
          });
        }),
      );
      const analyzer = new LocalAnalyzer({
        url: 'http://127.0.0.1:11434',
        model: 'test-model',
        frames: 24,
        cacheDir: root,
        media,
        isPaused: () => paused,
        signal: aborter.signal,
      });
      const analysis = analyzer.analyze('test-only.mp4', 'Fortnite');
      if (failure === 'pause') await expect(analysis).rejects.toBeInstanceOf(PausedError);
      else if (failure === 'http-error') await expect(analysis).rejects.toThrow('HTTP 503');
      else if (failure === 'invalid-json')
        await expect(analysis).rejects.toBeInstanceOf(SyntaxError);
      else await expect(analysis).rejects.toBe(originalError);
      // Unlesbare Antworten werden einmal wiederholt. Gehen danach mehr als ein Viertel der
      // Bilder verloren, bricht die Analyse ab, statt ein Ergebnis aus Lücken zu liefern.
      expect(inferenceCalls).toBe(
        failure === 'summary-error' ? 3 : failure === 'invalid-json' ? 2 : 1,
      );
      expect(unloadCalls).toBe(1);
      expect(await readdir(root)).toHaveLength(0);
    } finally {
      if (
        resolve(root).startsWith(resolve(tmpdir()) + sep) &&
        root.includes('replayhaven-analysis-')
      )
        await rm(root, { recursive: true, force: true });
    }
  },
);

it('does no media or model work when analysis is already paused', async () => {
  const media = new MediaProcessor({});
  const probe = vi.spyOn(media, 'probe');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const analyzer = new LocalAnalyzer({
    url: 'http://127.0.0.1:11434',
    model: 'test-model',
    frames: 24,
    cacheDir: tmpdir(),
    media,
    isPaused: () => true,
  });
  await expect(analyzer.analyze('test-only.mp4', 'Fortnite')).rejects.toBeInstanceOf(PausedError);
  expect(probe).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('takes kills from the replay, asks for the detail and waits while the match runs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-analysis-'));
  try {
    const media = new MediaProcessor({});
    vi.spyOn(media, 'probe').mockResolvedValue({
      duration: 20,
      width: 1920,
      height: 1080,
      codec: 'h264',
      hasAudio: true,
      audio: [],
    });
    const frames = vi
      .spyOn(media, 'frames')
      .mockResolvedValue(
        Array.from({ length: 8 }, (_, i) => ({ seconds: i * 2.5, base64: `bild-${i}` })),
      );
    vi.spyOn(media, 'frameAt').mockResolvedValue('focus-image');
    const summaries: { messages: { content: string }[] }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        if (!body.messages.length) return Response.json({ done: true });
        const images = imagesOf(body);
        if (body.format?.properties?.frames) {
          const offset = Number(images[0].split('-')[1]);
          // Die Meldung eines beobachteten Mitspielers: Das Replay weiß es besser.
          return Response.json({
            message: {
              content: JSON.stringify({
                frames: images.map((_: string, i: number) => ({
                  frame: i,
                  kind: 'gameplay',
                  observation: 'Kampf im Turm',
                  visibleText: offset + i === 2 ? 'ELIMINIERT: Fremder' : '',
                })),
              }),
            },
          });
        }
        summaries.push(body);
        return Response.json({
          message: {
            content: JSON.stringify({
              title: summaries.length === 1 ? 'Kill im Turm' : 'Doppel-Kill im Turm',
              description: 'Du räumst den Turm.',
              uncertainty: '',
              highlights: [],
            }),
          },
        });
      }),
    );
    const found: ReplayLookup = {
      status: 'ok',
      events: [
        { kind: 'kill', seconds: 14, text: '', source: 'replay', weapon: 'shotgun', distance: 4 },
        { kind: 'kill', seconds: 17, text: '', source: 'replay', weapon: 'shotgun', distance: 6 },
        { kind: 'multikill', seconds: 17, text: '', source: 'replay', weapon: 'shotgun', count: 2 },
      ],
      trace: { status: 'ok', file: 'UnsavedReplay-3.replay', owner: 'a1'.repeat(16) },
    };
    let lookup = found;
    const replays = vi.fn(async () => lookup);
    let trace: AnalysisTrace | undefined;
    const analyzer = new LocalAnalyzer({
      url: 'http://127.0.0.1:11434',
      model: 'test-model',
      frames: 24,
      cacheDir: root,
      media,
      isPaused: () => false,
      onTrace: (t) => (trace = t),
      replays,
    });
    const output = await analyzer.analyze('Fortnite 2026.09.24 - 21.10.00.07.DVR.mp4', 'Fortnite');
    expect(replays).toHaveBeenCalledWith(
      'Fortnite 2026.09.24 - 21.10.00.07.DVR.mp4',
      'Fortnite',
      20,
    );
    expect(summaries[0].messages[0].content).toContain(
      'Du hast zwei Gegner kurz nacheinander mit der Schrotflinte ausgeschaltet',
    );
    expect(summaries[0].messages[0].content).toContain('Spielereignis aus dem Fortnite-Replay');
    // "Kill im Turm" lässt die Serie weg und bekommt eine Rückfrage.
    expect(summaries[1].messages.at(-1)?.content).toContain('lässt das Besondere am Ereignis weg');
    expect(output.result).toMatchObject({
      title: 'Doppel-Kill im Turm',
      tags: ['Kill', 'Multikill'],
      confidence: 'high',
      highlights: [
        { seconds: 13, title: 'Kill mit der Schrotflinte' },
        { seconds: 16, title: 'Doppel-Kill mit der Schrotflinte' },
      ],
    });
    expect(trace?.events.filter((e) => e.source === 'screen')).toEqual([]);
    expect(trace?.replay).toMatchObject({ status: 'ok', file: 'UnsavedReplay-3.replay' });

    // Läuft das Match noch, wartet der Clip, ohne Bilder oder Modell zu bemühen.
    lookup = { status: 'wait', events: [], trace: { status: 'wait' } };
    frames.mockClear();
    const calls = vi.mocked(fetch).mock.calls.length;
    await expect(
      analyzer.analyze('Fortnite 2026.09.24 - 21.10.00.07.DVR.mp4', 'Fortnite'),
    ).rejects.toBeInstanceOf(DeferredError);
    expect(frames).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls);

    // Ein unlesbares Replay kostet nur die Replay-Ereignisse.
    replays.mockRejectedValueOnce(new Error('Datei gesperrt'));
    frames.mockClear();
    await analyzer.analyze('Fortnite 2026.09.24 - 21.10.00.07.DVR.mp4', 'Fortnite');
    expect(frames).toHaveBeenCalled();
    expect(trace?.replay).toEqual({
      status: 'none',
      reason: 'Replay nicht lesbar: Datei gesperrt',
    });
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-analysis-'))
      await rm(root, { recursive: true, force: true });
  }
});

it('names the recognised R6 map and rejects another one', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-analysis-'));
  try {
    const media = new MediaProcessor({});
    vi.spyOn(media, 'probe').mockResolvedValue({
      duration: 20,
      width: 1920,
      height: 1080,
      codec: 'h264',
      hasAudio: true,
      audio: [],
    });
    vi.spyOn(media, 'frames').mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({ seconds: i * 2.5, base64: `bild-${i}` })),
    );
    vi.spyOn(media, 'frameAt').mockResolvedValue('focus-image');
    const summaries: { messages: { content: string }[] }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        if (!body.messages.length) return Response.json({ done: true });
        if (body.format?.properties?.frames)
          return Response.json({
            message: {
              content: JSON.stringify({
                frames: imagesOf(body).map((_: string, i: number) => ({
                  frame: i,
                  kind: 'gameplay',
                  observation: 'Kampf',
                  visibleText: '',
                })),
              }),
            },
          });
        summaries.push(body);
        return Response.json({
          message: {
            content: JSON.stringify({
              title: summaries.length === 1 ? 'Rundensieg auf Bank' : 'Rundensieg auf Oregon',
              description: 'Dein Team holt die Runde.',
              uncertainty: '',
              highlights: [],
            }),
          },
        });
      }),
    );
    const texts = vi.fn(async (_path: string, _game: string, signal: AbortSignal) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      return {
        map: 'Oregon',
        events: [
          { kind: 'roundWon' as const, seconds: 18, text: 'ROUND WON', source: 'ocr' as const },
        ],
        trace: { frames: 40, seconds: 12.5, map: 'Oregon', events: 1 },
      };
    });
    let trace: AnalysisTrace | undefined;
    const output = await new LocalAnalyzer({
      url: 'http://127.0.0.1:11434',
      model: 'test-model',
      frames: 24,
      cacheDir: root,
      media,
      isPaused: () => false,
      onTrace: (t) => (trace = t),
      texts,
    }).analyze(
      "R6/Tom Clancy's Rainbow Six Siege 2026.09.24 - 20.00.00.01.DVR.mp4",
      "Tom Clancy's Rainbow Six Siege",
    );
    expect(summaries[0].messages[0].content).toContain('Die Karte ist Oregon');
    expect(summaries[0].messages[0].content).toContain('Beleg: Texterkennung "ROUND WON"');
    expect(summaries[1].messages.at(-1)?.content).toContain('erkannt wurde Oregon');
    expect(output.result).toMatchObject({
      title: 'Rundensieg auf Oregon',
      tags: ['Rundensieg'],
      confidence: 'high',
      highlights: [{ seconds: 18, title: 'Runde gewonnen' }],
    });
    expect(trace?.texts).toEqual({ frames: 40, seconds: 12.5, map: 'Oregon', events: 1 });
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-analysis-'))
      await rm(root, { recursive: true, force: true });
  }
});

it('stops the text recognition when the analysis fails', async () => {
  const media = new MediaProcessor({});
  vi.spyOn(media, 'probe').mockResolvedValue({
    duration: 20,
    width: 1920,
    height: 1080,
    codec: 'h264',
    hasAudio: true,
    audio: [],
  });
  vi.spyOn(media, 'frames').mockRejectedValue(new Error('Keine Bilder'));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ done: true })),
  );
  let stopped: AbortSignal | undefined;
  const texts = vi.fn(
    (_path: string, _game: string, signal: AbortSignal) =>
      new Promise<undefined>((done) => {
        stopped = signal;
        signal.addEventListener('abort', () => done(undefined));
      }),
  );
  await expect(
    new LocalAnalyzer({
      url: 'http://127.0.0.1:11434',
      model: 'test-model',
      frames: 24,
      cacheDir: tmpdir(),
      media,
      isPaused: () => false,
      texts,
    }).analyze('R6/clip.mp4', 'R6'),
  ).rejects.toThrow('Keine Bilder');
  expect(stopped?.aborted).toBe(true);
});

it('does not lock the map when the text recognition failed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-analysis-'));
  try {
    const media = new MediaProcessor({});
    vi.spyOn(media, 'probe').mockResolvedValue({
      duration: 20,
      width: 1920,
      height: 1080,
      codec: 'h264',
      hasAudio: true,
      audio: [],
    });
    vi.spyOn(media, 'frames').mockResolvedValue(
      Array.from({ length: 4 }, (_, i) => ({ seconds: i * 5, base64: `bild-${i}` })),
    );
    vi.spyOn(media, 'frameAt').mockResolvedValue('focus-image');
    const summaries: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        if (!body.messages.length) return Response.json({ done: true });
        if (body.format?.properties?.frames)
          return Response.json({
            message: {
              content: JSON.stringify({
                frames: imagesOf(body).map((_: string, i: number) => ({
                  frame: i,
                  kind: 'gameplay',
                  observation: 'Kampf',
                  visibleText: '',
                })),
              }),
            },
          });
        summaries.push(body);
        return Response.json({
          message: {
            content: JSON.stringify({
              title: 'Kampf um die Treppe auf Bank',
              description: 'Du verteidigst die Treppe.',
              uncertainty: '',
              highlights: [],
            }),
          },
        });
      }),
    );
    const output = await new LocalAnalyzer({
      url: 'http://127.0.0.1:11434',
      model: 'test-model',
      frames: 24,
      cacheDir: root,
      media,
      isPaused: () => false,
      texts: async () => {
        throw new Error('ONNX Runtime fehlt');
      },
    }).analyze('R6/clip.mp4', "Tom Clancy's Rainbow Six Siege");
    expect(summaries).toHaveLength(1);
    expect(output.result.title).toBe('Kampf um die Treppe auf Bank');
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-analysis-'))
      await rm(root, { recursive: true, force: true });
  }
});
