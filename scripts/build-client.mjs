import { build } from 'esbuild';
import { mkdir, copyFile, cp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import sharp from 'sharp';
const require = createRequire(import.meta.url);
// Release builds pass REPLAYHAVEN_VERSION (from the git tag); local builds use package.json.
const version = process.env.REPLAYHAVEN_VERSION || require('../package.json').version;
await mkdir('desktop-bundle/binaries', { recursive: true });
await build({
  entryPoints: ['desktop/main.ts'],
  outfile: 'desktop-bundle/main.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron', 'ffmpeg-static', '@ffprobe-installer/ffprobe'],
  logOverride: { 'empty-import-meta': 'silent' },
});
await build({
  entryPoints: ['desktop/preload.ts'],
  outfile: 'desktop-bundle/preload.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
});
await cp('desktop/renderer', 'desktop-bundle/renderer', { recursive: true });
await copyFile(require('ffmpeg-static'), 'desktop-bundle/binaries/ffmpeg.exe');
await copyFile(require('@ffprobe-installer/ffprobe').path, 'desktop-bundle/binaries/ffprobe.exe');
await mkdir('desktop-bundle/licenses', { recursive: true });
await copyFile(
  'node_modules/ffmpeg-static/ffmpeg.exe.LICENSE',
  'desktop-bundle/licenses/FFmpeg-GPL-3.0.txt',
);
await copyFile(
  'node_modules/ffmpeg-static/ffmpeg.exe.README',
  'desktop-bundle/licenses/FFmpeg-build.txt',
);
await copyFile('node_modules/zod/LICENSE', 'desktop-bundle/licenses/Zod-MIT.txt');
await sharp('public/favicon.svg').resize(256, 256).png().toFile('desktop-bundle/icon.png');
// ICO containing a PNG image, supported by modern Windows shells and NSIS.
const png = await sharp('public/favicon.svg').resize(256, 256).png().toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
await writeFile('desktop-bundle/icon.ico', Buffer.concat([header, png]));
await writeFile(
  'desktop-bundle/package.json',
  JSON.stringify({
    name: 'replayhaven-client',
    version,
    main: 'main.cjs',
    description: 'Lokaler NVIDIA-Aufnahme- und KI-Client für ReplayHaven',
    author: 'ReplayHaven',
    private: true,
    dependencies: {},
  }),
);
await writeFile(
  'desktop-bundle/THIRD-PARTY.txt',
  'ReplayHaven Client includes Electron (MIT), Zod (MIT), FFmpeg 6.1.1 (GPL-3.0) and FFprobe (GPL-3.0, Gyan build 20230213-2296078). License texts and FFmpeg build configuration are in licenses/. Electron notices accompany the executable. FFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/e38092ef93 ; FFprobe source: https://github.com/FFmpeg/FFmpeg/tree/2296078 ; build distribution: https://www.gyan.dev/ffmpeg/builds/ ; package sources: https://github.com/eugeneware/ffmpeg-static and https://github.com/SavageCore/node-ffprobe-installer . Ollama and Qwen are installed separately. No model weights are bundled.',
);
console.log('Windows-Client vorbereitet.');
