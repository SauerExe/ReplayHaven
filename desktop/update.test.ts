import { expect, it } from 'vitest';
import { isNewer, releasePage } from './update';

it('offers an update only when the server runs a newer release', () => {
  expect(isNewer('1.1.3', '1.1.2')).toBe(true);
  expect(isNewer('v1.2.0', '1.1.9')).toBe(true);
  expect(isNewer('2.0.0', '1.9.9')).toBe(true);
  expect(isNewer('1.1.2', '1.1.2')).toBe(false);
  expect(isNewer('1.1.1', '1.1.2')).toBe(false);
  expect(isNewer('1.10.0', '1.9.0')).toBe(true);
  // Development servers and older servers without a version offer nothing.
  expect(isNewer('dev', '1.1.2')).toBe(false);
  expect(isNewer(undefined, '1.1.2')).toBe(false);
  expect(isNewer('', '1.1.2')).toBe(false);
});

it('sends updates to the project release page, never to an address the server names', () => {
  expect(releasePage('1.2.0')).toBe('https://github.com/SauerExe/ReplayHaven/releases/tag/v1.2.0');
  expect(releasePage('v1.2.0')).toBe('https://github.com/SauerExe/ReplayHaven/releases/tag/v1.2.0');
  expect(releasePage('1.2.0/../../evil')).toBe(
    'https://github.com/SauerExe/ReplayHaven/releases/latest',
  );
  expect(releasePage('')).toBe('https://github.com/SauerExe/ReplayHaven/releases/latest');
});
