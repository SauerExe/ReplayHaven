import { afterEach, expect, it, vi } from 'vitest';
import { LocalAnalyzer, validateLocalOllama } from './ollama';
import { MediaProcessor } from '../server/media';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
afterEach(() => vi.unstubAllGlobals());
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
    const result = {
      title: 'Testtitel',
      description: 'Testbeobachtung',
      game: 'Spiel',
      tags: ['Tag'],
      confidence: 'high',
      uncertainty: 'Bildstichprobe',
      highlights: [{ seconds: 15, title: 'Stelle', description: '' }],
    };
    const requests: { messages: { images: string[] }[]; keep_alive: number }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(init.body as string));
        return Response.json({ message: { content: JSON.stringify(result) } });
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
    expect(requests.map((r) => r.messages[0].images.length)).toEqual([4, 4, 0]);
    expect(output.result.confidence).toBe('medium');
    expect(await readdir(root)).toHaveLength(0);
    const paused = new LocalAnalyzer({ ...analyzer.options, isPaused: () => true });
    await expect(paused.chat('test')).rejects.toThrow('pausiert');
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-analysis-'))
      await rm(root, { recursive: true, force: true });
  }
});
