import { parentPort, workerData } from 'node:worker_threads';
import { MediaProcessor } from '../server/media';
import { ClipTexts, serveTexts } from './r6';
import type { TextsWorkerData } from './r6';

// Entry point of the text recognition worker thread; the main process talks to it via WorkerTexts.
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
