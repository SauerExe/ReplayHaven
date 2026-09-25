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
// Die Texterkennung läuft in einem Worker-Thread (agent/r6.ts). Die Datei liegt wie ONNX Runtime
// neben dem App-Archiv, sodass der Worker sie ohne asar-Unterstützung lädt.
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
// Die Spracherkennung läuft als eigener Prozess (agent/speech-worker.ts, Electron utilityProcess);
// sherpa-onnx lädt sie zur Laufzeit aus resources/sherpa, nicht aus dem Bündel.
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
// lädt sie erst bei Bedarf) und die Texterkennungsmodelle. Beides liegt neben FFmpeg, nicht im Archiv.
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
// Frisch anlegen: Modelle früherer Builds (etwa das PP-OCRv4-Lesemodell) sollen nicht mitreisen.
await rm('desktop-bundle/ocr', { recursive: true, force: true });
await mkdir('desktop-bundle/ocr', { recursive: true });
await copyFile(
  'node_modules/@gutenye/ocr-models/assets/ch_PP-OCRv4_det_infer.onnx',
  'desktop-bundle/ocr/ch_PP-OCRv4_det_infer.onnx',
);
// Das Lesemodell PP-OCRv5 kommt nicht aus npm: geladen, gegen Größe und SHA-256 geprüft, im
// lokalen Modellordner zwischengespeichert, damit ein zweiter Build nichts lädt.
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
    if (!response.ok) throw new Error(`${model.file} nicht ladbar (HTTP ${response.status}).`);
    data = Buffer.from(await response.arrayBuffer());
    if (!(await fits(data))) throw new Error(`${model.file}: falsche Prüfsumme, verworfen.`);
    await mkdir(cache, { recursive: true });
    await writeFile(cached, data);
  }
  await writeFile(`desktop-bundle/ocr/${model.file}`, data);
}
// sherpa-onnx samt nativer Bibliothek für Windows x64, nebeneinander: addon.js sucht das Addon in
// ../sherpa-onnx-win-x64. Die Sprachmodelle lädt der Client erst, wenn die Option an ist.
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
// App-Icon aus desktop/icon-source.png (512 px): Fenster und Tray nehmen das PNG, Programmdatei,
// Verknüpfungen und Installer das ICO mit allen Größen, die Windows anzeigt.
const icon = 'desktop/icon-source.png';
await sharp(icon).resize(256, 256).png().toFile('desktop-bundle/icon.png');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map((s) => sharp(icon).resize(s, s).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const entry = 6 + 16 * i;
  // 256 steht im ICO-Verzeichnis als 0.
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
    description: 'Lokaler NVIDIA-Aufnahme- und KI-Client für ReplayHaven',
    author: 'ReplayHaven',
    private: true,
    dependencies: {},
  }),
);
await writeFile(
  'desktop-bundle/THIRD-PARTY.txt',
  'ReplayHaven Client includes Electron (MIT), Zod (MIT), FFmpeg 6.1.1 (GPL-3.0), FFprobe (GPL-3.0, Gyan build 20230213-2296078), ONNX Runtime 1.30 (MIT, CPU files for Windows x64) the PaddleOCR PP-OCRv4/PP-OCRv5 text models (Apache-2.0) and sherpa-onnx (Apache-2.0) for speech recognition; its models (Parakeet TDT 0.6B v3, CC-BY-4.0; Silero VAD, MIT) are downloaded on first use. License texts and FFmpeg build configuration are in licenses/. Electron notices accompany the executable. FFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/e38092ef93 ; FFprobe source: https://github.com/FFmpeg/FFmpeg/tree/2296078 ; build distribution: https://www.gyan.dev/ffmpeg/builds/ ; package sources: https://github.com/eugeneware/ffmpeg-static and https://github.com/SavageCore/node-ffprobe-installer . Ollama and Qwen are installed separately. No model weights are bundled.',
);
console.log('Windows-Client vorbereitet.');
