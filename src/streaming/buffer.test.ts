import { describe, expect, it } from 'vitest';
import { bufferedEnd } from './buffer';

function ranges(...list: [number, number][]) {
  return {
    length: list.length,
    start: (i: number) => list[i][0],
    end: (i: number) => list[i][1],
  };
}

describe('bufferedEnd', () => {
  it('returns the end of the range around the playhead', () => {
    expect(bufferedEnd(ranges([0, 42]), 3)).toBe(42);
    expect(bufferedEnd(ranges([0, 10], [60, 90]), 70)).toBe(90);
  });

  it('ignores ranges elsewhere and handles nothing loaded', () => {
    expect(bufferedEnd(ranges([60, 90]), 5)).toBe(0);
    expect(bufferedEnd(ranges(), 0)).toBe(0);
  });

  it('tolerates a playhead just before the range after a seek', () => {
    expect(bufferedEnd(ranges([30.2, 50]), 30)).toBe(50);
  });
});
