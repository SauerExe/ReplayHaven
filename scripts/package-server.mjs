import { mkdir, copyFile, cp, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const stage = 'release/server-package';
await mkdir(stage, { recursive: true });
for (const name of [
  'package.json',
  'package-lock.json',
  'LICENSE',
  'THIRD-PARTY.md',
  '.env.example',
  '.nvmrc',
  'Dockerfile',
  '.dockerignore',
  'compose.yaml',
  'setup-server.sh',
  'README.md',
  'tsconfig.json',
  'tsconfig.server.json',
  'vite.config.ts',
  'index.html',
  'eslint.config.js',
  'playwright.config.ts',
  'electron-builder.yml',
])
  await copyFile(name, `${stage}/${name}`);
for (const name of ['server', 'agent', 'desktop', 'src', 'public', 'scripts', 'docs', 'tests'])
  await cp(name, `${stage}/${name}`, { recursive: true });
await mkdir(`${stage}/release`, { recursive: true });
if (await stat('release/ReplayHaven-Client-Setup.exe').catch(() => null))
  await copyFile(
    'release/ReplayHaven-Client-Setup.exe',
    `${stage}/release/ReplayHaven-Client-Setup.exe`,
  );
execFileSync('tar', ['-czf', 'release/ReplayHaven-Server.tar.gz', '-C', stage, '.'], {
  windowsHide: true,
});
console.log('release/ReplayHaven-Server.tar.gz erstellt.');
