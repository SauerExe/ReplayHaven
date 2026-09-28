import type { AudioTrack } from '../server/media';

/**
 * Audio tracks of a recording. With "microphone as a separate track", the NVIDIA App writes game
 * audio and microphone separately. The file does not reliably say which track is the
 * microphone: tracks often have no title, and users report an extra silent track. So title,
 * level and order decide in that order; if it stays unclear, there is no microphone track
 * rather than a guessed one.
 */

/** Below this peak a track counts as silent (dBFS). */
export const SILENT_DB = -70;
const MIC_TITLE = /\b(?:mic|mikro|microphone|mikrofon|voice|stimme|commentary|kommentar)/i;
const GAME_TITLE = /\b(?:game|spiel|system|desktop|application|anwendung)/i;

export interface MicChoice {
  /** Index among the audio tracks (-map 0:a:N); missing without a separate microphone track. */
  track?: number;
  basis: string;
}

/**
 * Picks the microphone track. `levels` holds the peak level per track, if measured; silent
 * tracks do not count then.
 */
export function micTrack(
  tracks: readonly AudioTrack[],
  levels?: ReadonlyMap<number, { max: number }>,
): MicChoice {
  if (tracks.length < 2) return { basis: 'only one audio track: game audio and microphone mixed' };
  const titled = tracks.filter((t) => MIC_TITLE.test(t.title) && !GAME_TITLE.test(t.title));
  if (titled.length === 1) return { track: titled[0].index, basis: `title "${titled[0].title}"` };
  const audible = levels
    ? tracks.filter((t) => (levels.get(t.index)?.max ?? -Infinity) > SILENT_DB)
    : [...tracks];
  if (audible.length < 2)
    return {
      basis: audible.length
        ? 'only one track with sound: the microphone was silent or is mixed in'
        : 'all tracks silent',
    };
  if (audible.length === 2)
    return {
      track: audible[1].index,
      basis: `order: game audio first, microphone second (tracks ${audible[0].index + 1} and ${audible[1].index + 1})`,
    };
  return { basis: `${audible.length} tracks with sound, none marked as microphone` };
}

/**
 * The track for speech recognition: the microphone track; with a single track that one (game
 * audio and microphone mixed); otherwise the only audible track. With several audible tracks and
 * no clear microphone, none: transcribing game audio or a silent track would mislead the analysis.
 */
export function speechTrack(
  tracks: readonly AudioTrack[],
  levels?: ReadonlyMap<number, { max: number }>,
): number | undefined {
  if (tracks.length === 1) return tracks[0].index;
  const mic = micTrack(tracks, levels).track;
  if (mic !== undefined) return mic;
  if (!levels) return undefined;
  const audible = tracks.filter((t) => (levels.get(t.index)?.max ?? -Infinity) > SILENT_DB);
  return audible.length === 1 ? audible[0].index : undefined;
}
