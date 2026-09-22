import { afterEach, expect, it, vi } from 'vitest';
import { LocalAnalyzer, PausedError, validateLocalOllama } from './ollama';
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
    // Belegbild in voller Auflösung statt wie früher ganz ohne Bild.
    expect(requests.map((r) => imagesOf(r).length)).toEqual([4, 4, 1]);
    expect(requests.map((r) => r.keep_alive)).toEqual([60, 60, 0]);
    // Die Zusammenfassung bindet die Tags an das Vokabular, damit Filter in der Bibliothek
    // greifen; freie Tags bleiben nur beim Bearbeiten von Hand erlaubt.
    const summaryTags = (
      requests.at(-1)?.format as { properties?: { tags?: { items?: { enum?: string[] } } } }
    )?.properties?.tags?.items?.enum;
    expect(summaryTags).toContain('Clutch');
    expect(summaryTags).toContain('Kein Ereignis');
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
      expect(inferenceCalls).toBe(failure === 'summary-error' ? 3 : 1);
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
