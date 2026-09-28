# Third-party notices

The ReplayHaven source code is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). The following
components ship alongside it under their own terms.

## Demo media (`public/media`, `src/data/media.json`)

The example library shows official publisher artwork and streams publisher trailers from
the Steam CDN. The artwork is **not** part of this repository: `npm run media:refresh` downloads
it from the Steam store into `public/media` on your machine (ignored by Git) and lists the
sources in `public/media/SOURCES.json`. All rights remain with the respective publishers and
rights holders; the assets are not covered by that license and only demonstrate the
interface. The Docker image and the Windows installer do not contain them.

## Fonts (`src/streaming/fonts`)

The streaming-style home page components use **Archivo** by The Archivo Project Authors (SIL
Open Font License 1.1), the Latin subset with width and weight axes from
`@fontsource-variable/archivo` 5.3.0. The license text is in `src/streaming/fonts/OFL.txt`.
Source: https://github.com/Omnibus-Type/Archivo.

The web UI uses **Inter** by Rasmus Andersson (SIL Open Font License 1.1), the variable font
from `@fontsource-variable/inter` 5.3.0. Source: https://github.com/rsms/inter.

## Windows client (`ReplayHaven-Client-Setup.exe`)

The installer bundles:

- **Electron** (MIT). Its own third-party notices accompany the executable.
- **FFmpeg and FFprobe** (GPL-3.0 builds, see `licenses/` next to the installed app). They run
  as separate processes to read metadata and extract frames. Build details and source links are
  in `THIRD-PARTY.txt` inside the app directory. Sources: https://github.com/FFmpeg/FFmpeg,
  builds via https://github.com/eugeneware/ffmpeg-static and
  https://github.com/SavageCore/node-ffprobe-installer.
- **Zod** (MIT).
- The **Inter** and **Archivo** fonts (SIL Open Font License 1.1), the same files as in the web
  UI (see Fonts above). Their license texts are in `licenses/Inter-OFL-1.1.txt` and
  `licenses/Archivo-OFL-1.1.txt`.
- **ONNX Runtime** (MIT), only the CPU files for Windows x64, for the optional text
  recognition of Rainbow Six clips. Source: https://github.com/microsoft/onnxruntime.
- **PaddleOCR** models (Apache-2.0): the PP-OCRv4 text detection model as an ONNX file from
  `@gutenye/ocr-models` (MIT), and the PP-OCRv5 Latin recognition model converted to ONNX by
  `monkt/paddleocr-onnx`, checked against a pinned SHA-256 at build time. Sources:
  https://github.com/PaddlePaddle/PaddleOCR and https://huggingface.co/monkt/paddleocr-onnx.
- **sherpa-onnx** (Apache-2.0) with its bundled ONNX Runtime build (MIT), for the optional
  voice chat transcription. Source: https://github.com/k2-fsa/sherpa-onnx.

With "Transcribe voice chat" turned on, the client downloads two models on first use, each
pinned to a revision and SHA-256, and keeps them in `%LOCALAPPDATA%\ReplayHaven\models`. They are
not bundled: **Parakeet TDT 0.6B v3** by NVIDIA (CC-BY-4.0, int8 ONNX export by k2-fsa,
https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) and **Silero VAD** (MIT,
https://github.com/snakers4/silero-vad).

The measurement tool `npm run laughs` (not part of the client) downloads **YAMNet** by Google
(Apache-2.0) on first use, as the unchanged ONNX conversion `audiomagic/yamnet-onnx` pinned to a
revision and SHA-256, and keeps it in a local cache. It is neither bundled nor redistributed.
Source: https://github.com/tensorflow/models/tree/master/research/audioset/yamnet.

The measurement tool `npm run r6-replays` (not part of the client) builds **r6-dissect** (MIT)
on your machine with Go, from the maintained fork `Gipson62/r6-dissect` pinned to a commit. It is
neither bundled nor redistributed. Sources: https://github.com/Gipson62/r6-dissect and the
original https://github.com/redraskal/r6-dissect.

Ollama and the Qwen3.5 model are **not** bundled. When you click **Install Ollama**, the client
downloads the official Ollama installer (a pinned version, checked against size and SHA-256) and
runs it for your Windows user; it pulls the model when you click the button. See https://ollama.com and
https://ollama.com/library/qwen3.5 for their licenses.

## Server image

The Docker image is based on the official `node` Alpine image and installs `ffmpeg`, `tini` and
`ca-certificates` from Alpine packages under their respective licenses (FFmpeg: GPL).

The server bundle includes, among other npm packages:

- **openid-client** 6.8.8 (MIT) for single sign-on with OpenID Connect. Source:
  https://github.com/panva/openid-client.
- **oauth4webapi** 3.8.8 (MIT) and **jose** 6.2.12 (MIT), dependencies of openid-client.
  Sources: https://github.com/panva/oauth4webapi and https://github.com/panva/jose.

## Web UI

- **qrcode** 1.5.4 (MIT) draws the QR codes for signing in other devices. Source:
  https://github.com/soldair/node-qrcode.

## npm dependencies

Runtime and build dependencies are listed in `package.json`; their licenses are in
`node_modules/<package>/LICENSE` after `npm ci`.
