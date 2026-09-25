import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bytes,
  canContinue,
  deleteClips,
  filterClips,
  relativeDate,
  repository,
} from './repository';
import { createSeed } from './seed';
afterEach(() => vi.unstubAllGlobals());
describe('library and persisted state', () => {
  it('combines search by tags, game, favorites and sorting', () => {
    const clips = createSeed().clips;
    const result = filterClips(clips, {
      query: 'clutch',
      game: 'cs2',
      favorite: true,
      sort: 'title',
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((c) => c.gameId === 'cs2' && c.favorite && c.tags.includes('Clutch'))).toBe(
      true,
    );
    expect(filterClips(clips, { query: 'Cyberpunk', game: 'cs2' })).toEqual([]);
    expect(filterClips(clips, { game: 'elden', sort: 'oldest' })[0].id).toBe('elden-4');
  });
  it('also removes deleted clips from collections and progress', () => {
    const state = createSeed();
    state.progress['elden-1'] = { seconds: 12, duration: 42, updatedAt: new Date().toISOString() };
    const next = deleteClips(state, ['elden-1']);
    expect(next.clips.some((c) => c.id === 'elden-1')).toBe(false);
    expect(next.collections.every((c) => !c.clipIds.includes('elden-1'))).toBe(true);
    expect(next.progress['elden-1']).toBeUndefined();
    expect(state.clips).toHaveLength(20);
  });
  it('stores user changes but no local files or blob URLs', () => {
    const memory = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => memory.get(k),
      setItem: (k: string, v: string) => memory.set(k, v),
    });
    const state = createSeed();
    state.clips[0].title = 'My title';
    state.clips[0].favorite = false;
    state.preferences.speed = 1.5;
    state.clips.push({
      ...state.clips[0],
      id: 'local',
      local: true,
      videoSource: 'blob:private-local-video',
    });
    state.collections[0].clipIds.push('local');
    repository.save(state);
    const restored = repository.load();
    expect(restored.clips[0].title).toBe('My title');
    expect(restored.clips[0].favorite).toBe(false);
    expect(restored.preferences.speed).toBe(1.5);
    expect(restored.clips.some((c) => c.local)).toBe(false);
    expect(restored.collections[0].clipIds).not.toContain('local');
    expect([...memory.values()].join('')).not.toContain('blob:');
  });
  it('recovers from damaged browser storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{broken' });
    expect(repository.load().clips).toHaveLength(20);
  });
  it('only shows real, unfinished progress', () => {
    expect(canContinue(0, 30)).toBe(false);
    expect(canContinue(12, 30)).toBe(true);
    expect(canContinue(29, 30)).toBe(false);
    expect(canContinue(5, 0)).toBe(false);
  });
  it('formats dates and sizes in the active language', () => {
    const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
    expect(relativeDate(daysAgo(0))).toBe('Today');
    expect(relativeDate(daysAgo(1))).toBe('Yesterday');
    expect(relativeDate(daysAgo(3))).toBe('3 days ago');
    expect(bytes(1.5 * 1073741824)).toBe('1.5 GB');
  });
});
