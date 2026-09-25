import { MediaProcessor } from '../server/media';
import { ensureSpeechModels, ParakeetSpeech } from './parakeet';

/**
 * Einstieg des Hintergrundprozesses für die Spracherkennung (Electron utilityProcess, siehe
 * desktop/speech.ts). Ein eigener Prozess, weil sherpa-onnx eine eigene ONNX Runtime mitbringt
 * und ein nativer Absturz den Client nicht mitreißen soll. Nachrichten: prepare lädt die Modelle,
 * clip transkribiert einen Clip, abort bricht eine Anfrage ab.
 */

export interface SpeechWorkerData {
  folder: string;
  runtime: string;
  ffmpeg: string;
  ffprobe: string;
}
export type SpeechRequest =
  | { id: number; type: 'prepare' }
  | { id: number; type: 'clip'; path: string }
  | { id: number; type: 'abort' };
export interface SpeechReply {
  id: number;
  value?: unknown;
  progress?: string;
  error?: string;
}

interface ParentPort {
  on(event: 'message', listener: (event: { data: SpeechRequest }) => void): void;
  postMessage(message: SpeechReply): void;
}
const port = (process as unknown as { parentPort?: ParentPort }).parentPort;
const data = JSON.parse(process.argv.at(-1) ?? '{}') as SpeechWorkerData;
const media = new MediaProcessor({ ffmpeg: data.ffmpeg, ffprobe: data.ffprobe });
let engine: Promise<ParakeetSpeech> | undefined;
const running = new Map<number, AbortController>();

function load(id: number) {
  engine ??= ensureSpeechModels(data.folder, (file) => port?.postMessage({ id, progress: file }))
    .then((models) => new ParakeetSpeech({ media, models, runtime: data.runtime }))
    .catch((error: unknown) => {
      engine = undefined;
      throw error;
    });
  return engine;
}

port?.on('message', ({ data: request }) => {
  if (request.type === 'abort') return void running.get(request.id)?.abort();
  const control = new AbortController();
  running.set(request.id, control);
  const work =
    request.type === 'prepare'
      ? load(request.id).then(() => true)
      : load(request.id).then((speech) => speech.transcribe(request.path, control.signal));
  void work
    .then(
      (value) => port.postMessage({ id: request.id, value }),
      (error: unknown) =>
        port.postMessage({
          id: request.id,
          error: error instanceof Error ? error.message : String(error),
        }),
    )
    .finally(() => running.delete(request.id));
});
