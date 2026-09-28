import type { Clip, ClipFilters, VaultState } from '../domain/models';
import { createSeed, games, sampleCollectionIds, withSamples } from './seed';
import { compareText, locale, perLanguage, t, tp } from '../i18n';
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
          // Older browsers still stored the samples; the shipped build drops them.
          collections: withSamples
            ? data.collections
            : data.collections.filter((c: { id: string }) => !sampleCollectionIds.has(c.id)),
          // Server clips come fresh from the server; older versions stored them here as well.
          clips: data.clips
            .filter((clip: Clip) => !clip.server && (withSamples || clip.local))
            .map((clip: Clip) => ({
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
  /**
   * Keeps preferences, collections, progress and the sample clips. Server clips are not stored:
   * the server sends them anew on every start, and they would only fill the storage (and stay
   * behind after signing out). Local uploads are blob URLs that do not survive a reload.
   */
  save(state: VaultState) {
    const local = new Set(state.clips.filter((c) => c.local).map((c) => c.id));
    localStorage.setItem(
      KEY,
      JSON.stringify({
        ...state,
        clips: state.clips.filter((c) => !c.local && !c.server),
        collections: state.collections.map((c) => ({
          ...c,
          clipIds: c.clipIds.filter((id) => !local.has(id)),
        })),
        progress: Object.fromEntries(
          Object.entries(state.progress).filter(([id]) => !local.has(id)),
        ),
      }),
    );
  },
  /** On sign-out: drops the server clips that older versions kept in this browser. */
  forgetServerClips() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!Array.isArray(data?.clips)) return;
      localStorage.setItem(
        KEY,
        JSON.stringify({ ...data, clips: data.clips.filter((clip: Clip) => !clip.server) }),
      );
    } catch {
      /* Nothing stored or no storage: nothing to forget. */
    }
  },
};
export function filterClips(clips: Clip[], filters: ClipFilters): Clip[] {
  const q = (filters.query || '').toLocaleLowerCase(locale()).trim();
  return clips
    .filter((c) => {
      const game = games.find((g) => g.id === c.gameId);
      return (
        (!q ||
          `${c.title} ${game?.name || ''} ${c.gameName || ''} ${c.description || ''} ${c.analysis?.result?.description || ''} ${c.analysis?.result?.game || ''} ${c.analysis?.result?.tags.join(' ') || ''} ${c.tags.join(' ')}`
            .toLocaleLowerCase(locale())
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
          ? compareText(a.title, b.title)
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
  return days <= 0
    ? t('app.date.today')
    : days === 1
      ? t('app.date.yesterday')
      : tp('app.date.daysAgo', days);
}
const sizeFormat = perLanguage(
  (tag) => new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
);
export function bytes(size: number) {
  return size >= 1073741824
    ? `${sizeFormat().format(size / 1073741824)} GB`
    : `${sizeFormat().format(size / 1048576)} MB`;
}
