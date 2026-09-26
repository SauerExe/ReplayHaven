import { utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import type { SpeechReply, SpeechRequest, SpeechWorkerData } from '../agent/speech-worker';
import type { Transcript } from '../agent/speech';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * Speech recognition (agent/speech-worker.ts) in its own process. It starts on the first
 * request and keeps the models until close(); if it dies, pending requests fail and the next
 * one restarts it.
 */
export class SpeechProcess {
  private child?: UtilityProcess;
  private next = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      progress?: (file: string) => void;
    }
  >();
  constructor(private readonly options: { script: string; data: SpeechWorkerData }) {}

  /** Downloads missing models (about 670 MB, once) and reports each file as it downloads. */
  prepare(onDownload?: (file: string) => void) {
    return this.request({ type: 'prepare' }, undefined, onDownload) as Promise<boolean>;
  }

  transcribe(path: string, signal?: AbortSignal) {
    return this.request({ type: 'clip', path }, signal) as Promise<Transcript>;
  }

  close() {
    const child = this.child;
    this.child = undefined;
    this.fail(new Error('Speech recognition stopped.'));
    child?.kill();
  }

  private start() {
    if (this.child) return this.child;
    const child = utilityProcess.fork(this.options.script, [JSON.stringify(this.options.data)], {
      serviceName: 'ReplayHaven Speech Recognition',
      stdio: 'ignore',
    });
    child.on('message', (reply: SpeechReply) => {
      const waiting = this.pending.get(reply.id);
      if (!waiting) return;
      if (reply.progress) return waiting.progress?.(reply.progress);
      this.pending.delete(reply.id);
      if (reply.error !== undefined) waiting.reject(new Error(reply.error));
      else waiting.resolve(reply.value);
    });
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.fail(new Error(`Speech recognition stopped unexpectedly (code ${code}).`));
    });
    this.child = child;
    return child;
  }

  private fail(error: Error) {
    for (const waiting of this.pending.values()) waiting.reject(error);
    this.pending.clear();
  }

  private request(
    message: DistributiveOmit<SpeechRequest, 'id'>,
    signal?: AbortSignal,
    progress?: (file: string) => void,
  ) {
    const child = this.start();
    const id = this.next++;
    const abort = () => child.postMessage({ id, type: 'abort' } satisfies SpeechRequest);
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, progress });
      child.postMessage({ ...message, id });
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    }).finally(() => signal?.removeEventListener('abort', abort));
  }
}
