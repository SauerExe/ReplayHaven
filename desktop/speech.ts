import { utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import type { SpeechReply, SpeechRequest, SpeechWorkerData } from '../agent/speech-worker';
import type { Transcript } from '../agent/speech';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Longest a clip may take, including a model download the prepare step did not finish. */
const CLIP_TIMEOUT_MS = 30 * 60000;
/** Longest the first model download (about 670 MB) may take. */
const PREPARE_TIMEOUT_MS = 3 * 3600000;

/**
 * Speech recognition (agent/speech-worker.ts) in its own process. It starts on the first
 * request and keeps the models until close(); if it dies, pending requests fail and the next
 * one restarts it. A cancelled request fails at once; one that takes too long fails too and
 * restarts the process, since a hung native call does not come back.
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
  constructor(
    private readonly options: {
      script: string;
      data: SpeechWorkerData;
      timeouts?: { clip?: number; prepare?: number };
    },
  ) {}

  /** Downloads missing models (about 670 MB, once) and reports each file as it downloads. */
  prepare(onDownload?: (file: string) => void) {
    return this.request(
      { type: 'prepare' },
      undefined,
      onDownload,
      this.options.timeouts?.prepare ?? PREPARE_TIMEOUT_MS,
    ) as Promise<boolean>;
  }

  transcribe(path: string, signal?: AbortSignal) {
    return this.request(
      { type: 'clip', path },
      signal,
      undefined,
      this.options.timeouts?.clip ?? CLIP_TIMEOUT_MS,
    ) as Promise<Transcript>;
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
    const died = (why: string) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.fail(new Error(`Speech recognition stopped unexpectedly (${why}).`));
      child.kill();
    };
    child.on('exit', (code) => died(`code ${code}`));
    // A fatal V8 error in the process; an exit may or may not follow.
    child.on('error', (type) => died(String(type)));
    this.child = child;
    return child;
  }

  private fail(error: Error) {
    for (const waiting of this.pending.values()) waiting.reject(error);
    this.pending.clear();
  }

  private request(
    message: DistributiveOmit<SpeechRequest, 'id'>,
    signal: AbortSignal | undefined,
    progress: ((file: string) => void) | undefined,
    timeout: number,
  ) {
    const child = this.start();
    const id = this.next++;
    let timer: NodeJS.Timeout | undefined;
    let abort = () => {};
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, progress });
      // Tells the process to stop, as long as it is still the one that got the request.
      const cancel = () => {
        if (this.child === child) child.postMessage({ id, type: 'abort' } satisfies SpeechRequest);
      };
      abort = () => {
        if (!this.pending.delete(id)) return;
        cancel();
        reject(new Error('Speech recognition cancelled.'));
      };
      timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(
          new Error(`Speech recognition took longer than ${Math.round(timeout / 60000)} minutes.`),
        );
        // Stuck: a fresh process for the next request. Other requests fail with it.
        if (this.child === child) {
          this.child = undefined;
          this.fail(new Error('Speech recognition restarted after a request hung.'));
          child.kill();
        }
      }, timeout);
      child.postMessage({ ...message, id });
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    }).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    });
  }
}
