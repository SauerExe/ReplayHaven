import { expect, it } from 'vitest';
import { GameState, gameBetween, gameIn, gameTitle, parseSample } from './gaming';
import type { ForegroundSample } from './gaming';

const sample = (process: string, fullscreen = true, extra: Partial<ForegroundSample> = {}) => ({
  fullscreen,
  notification: 5,
  windowClass: 'UnrealWindow',
  process,
  ...extra,
});

it('reads a line of the foreground probe', () => {
  expect(parseSample('1\t3\tUnrealWindow\tVALORANT-Win64-Shipping\r')).toEqual({
    fullscreen: true,
    notification: 3,
    windowClass: 'UnrealWindow',
    process: 'VALORANT-Win64-Shipping',
  });
  expect(parseSample('0\t5\tChrome_WidgetWin_1\tCode')?.fullscreen).toBe(false);
  expect(parseSample('Add-Type : Error')).toBeUndefined();
});

it.each([
  [sample('RainbowSix'), 'RainbowSix'],
  [sample('FortniteClient-Win64-Shipping'), 'FortniteClient-Win64-Shipping'],
  // Windows reports exclusive fullscreen even when the window is reported smaller.
  [sample('cod', false, { notification: 3 }), 'cod'],
  [sample('Code', false), ''],
  [sample('chrome'), ''],
  [sample('explorer', true, { windowClass: 'Progman' }), ''],
  [sample('ReplayHaven Client'), ''],
  [sample('', true), ''],
])('recognises a game in %j: %s', (probe, game) => {
  expect(gameIn(probe)).toBe(game);
});

it('starts at once and ends only after a minute without a game', () => {
  const state = new GameState(60_000);
  expect(state.update(sample('Code', false), 0)).toBe(false);
  expect(state.update(sample('RainbowSix'), 3_000)).toBe(true);
  expect(state.game).toBe('RainbowSix');
  // Alt+Tab to Discord: the game keeps running.
  expect(state.update(sample('Discord', false), 30_000)).toBe(false);
  expect(state.update(sample('Discord', false), 62_000)).toBe(false);
  expect(state.game).toBe('RainbowSix');
  expect(state.update(sample('Discord', false), 63_001)).toBe(true);
  expect(state.game).toBe('');
});

it('reads the window title and names the game of a clip saved without one', () => {
  expect(parseSample('0\t5\tUnityWndClass\tRaft\tRaft')?.title).toBe('Raft');
  const at = (seconds: number, process: string, title?: string) => ({
    at: seconds * 1000,
    process,
    ...(title ? { title } : {}),
  });
  const history = [
    at(0, 'Code'),
    at(3, 'RainbowSix', 'Rainbow Six'),
    at(6, 'RainbowSix', 'Rainbow Six'),
    at(9, 'Discord'),
    at(12, 'RainbowSix', 'Rainbow Six'),
  ];
  // Known processes are named like the NVIDIA App folder.
  expect(gameBetween(history, 0, 15_000)).toBe("Tom Clancy's Rainbow Six Siege");
  // Unknown ones by window title, without characters not allowed in folder names.
  expect(
    gameBetween([at(1, 'Raft', 'Raft: Survival'), at(4, 'Raft', 'Raft: Survival')], 0, 5_000),
  ).toBe('Raft Survival');
  // A quick glance does not count, nor do browsers and tools.
  expect(gameBetween([at(1, 'Raft', 'Raft')], 0, 5_000)).toBe('');
  expect(
    gameBetween([at(1, 'chrome'), at(4, 'chrome'), at(7, 'Discord'), at(9, 'Discord')], 0, 10_000),
  ).toBe('');
  expect(gameBetween(history, 20_000, 30_000)).toBe('');
});

it('shows a known game by name while it runs', () => {
  expect(gameTitle('RainbowSix_Vulkan')).toBe("Tom Clancy's Rainbow Six Siege");
  expect(gameTitle('Raft')).toBe('Raft');
});
