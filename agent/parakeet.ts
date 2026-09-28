import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { speechTrack } from './audio';
import { ensureModel, modelFolder, monoFrom } from './laughs';
import type { ModelFile } from './laughs';
import type { SpeechSegment, Transcript } from './speech';
import type { MediaProcessor } from '../server/media';

/**
 * Speech recognition for voice chat with Parakeet TDT 0.6B v3 (NVIDIA, CC-BY-4.0) via
 * sherpa-onnx on the CPU, speech segments via Silero VAD. Measured on 2026-09-24: 3.6 s for two
 * minutes of audio, Whisper medium needed 91 s. The models (about 670 MB) are downloaded when
 * needed, pinned to revision and SHA-256.
 */

const PARAKEET =
  'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/2bda32ec70b097a55adaa07d9a7173915b43cc78';

export const SPEECH_MODELS = {
  encoder: {
    url: `${PARAKEET}/encoder.int8.onnx`,
    file: 'parakeet-v3-encoder.int8.onnx',
    bytes: 652184281,
    sha256: 'acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247',
  },
  decoder: {
    url: `${PARAKEET}/decoder.int8.onnx`,
    file: 'parakeet-v3-decoder.int8.onnx',
    bytes: 11845275,
    sha256: '179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e',
  },
  joiner: {
    url: `${PARAKEET}/joiner.int8.onnx`,
    file: 'parakeet-v3-joiner.int8.onnx',
    bytes: 6355277,
    sha256: '3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3',
  },
  tokens: {
    url: `${PARAKEET}/tokens.txt`,
    file: 'parakeet-v3-tokens.txt',
    bytes: 93939,
    sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d',
  },
  vad: {
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
    file: 'silero_vad.onnx',
    bytes: 643854,
    sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
  },
} satisfies Record<string, ModelFile>;

/** Total size of the speech models in bytes, for the notice before the download. */
export const SPEECH_BYTES = Object.values(SPEECH_MODELS).reduce((sum, m) => sum + m.bytes, 0);

export function speechFolder(env: NodeJS.ProcessEnv = process.env) {
  return join(modelFolder(env), 'parakeet-v3');
}

type SpeechPaths = Record<keyof typeof SPEECH_MODELS, string>;

/** Downloads missing speech models into `folder`, each file checked against size and SHA-256. */
export async function ensureSpeechModels(
  folder = speechFolder(),
  onDownload?: (file: string) => void,
  signal?: AbortSignal,
): Promise<SpeechPaths> {
  const paths = {} as SpeechPaths;
  for (const [key, model] of Object.entries(SPEECH_MODELS) as [keyof SpeechPaths, ModelFile][])
    paths[key] = await ensureModel(folder, model, fetch, () => onDownload?.(model.file!), {
      signal,
    });
  return paths;
}

export const cancelled = () => new Error('Speech recognition cancelled.');

/**
 * `work`, but rejected as soon as `signal` aborts. The work itself runs on; for FFmpeg calls it
 * ends by its own timeout.
 */
export function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    work.catch(() => {});
    return Promise.reject(cancelled());
  }
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(cancelled());
    signal.addEventListener('abort', stop, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', stop);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', stop);
        reject(error as Error);
      },
    );
  });
}

const SAMPLE_RATE = 16000;
const VAD_WINDOW = 512;

// sherpa-onnx ships no types for the parts used here.
interface SherpaSegment {
  start: number;
  samples: Float32Array;
}
interface Sherpa {
  OfflineRecognizer: new (config: unknown) => {
    createStream(): { acceptWaveform(wave: { samples: Float32Array; sampleRate: number }): void };
    decodeAsync(stream: unknown): Promise<unknown>;
    getResult(stream: unknown): { text: string };
  };
  Vad: new (
    config: unknown,
    bufferSeconds: number,
  ) => {
    acceptWaveform(samples: Float32Array): void;
    isEmpty(): boolean;
    front(external?: boolean): SherpaSegment;
    pop(): void;
    flush(): void;
  };
}

const moduleRequire = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);

export class ParakeetSpeech {
  private sherpa?: Sherpa;
  private recognizer?: InstanceType<Sherpa['OfflineRecognizer']>;
  constructor(
    private readonly options: {
      media: MediaProcessor;
      models: SpeechPaths;
      /** Path to sherpa-onnx-node in the packaged client; otherwise from node_modules. */
      runtime?: string;
      threads?: number;
    },
  ) {}

  private load() {
    this.sherpa ??= moduleRequire(this.options.runtime ?? 'sherpa-onnx-node') as Sherpa;
    const { models } = this.options;
    this.recognizer ??= new this.sherpa.OfflineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        transducer: { encoder: models.encoder, decoder: models.decoder, joiner: models.joiner },
        tokens: models.tokens,
        // Like the text recognition, at most half the cores, so a game does not stutter.
        numThreads: this.options.threads ?? Math.max(1, availableParallelism() >> 1),
        provider: 'cpu',
        modelType: 'nemo_transducer',
      },
    });
    return { sherpa: this.sherpa, recognizer: this.recognizer };
  }

  /** The audio track with the voice (see speechTrack); undefined if there is none to trust. */
  private async voice(path: string, signal?: AbortSignal) {
    // The signal stops FFmpeg; the race also returns at once if a step ignores it.
    const { media } = this.options;
    const { audio, duration } = await untilAborted(media.probe(path, signal), signal);
    if (!audio.length) return undefined;
    const levels = new Map<number, { max: number }>();
    if (audio.length > 1)
      for (const t of audio)
        levels.set(t.index, await untilAborted(media.audioLevels(path, t.index, signal), signal));
    const track = speechTrack(audio, levels);
    if (track === undefined) return undefined;
    const channels = audio.find((t) => t.index === track)?.channels ?? 1;
    return monoFrom(
      await untilAborted(media.pcm(path, track, channels, { signal, duration }), signal),
    ).samples;
  }

  async transcribe(path: string, signal?: AbortSignal): Promise<Transcript> {
    const started = Date.now();
    const samples = await this.voice(path, signal);
    const segments: SpeechSegment[] = [];
    if (samples) {
      const { sherpa, recognizer } = this.load();
      const vad = new sherpa.Vad(
        {
          sileroVad: {
            model: this.options.models.vad,
            threshold: 0.5,
            minSpeechDuration: 0.25,
            minSilenceDuration: 0.4,
            maxSpeechDuration: 12,
            windowSize: VAD_WINDOW,
          },
          sampleRate: SAMPLE_RATE,
          numThreads: 1,
        },
        60,
      );
      const drain = async () => {
        while (!vad.isEmpty()) {
          if (signal?.aborted) throw cancelled();
          const part = vad.front(false);
          vad.pop();
          const stream = recognizer.createStream();
          stream.acceptWaveform({ samples: part.samples, sampleRate: SAMPLE_RATE });
          await recognizer.decodeAsync(stream);
          const text = recognizer.getResult(stream).text.trim();
          if (text)
            segments.push({
              start: part.start / SAMPLE_RATE,
              end: (part.start + part.samples.length) / SAMPLE_RATE,
              text,
            });
        }
      };
      for (let i = 0; i + VAD_WINDOW <= samples.length; i += VAD_WINDOW) {
        vad.acceptWaveform(samples.subarray(i, i + VAD_WINDOW));
        await drain();
      }
      vad.flush();
      await drain();
    }
    return {
      segments,
      trace: {
        engine: 'parakeet-tdt-0.6b-v3',
        seconds: Math.round((Date.now() - started) / 100) / 10,
        words: segments.reduce((n, s) => n + s.text.split(/\s+/).length, 0),
        laughs: 0,
      },
    };
  }
}
