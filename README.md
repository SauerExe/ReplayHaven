# ReplayHaven

Self-hosted archive for your game clips.

**Record as usual (NVIDIA App, OBS, Xbox Game Bar) → the Windows client names and describes the clip with a local vision model → your own server keeps the original and shows it in a cinematic web library.**

- Originals are never renamed, moved or deleted on the gaming PC. The server keeps a copy forever.
- AI runs on your gaming PC, not in the cloud: Ollama with Qwen3-VL 4B looks at frame samples and suggests title, summary, game, tags and highlight timestamps. Everything stays editable.
- The server is a single Docker container: Node.js, SQLite and FFmpeg. No GPU needed. Runs on any Linux box, NAS or mini PC (x86-64 or arm64).
- The web library has search, filters per game, collections, favourites, resume playback and a keyboard-friendly player. The interface language is currently German.

## How it fits together

```text
Gaming PC (Windows)                         Server (Docker)                    Browser
┌──────────────────────────────┐   HTTPS/LAN   ┌────────────────────────┐        ┌────────────┐
│ NVIDIA / OBS writes clip     │ ───────────▶  │ stores original        │ ◀────▶ │ web library│
│ ReplayHaven Client:            │  original +   │ thumbnail, playback    │        │ player     │
│  waits until file is done    │  AI result    │ copy, SQLite metadata  │        │ collections│
│  samples frames, asks Ollama │               │ serves the web UI      │        └────────────┘
└──────────────────────────────┘               └────────────────────────┘
```

## Quick start

### 1. Server

You need Docker Engine with the Compose plugin ([install guide](https://docs.docker.com/engine/install/)).

**Published image (no source checkout):**

```bash
mkdir -p replayhaven && cd replayhaven
curl -fsSLO https://raw.githubusercontent.com/SauerExe/ReplayHaven/main/compose.yaml
curl -fsSL  https://raw.githubusercontent.com/SauerExe/ReplayHaven/main/.env.example -o .env
# edit .env: REPLAYHAVEN_ACCESS_TOKEN (openssl rand -hex 24) and REPLAYHAVEN_PUBLIC_ORIGIN (http://<server-ip>:8787)
docker compose up -d
```

**From source:**

```bash
git clone https://github.com/SauerExe/ReplayHaven.git && cd ReplayHaven
bash setup-server.sh
```

The script asks for the server address, generates the access key, builds the image and starts it. Re-running it later rebuilds after an update and keeps your `.env`.

Then open the server address in a browser, go to **Einstellungen → KI & Server** and enter the access key. The **Geräte** page offers the Windows client for download.

### 2. Gaming PC

1. Install `ReplayHaven-Client-Setup.exe` from the [latest release](https://github.com/SauerExe/ReplayHaven/releases/latest) or from the server's Geräte page. The installer is not code-signed yet, so SmartScreen asks for confirmation.
2. Pick your recording folder (subfolders included), enter the server address and the access key.
3. Install [Ollama](https://ollama.com/download/windows), then click **Modell laden** once to pull Qwen3-VL 4B (about 3.3 GB).
4. Click **Analyse & Upload starten**. New recordings are analysed after they finish writing and appear in the library within a minute or two.

Pause the client while playing if you need the GPU. Analysis can also be switched off; clips are then archived without AI metadata.

The German step-by-step guide with troubleshooting is in [docs/START.md](docs/START.md).

## Requirements

| Component  | Requirement                                                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server     | Docker Engine 24+ with Compose v2.24+, linux/amd64 or linux/arm64, disk space for your clips. Without Docker: Node.js 24+ and FFmpeg.                |
| Gaming PC  | Windows 10/11 x64. For local AI: [Ollama](https://ollama.com) and a GPU with roughly 8 GB VRAM or more for the 4B model. CPU-only works but is slow. |
| Recordings | MP4, M4V, MOV, WebM or MKV, up to 2 GB, 30 minutes and 8K per file. H.264 MP4 plays directly; other codecs get a CPU-transcoded playback copy.       |

## Configuration

All server settings are environment variables, documented in [`.env.example`](.env.example). The important ones:

| Variable                          | Purpose                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `REPLAYHAVEN_ACCESS_TOKEN`        | Shared key for browser and client, at least 24 characters. Required for network access.                |
| `REPLAYHAVEN_PUBLIC_ORIGIN`       | Exactly the address users open, e.g. `http://192.168.1.20:8787` or `https://clips.example.com`.        |
| `REPLAYHAVEN_HOST_PORT`           | Host port published by Compose (default 8787).                                                         |
| `REPLAYHAVEN_IMAGE`               | Image to run. Defaults to the published GHCR image; `setup-server.sh` sets `replayhaven:local`.        |
| `REPLAYHAVEN_CLIENT_DOWNLOAD_URL` | Where the download button points when no installer is mounted in `./release`. Release images set this. |
| `REPLAYHAVEN_AI_PROVIDER`         | Optional server-side analysis (`none`, `local`, `gemini`). Not needed with the Windows client.         |

Operations, backups, reverse proxies and server-side AI are covered in [docs/SERVER.md](docs/SERVER.md) (German).

## Development

Node.js 24 or newer is required (SQLite is built in). Windows, macOS and Linux work for the web UI and server; the client installer is built on Windows.

```bash
npm ci
npm run dev:all        # web UI on http://localhost:5173, server on 127.0.0.1:8787
```

| Command                 | What it does                                                      |
| ----------------------- | ----------------------------------------------------------------- |
| `npm run dev`           | Web UI only (Vite, demo data, `/api` proxied to the server)       |
| `npm run server`        | Server only, loopback, no access key needed                       |
| `npm run client:dev`    | Windows client in Electron                                        |
| `npm run check`         | Typecheck, ESLint and unit tests                                  |
| `npm run format`        | Prettier                                                          |
| `npm run test:e2e`      | Playwright browser tests (`npx playwright install chromium` once) |
| `npm run build`         | Production web UI into `dist/`                                    |
| `npm run server:bundle` | Server bundle into `server-bundle/`                               |
| `npm run docker:build`  | Server image `replayhaven:local`                                  |
| `npm run client:build`  | Windows installer into `release/` (Windows only)                  |
| `npm run check:browser` | Screenshots of all views at 390–1920 px into `artifacts/visual/`  |

### Project layout

| Directory | Contents                                                     |
| --------- | ------------------------------------------------------------ |
| `src`     | React web UI, domain models, demo data layer                 |
| `server`  | Fastify API, SQLite, media processing, optional AI providers |
| `agent`   | Folder watcher, upload retry logic, Ollama integration       |
| `desktop` | Electron client (main, preload, renderer)                    |
| `scripts` | Build, packaging, media refresh and browser checks           |
| `docs`    | End-user and operations guides                               |
| `.github` | CI and release workflows, issue templates                    |

`agent.md` is the product and design brief the web UI is built from. Read it before changing anything user-facing.

### Releasing

Tag a commit as `vX.Y.Z` and push the tag. The release workflow builds the Windows installer, publishes the multi-arch server image to `ghcr.io/sauerexe/replayhaven` and creates a GitHub release with installer, pinned `compose.yaml`, env template, setup script and checksums.

## Status and limitations

- One shared access key, no user accounts, no public share links yet. Keep the server in your LAN or behind HTTPS/VPN.
- The analysis samples 24 or 48 frames per clip and does not listen to audio, so short events can be missed. Results are suggestions.
- Collections, playback progress and display settings are stored per browser for now.
- The web UI is German only. Translations are welcome.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

## License

MIT, see [LICENSE](LICENSE). The demo artwork and trailers belong to their publishers, and the Windows installer bundles GPL-licensed FFmpeg builds; details in [THIRD-PARTY.md](THIRD-PARTY.md).
