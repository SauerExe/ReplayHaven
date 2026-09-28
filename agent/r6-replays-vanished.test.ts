import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { keepMatchForClip, matchStarted, ROUND_TIMES_FILE } from './r6-replays';

/** Files the "game" deletes between listing and stat, after this many successful stats. */
const vanishing = new Map<string, number>();
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return {
    ...fs,
    stat: (async (path: string, ...rest: []) => {
      const name = basename(String(path));
      const left = vanishing.get(name);
      if (left !== undefined && String(path).includes('MatchReplay')) {
        if (left <= 0) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
        vanishing.set(name, left - 1);
      }
      return fs.stat(path, ...rest);
    }) as typeof fs.stat,
  };
});

it('skips matches and rounds the game deletes meanwhile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'r6-vanished-'));
  try {
    const replays = join(root, 'MatchReplay');
    const archive = join(root, 'archive');
    const old = 'Match-2026-07-12_20-25-52-36588';
    const next = 'Match-2026-07-12_20-41-13-36588';
    const started = matchStarted(next)!;
    const write = async (match: string, file: string, minutes: number) => {
      await mkdir(join(replays, match), { recursive: true });
      await writeFile(join(replays, match, file), 'x');
      const at = new Date(started + minutes * 60000);
      await utimes(join(replays, match, file), at, at);
    };
    await write(old, 'old-R01.rec', -3);
    await write(next, 'next-R01.rec', 4);
    await write(next, 'next-R02.rec', 8);
    const saved = started + 7 * 60000;
    const later = started + 60 * 60000;
    // A round of the newer match vanishes while its times are read: that match is skipped.
    vanishing.set('next-R02.rec', 0);
    expect(await keepMatchForClip(saved, [replays], archive, later)).toEqual({
      target: join(archive, old),
      running: false,
    });
    // A round that vanishes while copying is skipped; the others are kept.
    vanishing.set('next-R02.rec', 1);
    expect(await keepMatchForClip(saved, [replays], archive, later)).toEqual({
      target: join(archive, next),
      running: false,
    });
    expect((await readdir(join(archive, next))).sort()).toEqual(['next-R01.rec', ROUND_TIMES_FILE]);
  } finally {
    vanishing.clear();
    await rm(root, { recursive: true, force: true });
  }
});
