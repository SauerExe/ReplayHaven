import { execFile } from 'node:child_process';
import { join } from 'node:path';

/** The graphics card the local AI would run on. */
export interface Gpu {
  name: string;
  /** Graphics memory in whole GB. */
  memoryGb: number;
}
/**
 * What the setup wizard suggests for this PC: a model if the card runs one well, null for
 * "without AI". `gpu` is null when no NVIDIA card was found.
 */
export interface AiAdvice {
  gpu: Gpu | null;
  model: 'qwen3.5:9b' | 'qwen3.5:4b' | null;
}

/**
 * Reads `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits`: one line per
 * card, memory in MiB. Returns the card with the most memory, or null if none is readable.
 */
export function parseGpus(output: string): Gpu | null {
  let best: Gpu | null = null;
  for (const line of output.split(/\r?\n/)) {
    const comma = line.lastIndexOf(',');
    if (comma < 0) continue;
    const name = line.slice(0, comma).trim();
    const mib = Number(line.slice(comma + 1).trim());
    if (!name || !Number.isFinite(mib) || mib <= 0) continue;
    const memoryGb = Math.round(mib / 1024);
    if (!best || memoryGb > best.memoryGb) best = { name, memoryGb };
  }
  return best;
}

/** 9B from about 10 GB graphics memory, 4B from 6 GB, below that no AI. */
export function adviseAi(gpu: Gpu | null): AiAdvice {
  const memory = gpu?.memoryGb ?? 0;
  return { gpu, model: memory >= 10 ? 'qwen3.5:9b' : memory >= 6 ? 'qwen3.5:4b' : null };
}

function query(file: string) {
  return new Promise<string>((done, fail) =>
    execFile(
      file,
      ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 4000 },
      (error, out) => (error ? fail(error) : done(out)),
    ),
  );
}

/** Asks the NVIDIA driver for the cards; without the driver (or any NVIDIA card), no advice. */
export async function detectAi(): Promise<AiAdvice> {
  // Newer drivers put nvidia-smi on the PATH, older ones only into their own folder.
  const candidates = [
    'nvidia-smi',
    join(
      process.env.ProgramFiles ?? 'C:\\Program Files',
      'NVIDIA Corporation',
      'NVSMI',
      'nvidia-smi.exe',
    ),
  ];
  for (const file of candidates) {
    const output = await query(file).catch(() => '');
    const gpu = parseGpus(output);
    if (gpu) return adviseAi(gpu);
  }
  return adviseAi(null);
}
