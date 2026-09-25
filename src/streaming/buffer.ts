/**
 * How far the video is loaded ahead of the playhead, like the light segment on YouTube: the end of
 * the buffered range that contains the current time. Ranges elsewhere (after a seek) do not count,
 * because playback cannot use them without another jump.
 */
export function bufferedEnd(
  ranges: Pick<TimeRanges, 'length' | 'start' | 'end'>,
  time: number,
): number {
  for (let i = 0; i < ranges.length; i++) {
    // Small tolerance: right after a seek the playhead can sit just before the range start.
    if (ranges.start(i) <= time + 0.5 && time <= ranges.end(i)) return ranges.end(i);
  }
  return 0;
}
