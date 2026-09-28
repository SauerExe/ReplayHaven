import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('server-bundle', { recursive: true });
await build({
  entryPoints: ['server/index.ts'],
  outfile: 'server-bundle/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  packages: 'external',
});
// Admin commands inside the container, e.g. resetting a forgotten password (server/admin-cli.ts).
await build({
  entryPoints: ['server/admin-cli.ts'],
  outfile: 'server-bundle/admin.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  packages: 'external',
});
console.log('Server bundle created.');
