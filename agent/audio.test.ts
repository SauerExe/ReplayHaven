import { expect, it } from 'vitest';
import { micTrack } from './audio';

const track = (index: number, title = '', channels = 2) => ({
  index,
  codec: 'aac',
  channels,
  sampleRate: 48000,
  title,
});
const loud = (...max: number[]) => new Map(max.map((m, index) => [index, { max: m }]));

it('takes the microphone from a track title, or else from the NVIDIA order', () => {
  expect(micTrack([track(0, 'Game'), track(1, 'Mikrofon')]).track).toBe(1);
  expect(micTrack([track(0, 'Microphone'), track(1)]).track).toBe(0);
  expect(micTrack([track(0), track(1)])).toEqual({
    track: 1,
    basis: 'order: game audio first, microphone second (tracks 1 and 2)',
  });
});

it('skips silent tracks and gives no microphone where it cannot tell', () => {
  expect(micTrack([track(0)]).track).toBeUndefined();
  // An extra silent track in front does not shift the order.
  expect(micTrack([track(0), track(1), track(2)], loud(-91, -12, -30)).track).toBe(2);
  // Microphone off: the track exists, but it is silent.
  expect(micTrack([track(0), track(1)], loud(-12, -91))).toEqual({
    basis: 'only one track with sound: the microphone was silent or is mixed in',
  });
  expect(micTrack([track(0), track(1), track(2)], loud(-12, -20, -30)).track).toBeUndefined();
});
