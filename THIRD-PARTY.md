# Third-party notices

The ReplayHaven source code is licensed under the [MIT License](LICENSE). The following
components ship alongside it under their own terms.

## Demo media (`public/media`, `src/data/media.json`)

The example library shows official publisher artwork and streams publisher trailers from
the Steam CDN. Their sources are listed in `public/media/SOURCES.json`. All rights remain with
the respective publishers and rights holders. These assets are **not** covered by the MIT
License; they are included only to demonstrate the interface and may be replaced with your own
clips. Run `npm run media:refresh` to re-fetch them.

## Windows client (`ReplayHaven-Client-Setup.exe`)

The installer bundles:

- **Electron** (MIT). Its own third-party notices accompany the executable.
- **FFmpeg and FFprobe** (GPL-3.0 builds, see `licenses/` next to the installed app). They run
  as separate processes to read metadata and extract frames. Build details and source links are
  in `THIRD-PARTY.txt` inside the app directory. Sources: https://github.com/FFmpeg/FFmpeg,
  builds via https://github.com/eugeneware/ffmpeg-static and
  https://github.com/SavageCore/node-ffprobe-installer.
- **Zod** (MIT).
- **ONNX Runtime** (MIT), only the CPU files for Windows x64, for the optional text
  recognition of Rainbow Six clips. Source: https://github.com/microsoft/onnxruntime.
- **PaddleOCR PP-OCRv4** text detection and recognition models (Apache-2.0), as ONNX files from
  `@gutenye/ocr-models` (MIT). Source: https://github.com/PaddlePaddle/PaddleOCR.

The measurement tool `npm run laughs` (not part of the client) downloads **YAMNet** by Google
(Apache-2.0) on first use, as the unchanged ONNX conversion `audiomagic/yamnet-onnx` pinned to a
revision and SHA-256, and keeps it in a local cache. It is neither bundled nor redistributed.
Source: https://github.com/tensorflow/models/tree/master/research/audioset/yamnet.

The measurement tool `npm run r6-replays` (not part of the client) builds **r6-dissect** (MIT)
on your machine with Go, from the maintained fork `Gipson62/r6-dissect` pinned to a commit. It is
neither bundled nor redistributed. Sources: https://github.com/Gipson62/r6-dissect and the
original https://github.com/redraskal/r6-dissect.

Ollama and the Qwen3-VL model are **not** bundled. The client only opens the official Ollama
download page and pulls the model when you click the button. See https://ollama.com and
https://ollama.com/library/qwen3-vl for their licenses.

## Server image

The Docker image is based on the official `node` Alpine image and installs `ffmpeg`, `tini` and
`ca-certificates` from Alpine packages under their respective licenses (FFmpeg: GPL).

## npm dependencies

Runtime and build dependencies are listed in `package.json`; their licenses are in
`node_modules/<package>/LICENSE` after `npm ci`.
