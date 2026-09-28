import { expect, it } from 'vitest';
import { ParakeetSpeech, untilAborted } from './parakeet';
import type { MediaProcessor } from '../server/media';

const track = (index: number) => ({
  index,
  codec: 'aac',
  channels: 1,
  sampleRate: 48000,
  title: '',
});

/** Media stand-in: probe and levels from the lists, pcm as given; records what was read. */
function media(max: number[], pcm: () => Promise<Float32Array[]>) {
  const read: number[] = [];
  const fake = {
    probe: async () => ({ audio: max.map((_, i) => track(i)) }),
    audioLevels: async (_path: string, index: number) => ({ mean: max[index], max: max[index] }),
    pcm: (_path: string, index: number) => {
      read.push(index);
      return pcm();
    },
  };
  return { media: fake as unknown as MediaProcessor, read };
}
const models = { encoder: '', decoder: '', joiner: '', tokens: '', vad: '' };
// A runtime that does not exist: a test that got as far as loading the model would fail.
const runtime = 'replayhaven-no-such-runtime';

it('skips speech when several tracks have sound and none is the microphone', async () => {
  const { media: fake, read } = media([-12, -20, -30], async () => [new Float32Array(16000)]);
  const speech = new ParakeetSpeech({ media: fake, models, runtime });
  const result = await speech.transcribe('clip.mp4');
  expect(result.segments).toEqual([]);
  expect(read).toEqual([]);
  // All tracks silent: nothing to transcribe either.
  const silent = media([-91, -95], async () => [new Float32Array(16000)]);
  await new ParakeetSpeech({ media: silent.media, models, runtime }).transcribe('clip.mp4');
  expect(silent.read).toEqual([]);
});

it('returns at once when cancelled while the audio is read', async () => {
  const { media: fake, read } = media([-91, -15], () => new Promise(() => {}));
  const speech = new ParakeetSpeech({ media: fake, models, runtime });
  const control = new AbortController();
  const running = speech.transcribe('clip.mp4', control.signal);
  await new Promise((done) => setTimeout(done, 10));
  // The only audible track is read, not the silent first one.
  expect(read).toEqual([1]);
  control.abort();
  await expect(running).rejects.toThrow(/cancelled/);
  await expect(untilAborted(Promise.resolve(1), AbortSignal.abort())).rejects.toThrow(/cancelled/);
  await expect(untilAborted(Promise.resolve(1), control.signal)).rejects.toThrow(/cancelled/);
  await expect(untilAborted(Promise.resolve(2), new AbortController().signal)).resolves.toBe(2);
});
