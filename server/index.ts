import { buildServer } from './app';
import { Accounts } from './auth';
import { loadConfig } from './config';
import { setupNotice } from './setup-link';
const config = loadConfig();
const { app, db } = await buildServer(config);
await app.listen({ host: config.host, port: config.port });
console.log(`ReplayHaven server: http://${config.host}:${config.port}`);
console.log(`Public address: ${[config.publicOrigin, ...(config.extraOrigins ?? [])].join(', ')}`);
console.log(
  `AI: ${config.provider === 'none' ? 'not set up' : config.provider}. Originals stay in the archive.`,
);
console.log(
  `Sign-in: ${[config.passwordLogin !== false ? 'password' : '', config.oidc ? `OIDC (${config.oidc.issuer})` : ''].filter(Boolean).join(' + ')}. Playback: ${config.playback ?? 'web'}.`,
);
// Until the first account exists: the setup link, so `docker compose logs` shows it.
for (const line of setupNotice(config, new Accounts(db.db).hasUsers())) console.log(line);
// Closing waits for running work (worker.stop waits at most 8 s). A second signal, or closing
// that hangs, ends the process at once: recover() picks interrupted clips up on the next start.
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    if (closing) {
      console.log('Stopping immediately.');
      process.exit(1);
    }
    closing = true;
    console.log('Stopping …');
    setTimeout(() => {
      console.error('Shutdown took too long, stopping immediately.');
      process.exit(1);
    }, 15000).unref();
    void app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error('Shutdown failed:', error);
        process.exit(1);
      },
    );
  });
