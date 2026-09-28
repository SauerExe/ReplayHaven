import { describe, expect, it } from 'vitest';
import { mapLimited } from './limit';

describe('mapLimited', () => {
  it('keeps the order and never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapLimited([5, 1, 4, 2, 3, 0], 2, async (value) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, value));
      running--;
      return value * 10;
    });
    expect(results).toEqual([50, 10, 40, 20, 30, 0]);
    expect(peak).toBe(2);
  });
  it('handles an empty list', async () => {
    expect(await mapLimited([], 4, async () => 1)).toEqual([]);
  });
});
