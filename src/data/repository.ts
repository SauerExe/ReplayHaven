import type { Clip, ClipFilters, VaultState } from '../domain/models';
import { createSeed, games } from './seed';
const KEY = 'replayhaven.v1';
export const repository = {
  load(): VaultState {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (
        data?.version === 1 &&
        Array.isArray(data.clips) &&
        Array.isArray(data.collections) &&
        data.preferences &&
        data.progress
      )
        return {
          ...data,
          clips: data.clips.map((clip: Clip) => ({
            ...clip,
            thumbnail: clip.thumbnail?.startsWith('/media/')
              ? clip.thumbnail.replace(/\.jpg$/, '.webp')
              : clip.thumbnail,
          })),
        };
    } catch {
      /* A damaged or unavailable store falls back to the initial archive. */
    }
    return createSeed();
  },
  save(state: VaultState) {
    const clips = state.clips.filter((c) => !c.local);
    const ids = new Set(clips.map((c) => c.id));
    localStorage.setItem(
      KEY,
      JSON.stringify({
        ...state,
        clips,
        collections: state.collections.map((c) => ({
          ...c,
          clipIds: c.clipIds.filter((id) => ids.has(id)),
        })),
        progress: Object.fromEntries(Object.entries(state.progress).filter(([id]) => ids.has(id))),
      }),
    );
  },
};
export function filterClips(clips: Clip[], filters: ClipFilters): Clip[] {
  const q = (filters.query || '').toLocaleLowerCase('de').trim();
  return clips
    .filter((c) => {
      const game = games.find((g) => g.id === c.gameId);
      return (
        (!q ||
          `${c.title} ${game?.name || ''} ${c.gameName || ''} ${c.description || ''} ${c.analysis?.result?.description || ''} ${c.analysis?.result?.game || ''} ${c.analysis?.result?.tags.join(' ') || ''} ${c.tags.join(' ')}`
            .toLocaleLowerCase('de')
            .includes(q)) &&
        (!filters.game ||
          (filters.game.startsWith('name:')
            ? c.gameName === filters.game.slice(5)
            : c.gameId === filters.game)) &&
        (!filters.favorite || c.favorite) &&
        (!filters.tag || c.tags.includes(filters.tag)) &&
        (!filters.status || c.status === filters.status) &&
        (!filters.period ||
          Date.now() - new Date(c.recordedAt).getTime() <= Number(filters.period) * 86400000)
      );
    })
    .sort((a, b) =>
      filters.sort === 'oldest'
        ? a.recordedAt.localeCompare(b.recordedAt)
        : filters.sort === 'title'
          ? a.title.localeCompare(b.title, 'de')
          : filters.sort === 'duration'
            ? b.duration - a.duration
            : filters.sort === 'size'
              ? b.size - a.size
              : b.recordedAt.localeCompare(a.recordedAt),
    );
}
export function deleteClips(state: VaultState, ids: string[]): VaultState {
  return {
    ...state,
    clips: state.clips.filter((c) => !ids.includes(c.id)),
    collections: state.collections.map((c) => ({
      ...c,
      clipIds: c.clipIds.filter((id) => !ids.includes(id)),
    })),
    progress: Object.fromEntries(
      Object.entries(state.progress).filter(([id]) => !ids.includes(id)),
    ),
  };
}
export function canContinue(seconds: number, duration: number) {
  return seconds > 2 && duration > 0 && seconds / duration < 0.95;
}
export function time(seconds: number) {
  if (!Number.isFinite(seconds)) return '00:00';
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
}
export function relativeDate(date: string) {
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  return days <= 0 ? 'Heute' : days === 1 ? 'Gestern' : `Vor ${days} Tagen`;
}
export function bytes(size: number) {
  return size >= 1073741824
    ? `${(size / 1073741824).toFixed(1)} GB`
    : `${(size / 1048576).toFixed(1)} MB`;
}
