import { expect, it } from 'vitest';
import { loadConfig } from './config';
import { promptFor } from './providers';

const input = {
  original: 'clip.mp4',
  directory: 'work',
  duration: 30,
  gameHint: 'VALORANT',
  includeAudio: false,
};

it('writes titles in the configured language, English by default', () => {
  expect(loadConfig({}).contentLanguage).toBe('en');
  expect(loadConfig({ REPLAYHAVEN_CONTENT_LANGUAGE: 'DE' }).contentLanguage).toBe('de');
  expect(() => loadConfig({ REPLAYHAVEN_CONTENT_LANGUAGE: 'fr' })).toThrow(/en or de/);
  expect(promptFor(input, true, 'en')).toContain('auf Englisch');
  expect(promptFor(input, true, 'de')).toContain('auf Deutsch');
  expect(promptFor(input, true, 'de')).not.toContain('Englisch');
});
