import { buildServer } from './app';
import { loadConfig } from './config';
const config = loadConfig();
const { app } = await buildServer(config);
await app.listen({ host: config.host, port: config.port });
console.log(`ReplayHaven Server: http://${config.host}:${config.port}`);
console.log(
  `KI: ${config.provider === 'none' ? 'Noch nicht eingerichtet' : config.provider}. Originaldateien bleiben im Archiv.`,
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
