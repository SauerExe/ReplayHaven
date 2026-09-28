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

it('shows the support banner unless switched off and creates no OIDC accounts by default', () => {
  expect(loadConfig({}).supportBanner).toBe(true);
  expect(loadConfig({ REPLAYHAVEN_SUPPORT_BANNER: 'false' }).supportBanner).toBe(false);
  const oidc = {
    REPLAYHAVEN_OIDC_ISSUER: 'https://auth.example.org',
    REPLAYHAVEN_OIDC_CLIENT_ID: 'replayhaven',
  };
  expect(loadConfig(oidc).oidc?.autoCreate).toBe(false);
  expect(loadConfig({ ...oidc, REPLAYHAVEN_OIDC_AUTO_CREATE: 'true' }).oidc?.autoCreate).toBe(true);
});
