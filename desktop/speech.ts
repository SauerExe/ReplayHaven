import { utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import type { SpeechReply, SpeechRequest, SpeechWorkerData } from '../agent/speech-worker';
import type { Transcript } from '../agent/speech';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * Die Spracherkennung (agent/speech-worker.ts) in einem eigenen Prozess. Er startet bei der
 * ersten Anfrage und behält die Modelle bis close(); stirbt er, scheitern die offenen Anfragen
 * und die nächste startet ihn neu.
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

  /** Lädt fehlende Modelle (einmalig rund 670 MB) und meldet jede Datei beim Laden. */
  prepare(onDownload?: (file: string) => void) {
    return this.request({ type: 'prepare' }, undefined, onDownload) as Promise<boolean>;
  }

  transcribe(path: string, signal?: AbortSignal) {
    return this.request({ type: 'clip', path }, signal) as Promise<Transcript>;
  }

  close() {
    const child = this.child;
    this.child = undefined;
    this.fail(new Error('Spracherkennung beendet.'));
    child?.kill();
  }

  private start() {
    if (this.child) return this.child;
    const child = utilityProcess.fork(this.options.script, [JSON.stringify(this.options.data)], {
      serviceName: 'ReplayHaven Spracherkennung',
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
      this.fail(new Error(`Spracherkennung unerwartet beendet (Code ${code}).`));
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
