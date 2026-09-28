import { afterAll, expect, it } from 'vitest';
import { TEST_KEY, cookieOf, removeRoots, startServer } from './test-support';

afterAll(removeRoots);

// The router decodes percent-escapes, so "/%61pi/clips" reaches the /api/clips handler. The
// sign-in check must see the same path, otherwise such a request slips past it.
it('guards API routes however their path is spelled', async () => {
  const { app } = await startServer();
  const setup = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { name: 'owner', password: 'owner-password', key: TEST_KEY },
  });
  expect(cookieOf(setup)).not.toBe('');
  for (const url of [
    '/api/clips',
    '/%61pi/clips',
    '/%61%70%69/clips',
    '/api/%63lips',
    '/API/clips',
    '//api/clips',
    '/api//clips',
    '/./api/clips',
    '/api/status',
    '/%61pi/status',
    '/%61pi/settings/analysis',
  ]) {
    const response = await app.inject({ url });
    // Spellings the router does not match land on the web app page, never on API data.
    const data =
      response.statusCode === 200 && /json/.test(String(response.headers['content-type']));
    expect(data, `${url} -> ${response.statusCode} ${response.headers['content-type']}`).toBe(
      false,
    );
  }
  const put = await app.inject({
    method: 'PUT',
    url: '/%61pi/settings/analysis',
    payload: { autoAnalyze: false, autoTitle: false, includeAudio: false },
  });
  expect(put.statusCode).not.toBe(200);
  await app.close();
});
