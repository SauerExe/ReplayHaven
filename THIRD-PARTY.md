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

Ollama and the Qwen3-VL model are **not** bundled. The client only opens the official Ollama
download page and pulls the model when you click the button. See https://ollama.com and
https://ollama.com/library/qwen3-vl for their licenses.

## Server image

The Docker image is based on the official `node` Alpine image and installs `ffmpeg`, `tini` and
`ca-certificates` from Alpine packages under their respective licenses (FFmpeg: GPL).

## npm dependencies

Runtime and build dependencies are listed in `package.json`; their licenses are in
`node_modules/<package>/LICENSE` after `npm ci`.
