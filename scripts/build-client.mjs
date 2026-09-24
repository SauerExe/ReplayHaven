import { build } from 'esbuild';
import { mkdir, copyFile, cp, readFile, rm, writeFile } from 'node:fs/promises';
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
// Texterkennung (agent/ocr.ts): ONNX Runtime nur mit den CPU-Dateien für Windows x64 (DirectML
// lädt sie erst bei Bedarf) und die PP-OCRv4-Modelle. Beides liegt neben FFmpeg, nicht im Archiv.
const ort = 'desktop-bundle/onnxruntime';
const native = 'bin/napi-v6/win32/x64';
await rm(ort, { recursive: true, force: true });
await mkdir(`${ort}/${native}`, { recursive: true });
// Der JavaScript-Teil samt onnxruntime-common als eine Datei: kein node_modules-Ordner in den
// Zusatzdateien. Die Binärdatei lädt er weiter relativ zu dist/ nach.
await build({
  entryPoints: ['node_modules/onnxruntime-node/dist/index.js'],
  outfile: `${ort}/dist/index.js`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['*.node'],
  logLevel: 'error',
});
await writeFile(
  `${ort}/package.json`,
  JSON.stringify({
    name: 'onnxruntime-node',
    version: require('onnxruntime-node/package.json').version,
    license: 'MIT',
    main: 'dist/index.js',
  }),
);
for (const file of ['onnxruntime_binding.node', 'onnxruntime.dll'])
  await copyFile(`node_modules/onnxruntime-node/${native}/${file}`, `${ort}/${native}/${file}`);
await mkdir('desktop-bundle/ocr', { recursive: true });
for (const file of [
  'ch_PP-OCRv4_det_infer.onnx',
  'ch_PP-OCRv4_rec_infer.onnx',
  'ppocr_keys_v1.txt',
])
  await copyFile(`node_modules/@gutenye/ocr-models/assets/${file}`, `desktop-bundle/ocr/${file}`);
await writeFile(
  'desktop-bundle/licenses/ONNX-Runtime-MIT.txt',
  `MIT License\n\nCopyright (c) Microsoft Corporation\n\n${(await readFile('LICENSE', 'utf8')).split('\n').slice(4).join('\n')}\nThird-party notices of ONNX Runtime: https://github.com/microsoft/onnxruntime/blob/main/ThirdPartyNotices.txt\n`,
);
await writeFile(
  'desktop-bundle/licenses/PaddleOCR-models-Apache-2.0.txt',
  `PaddleOCR PP-OCRv4 text detection and recognition models (https://github.com/PaddlePaddle/PaddleOCR), converted to ONNX by @gutenye/ocr-models (MIT).\n\n${await readFile('node_modules/typescript/LICENSE.txt', 'utf8')}`,
);
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
  'ReplayHaven Client includes Electron (MIT), Zod (MIT), FFmpeg 6.1.1 (GPL-3.0), FFprobe (GPL-3.0, Gyan build 20230213-2296078), ONNX Runtime 1.30 (MIT, CPU files for Windows x64) and the PaddleOCR PP-OCRv4 text models (Apache-2.0). License texts and FFmpeg build configuration are in licenses/. Electron notices accompany the executable. FFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/e38092ef93 ; FFprobe source: https://github.com/FFmpeg/FFmpeg/tree/2296078 ; build distribution: https://www.gyan.dev/ffmpeg/builds/ ; package sources: https://github.com/eugeneware/ffmpeg-static and https://github.com/SavageCore/node-ffprobe-installer . Ollama and Qwen are installed separately. No model weights are bundled.',
);
console.log('Windows-Client vorbereitet.');
