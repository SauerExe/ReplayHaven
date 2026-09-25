import { build } from 'esbuild';
import { mkdir, copyFile, cp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
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
// Text recognition runs in a worker thread (agent/r6.ts). Like ONNX Runtime, the file sits next
// to the app archive, so the worker loads it without asar support.
await build({
  entryPoints: ['agent/r6-worker.ts'],
  outfile: 'desktop-bundle/r6-worker.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['ffmpeg-static', '@ffprobe-installer/ffprobe'],
  logOverride: { 'empty-import-meta': 'silent' },
});
// Speech recognition runs as its own process (agent/speech-worker.ts, Electron utilityProcess);
// it loads sherpa-onnx at runtime from resources/sherpa, not from the bundle.
await build({
  entryPoints: ['agent/speech-worker.ts'],
  outfile: 'desktop-bundle/speech-worker.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['ffmpeg-static', '@ffprobe-installer/ffprobe', 'sherpa-onnx-node', 'onnxruntime-node'],
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
await rm('desktop-bundle/renderer', { recursive: true, force: true });
await cp('desktop/renderer', 'desktop-bundle/renderer', { recursive: true });
// The same fonts as the web library, local to the window (CSP without external sources).
await mkdir('desktop-bundle/renderer/fonts', { recursive: true });
await copyFile(
  'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  'desktop-bundle/renderer/fonts/inter-latin-wght-normal.woff2',
);
await copyFile(
  'src/streaming/fonts/archivo-latin-wdth-normal.woff2',
  'desktop-bundle/renderer/fonts/archivo-latin-wdth-normal.woff2',
);
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
// Text recognition (agent/ocr.ts): ONNX Runtime with only the CPU files for Windows x64
// (DirectML loads them only when needed) and the text recognition models. Both sit next to
// FFmpeg, not in the archive.
const ort = 'desktop-bundle/onnxruntime';
const native = 'bin/napi-v6/win32/x64';
await rm(ort, { recursive: true, force: true });
await mkdir(`${ort}/${native}`, { recursive: true });
// The JavaScript part including onnxruntime-common as one file: no node_modules folder in the
// extra resources. It still loads the binary relative to dist/.
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
// Start fresh: models from earlier builds (such as the PP-OCRv4 recognition model) must not
// tag along.
await rm('desktop-bundle/ocr', { recursive: true, force: true });
await mkdir('desktop-bundle/ocr', { recursive: true });
await copyFile(
  'node_modules/@gutenye/ocr-models/assets/ch_PP-OCRv4_det_infer.onnx',
  'desktop-bundle/ocr/ch_PP-OCRv4_det_infer.onnx',
);
// The PP-OCRv5 recognition model does not come from npm: downloaded, checked against size and
// SHA-256, and cached in the local model folder so a second build downloads nothing.
const latin = JSON.parse(await readFile('agent/ocr-models.json', 'utf8'));
const cache = join(
  process.env.LOCALAPPDATA ?? join(homedir(), '.cache'),
  process.env.LOCALAPPDATA ? 'ReplayHaven/models' : 'replayhaven',
);
for (const model of [latin.rec, latin.keys]) {
  const cached = join(cache, model.file);
  const fits = async (data) =>
    data.length === model.bytes && createHash('sha256').update(data).digest('hex') === model.sha256;
  let data = await readFile(cached).catch(() => undefined);
  if (!data || !(await fits(data))) {
    const response = await fetch(model.url);
    if (!response.ok)
      throw new Error(`${model.file} could not be downloaded (HTTP ${response.status}).`);
    data = Buffer.from(await response.arrayBuffer());
    if (!(await fits(data))) throw new Error(`${model.file}: wrong checksum, discarded.`);
    await mkdir(cache, { recursive: true });
    await writeFile(cached, data);
  }
  await writeFile(`desktop-bundle/ocr/${model.file}`, data);
}
// sherpa-onnx with its native library for Windows x64, side by side: addon.js looks for the addon
// in ../sherpa-onnx-win-x64. The client downloads the speech models only once the option is on.
await rm('desktop-bundle/sherpa', { recursive: true, force: true });
for (const pkg of ['sherpa-onnx-node', 'sherpa-onnx-win-x64'])
  await cp(`node_modules/${pkg}`, `desktop-bundle/sherpa/${pkg}`, { recursive: true });
await writeFile(
  'desktop-bundle/licenses/sherpa-onnx-Apache-2.0.txt',
  `sherpa-onnx ${require('sherpa-onnx-node/package.json').version} (https://github.com/k2-fsa/sherpa-onnx), Apache License 2.0, including its ONNX Runtime build (MIT).
Speech models are downloaded on first use: Parakeet TDT 0.6B v3 by NVIDIA (CC-BY-4.0, https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) and Silero VAD (MIT, https://github.com/snakers4/silero-vad).

${await readFile('node_modules/typescript/LICENSE.txt', 'utf8')}`,
);
await writeFile(
  'desktop-bundle/licenses/ONNX-Runtime-MIT.txt',
  `MIT License\n\nCopyright (c) Microsoft Corporation\n\n${(await readFile('LICENSE', 'utf8')).split('\n').slice(4).join('\n')}\nThird-party notices of ONNX Runtime: https://github.com/microsoft/onnxruntime/blob/main/ThirdPartyNotices.txt\n`,
);
await writeFile(
  'desktop-bundle/licenses/PaddleOCR-models-Apache-2.0.txt',
  `PaddleOCR PP-OCRv4 text detection model (https://github.com/PaddlePaddle/PaddleOCR), converted to ONNX by @gutenye/ocr-models (MIT), and the PP-OCRv5 latin recognition model, converted to ONNX by monkt/paddleocr-onnx (https://huggingface.co/monkt/paddleocr-onnx).\n\n${await readFile('node_modules/typescript/LICENSE.txt', 'utf8')}`,
);
// App icon from desktop/icon-source.png (512 px): window and tray use the PNG; executable,
// shortcuts and installer use the ICO with every size Windows displays.
const icon = 'desktop/icon-source.png';
await sharp(icon).resize(256, 256).png().toFile('desktop-bundle/icon.png');
await copyFile('desktop-bundle/icon.png', 'desktop-bundle/renderer/icon.png');
await copyFile('src/streaming/fonts/OFL.txt', 'desktop-bundle/licenses/Archivo-OFL-1.1.txt');
await copyFile(
  'node_modules/@fontsource-variable/inter/LICENSE',
  'desktop-bundle/licenses/Inter-OFL-1.1.txt',
);
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map((s) => sharp(icon).resize(s, s).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const entry = 6 + 16 * i;
  // 256 is stored as 0 in the ICO directory.
  header.writeUInt8(size % 256, entry);
  header.writeUInt8(size % 256, entry + 1);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[i].length;
});
await writeFile('desktop-bundle/icon.ico', Buffer.concat([header, ...images]));
await writeFile(
  'desktop-bundle/package.json',
  JSON.stringify({
    name: 'replayhaven-client',
    version,
    main: 'main.cjs',
    description: 'Local NVIDIA recording and AI client for ReplayHaven',
    author: 'ReplayHaven',
    private: true,
    dependencies: {},
  }),
);
await writeFile(
  'desktop-bundle/THIRD-PARTY.txt',
  'ReplayHaven Client includes Electron (MIT), Zod (MIT), FFmpeg 6.1.1 (GPL-3.0), FFprobe (GPL-3.0, Gyan build 20230213-2296078), ONNX Runtime 1.30 (MIT, CPU files for Windows x64) the PaddleOCR PP-OCRv4/PP-OCRv5 text models (Apache-2.0), sherpa-onnx (Apache-2.0) for speech recognition and the Inter and Archivo fonts (SIL OFL 1.1); its models (Parakeet TDT 0.6B v3, CC-BY-4.0; Silero VAD, MIT) are downloaded on first use. License texts and FFmpeg build configuration are in licenses/. Electron notices accompany the executable. FFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/e38092ef93 ; FFprobe source: https://github.com/FFmpeg/FFmpeg/tree/2296078 ; build distribution: https://www.gyan.dev/ffmpeg/builds/ ; package sources: https://github.com/eugeneware/ffmpeg-static and https://github.com/SavageCore/node-ffprobe-installer . Ollama and Qwen are installed separately. No model weights are bundled.',
);
console.log('Windows client prepared.');
