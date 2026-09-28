import { expect, it } from 'vitest';
import {
  SUPPORT_INTERVAL_MS,
  readSupport,
  snoozed,
  supportDue,
  writeSupport,
} from './support-banner';

const DAY = 24 * 60 * 60 * 1000;

it('waits four days after the first visit and four days after every "Later"', () => {
  const firstSeen = 1_000_000;
  expect(supportDue(null, firstSeen)).toBe(false);
  expect(supportDue({ firstSeen }, firstSeen + 3 * DAY)).toBe(false);
  expect(supportDue({ firstSeen }, firstSeen + SUPPORT_INTERVAL_MS)).toBe(true);
  const later = snoozed({ firstSeen }, firstSeen + 5 * DAY);
  expect(supportDue(later, firstSeen + 8 * DAY)).toBe(false);
  expect(supportDue(later, firstSeen + 9 * DAY)).toBe(true);
});

it('never asks again after "I already donated"', () => {
  expect(supportDue({ firstSeen: 0, donated: true }, 365 * DAY)).toBe(false);
});

it('survives broken or blocked storage', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  writeSupport(storage, { firstSeen: 42 });
  expect(readSupport(storage)).toEqual({ firstSeen: 42 });
  store.set('replayhaven.support', '{broken');
  expect(readSupport(storage)).toBeNull();
  const blocked = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  expect(readSupport(blocked)).toBeNull();
  expect(() => writeSupport(blocked, { firstSeen: 1 })).not.toThrow();
});
