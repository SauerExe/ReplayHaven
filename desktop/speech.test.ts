import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import type { SpeechRequest } from '../agent/speech-worker';

/** A stand-in for Electron's utility process: records messages, answers only when told. */
class FakeChild extends EventEmitter {
  sent: SpeechRequest[] = [];
  killed = false;
  postMessage(message: SpeechRequest) {
    this.sent.push(message);
  }
  kill() {
    this.killed = true;
    return true;
  }
}
const children: FakeChild[] = [];
vi.mock('electron', () => ({
  utilityProcess: {
    fork: () => {
      const child = new FakeChild();
      children.push(child);
      return child;
    },
  },
}));

const { SpeechProcess } = await import('./speech');
const speech = (timeouts?: { clip?: number; prepare?: number }) =>
  new SpeechProcess({
    script: 'worker.cjs',
    data: { folder: '', runtime: '', ffmpeg: '', ffprobe: '' },
    timeouts,
  });

afterEach(() => {
  children.length = 0;
  vi.useRealTimers();
});

it('answers requests and fails them when the process dies or reports a fatal error', async () => {
  const process = speech();
  const first = process.transcribe('a.mp4');
  const child = children[0];
  const id = child.sent[0].id;
  child.emit('message', { id, value: { segments: [] } });
  await expect(first).resolves.toEqual({ segments: [] });
  // A fatal error without an exit: pending requests fail, the next one starts a new process.
  const second = process.transcribe('b.mp4');
  child.emit('error', 'FatalError', '', '');
  await expect(second).rejects.toThrow(/stopped unexpectedly \(FatalError\)/);
  expect(child.killed).toBe(true);
  // The late exit of the old process does not touch the new one.
  const third = process.transcribe('c.mp4');
  expect(children).toHaveLength(2);
  child.emit('exit', 1);
  const next = children[1];
  next.emit('message', { id: next.sent[0].id, value: 'done' });
  await expect(third).resolves.toBe('done');
  const fourth = process.transcribe('d.mp4');
  next.emit('exit', 5);
  await expect(fourth).rejects.toThrow(/code 5/);
});

it('fails a cancelled request at once and tells only its own process', async () => {
  const process = speech();
  const control = new AbortController();
  const request = process.transcribe('a.mp4', control.signal);
  const child = children[0];
  control.abort();
  await expect(request).rejects.toThrow(/cancelled/);
  expect(child.sent.map((m) => m.type)).toEqual(['clip', 'abort']);
  // A late answer is ignored.
  child.emit('message', { id: child.sent[0].id, value: 'late' });
  // After the process died, a cancel does not write to the old one.
  const other = new AbortController();
  const again = process.transcribe('b.mp4', other.signal);
  child.emit('exit', 1);
  await expect(again).rejects.toThrow(/stopped unexpectedly/);
  other.abort();
  expect(child.sent.map((m) => m.type)).toEqual(['clip', 'abort', 'clip']);
  // Already cancelled before the start.
  await expect(process.transcribe('c.mp4', AbortSignal.abort())).rejects.toThrow(/cancelled/);
});

it('gives up a hung request and starts a fresh process for the next one', async () => {
  vi.useFakeTimers();
  const process = speech({ clip: 1000 });
  const request = process.transcribe('a.mp4');
  const failed = expect(request).rejects.toThrow(/took longer/);
  await vi.advanceTimersByTimeAsync(1001);
  await failed;
  expect(children[0].killed).toBe(true);
  void process.transcribe('b.mp4').catch(() => {});
  expect(children).toHaveLength(2);
  process.close();
});
