import { parentPort, workerData } from 'node:worker_threads';
import { MediaProcessor } from '../server/media';
import { ClipTexts, serveTexts } from './r6';
import type { TextsWorkerData } from './r6';

// Einstieg des Worker-Threads für die Texterkennung; der Hauptprozess spricht über WorkerTexts.
const data = workerData as TextsWorkerData;
if (parentPort)
  serveTexts(
    parentPort,
    new ClipTexts({
      media: new MediaProcessor({ ffmpeg: data.ffmpeg, ffprobe: data.ffprobe }),
      models: data.models,
      ...(data.runtime ? { runtime: data.runtime } : {}),
      ...(data.threads ? { threads: data.threads } : {}),
    }),
  );
