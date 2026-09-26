<p align="center">
  <img src="docs/images/banner.jpg" alt="ReplayHaven: your game clips, named by local AI and kept on your own server" width="100%">
</p>

<p align="center">
  <a href="https://github.com/SauerExe/ReplayHaven/actions/workflows/ci.yml"><img src="https://github.com/SauerExe/ReplayHaven/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-PolyForm%20Noncommercial-a78bfa" alt="PolyForm Noncommercial license"></a>
  <img src="https://img.shields.io/badge/client-Windows%2010%20%7C%2011-1e1e27" alt="Windows client">
  <img src="https://img.shields.io/badge/server-Docker%20amd64%20%7C%20arm64-1e1e27" alt="Docker server for amd64 and arm64">
  <img src="https://img.shields.io/badge/AI-local%20with%20Ollama-1e1e27" alt="Local AI with Ollama">
</p>

<p align="center">
  <b>Record as usual. ReplayHaven gives every clip a real title, keeps the original on your own server<br>and brings it back in a cinematic web library.</b>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#screenshots">Screenshots</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#faq">FAQ</a> ·
  <a href="docs/START.md">User guide</a> ·
  <a href="docs/SERVER.md">Server guide</a>
</p>

---

Your clip folder probably looks like `Counter-Strike 2 2026.09.24 - 21.14.07.02.DVR.mp4`, a hundred times over. ReplayHaven turns that into **“Ace auf Inferno”** (“Ace on Inferno”; generated titles are German for now) with a short description, tags and jump marks, and it does so on your own hardware: a small Windows client analyses each new recording with a local vision model, your own server keeps the original forever, and every device you sign in becomes a place to watch it again, at home or on the road.

## Features

<table>
  <tr>
    <td width="50%" valign="top"><b>Clips that name themselves</b><br>A local vision model looks at 24 or 48 frames of each clip, or one every 3 seconds across the whole clip, and suggests a title, a description, tags and highlight timestamps.</td>
    <td width="50%" valign="top"><b>Titles that stick to the facts</b><br>Kills, deaths, round and match results are read from what the game shows on screen. A title that claims more gets one correction round, otherwise a plain title is built from the confirmed events.</td>
  </tr>
  <tr>
    <td width="50%" valign="top"><b>Your hardware, your clips</b><br>The AI runs on your gaming PC through Ollama. Clips only travel to your own server. No cloud service, no subscription.</td>
    <td width="50%" valign="top"><b>Originals are sacred</b><br>Nothing on the gaming PC is renamed, moved or deleted. The server keeps an untouched copy, even if you delete the file at home.</td>
  </tr>
  <tr>
    <td width="50%" valign="top"><b>A library you want to open</b><br>The newest clip in the spotlight, rows for continue watching, new clips, favourites and each game, a detail view with the AI's jump marks, a full-screen player that skips from highlight to highlight, a library sorted by game with covers, search, filters, your own collections and automatic ones built from tags, on desktop and phone.</td>
    <td width="50%" valign="top"><b>Accounts, like Immich</b><br>Everyone signs in with their own account; a phone signs in by scanning a QR code. Single sign-on through Authelia or any other OpenID Connect provider is optional. Admins manage the archive, users watch.</td>
  </tr>
  <tr>
    <td width="50%" valign="top"><b>Pair a PC with a code</b><br>The client only needs the server address. It shows a six-digit code, you approve the same code in the web library, and the PC gets its own access that you can revoke at any time.</td>
    <td width="50%" valign="top"><b>Smooth over the internet</b><br>Heavy recordings such as 1080p120 at 50 Mbit/s get a lighter web version for streaming in the background. Downloads always deliver the untouched original.</td>
  </tr>
  <tr>
    <td width="50%" valign="top"><b>Out of the way while you play</b><br>As long as a game runs in full screen, the client only notes new clips and leaves GPU, CPU and connection to the game. One minute after you stop, it works through the queue.</td>
    <td width="50%" valign="top"><b>One small container</b><br>Node.js, SQLite and FFmpeg in a single Docker image. No GPU needed on the server. Runs on a NAS, a mini PC or any Linux box, at home or behind a reverse proxy.</td>
  </tr>
  <tr>
    <td width="50%" valign="top"><b>Extra precision for some games</b><br>Optional: Fortnite kills with weapon class and distance straight from the match replays, Rainbow Six map and round results and the Valorant killfeed from on-device text recognition, and a voice chat transcript for fun clips.</td>
    <td width="50%" valign="top"><b>Everything stays editable</b><br>AI results are suggestions. Titles, descriptions and tags can be changed, and a title or tags you set yourself stay when a clip is analysed again.</td>
  </tr>
</table>

The web library and the Windows client are in English by default and switch to German in their settings.

## Screenshots

<p align="center">
  <img src="docs/images/app-home.jpg" alt="Web library home page with the newest clip, Ace auf Inferno, in the spotlight and a continue watching row below" width="100%">
  <br><sub>The web library: the newest clip in the spotlight, everything else in rows below.</sub>
</p>

<table>
  <tr>
    <td width="50%"><img src="docs/images/app-detail.jpg" alt="Clip details with the AI's title, description, tags, confidence and highlights"><br><sub>What the local AI found in a clip: title, description, tags and highlights.</sub></td>
    <td width="50%"><img src="docs/images/app-player.jpg" alt="Full-screen player with highlight markers on the timeline and a Next highlight button"><br><sub>The full-screen player marks every highlight and jumps to the next one.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/app-library.jpg" alt="Library with game covers, search, filters and clip grid"><br><sub>The whole archive, by game, with search and filters.</sub></td>
    <td width="50%"><img src="docs/images/app-game.jpg" alt="Library filtered to Counter-Strike 2 with cover, genre, release date and description"><br><sub>Pick a game: cover, genre, release date and description are looked up automatically.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/app-smart.jpg" alt="Automatic Multi-kills collection built from clip tags"><br><sub>Automatic collections such as Aces, Clutches, Multi-kills or Trickshots fill themselves from your tags.</sub></td>
    <td width="50%"><img src="docs/images/app-settings.jpg" alt="Settings, Recording PCs: a pairing request with a six-digit code next to Approve and Deny, and the paired gaming PC"><br><sub>Settings → Recording PCs: approve a new PC when it shows the same code.</sub></td>
  </tr>
</table>

<p align="center">
  <img src="docs/images/client.png" alt="Windows client overview with the clip in progress, its steps and progress, the queue and recently archived clips with their AI titles" width="760">
  <br><sub>The Windows client: the clip in progress, what is queued and what just arrived in your archive.</sub>
</p>

<details>
<summary><b>On the phone</b></summary>
<p align="center"><img src="docs/images/app-mobile.jpg" alt="Web library on a phone with the spotlight clip and the bottom navigation" width="320"></p>
</details>

<sub>Screenshots use the built-in demo artwork and example texts. Generated clip titles and tags are still German for now.</sub>

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/architecture-dark.png">
  <img src="docs/images/architecture-light.png" alt="Gaming PC with the Windows client and local AI sends originals and AI results to your server, which serves the web library to any signed-in browser" width="100%">
</picture>

What happens when you save a clip:

```mermaid
flowchart LR
  rec["Recorder saves a clip"] --> wait["Client waits until<br/>the file is complete"]
  wait --> frames["24 or 48 frames,<br/>or the whole clip"]
  frames --> model["Qwen3.5 via Ollama<br/>describes the frames"]
  model --> rules["Fixed rules read kills, deaths<br/>and round results from the screen"]
  extras["Fortnite replays, R6 and<br/>Valorant text recognition,<br/>voice chat transcript"] -. optional .-> rules
  rules --> check["Title checked<br/>against the events"]
  check --> upload["Upload original<br/>and result"]
  upload --> server["Server: thumbnail,<br/>web version, metadata"]
  server --> library["Web library"]
```

Analysis can be switched off in the client. Clips are then archived without AI metadata, and the client works as a plain upload agent. How the recognition works and what has been measured is described in [docs/AI-RECOGNITION.md](docs/AI-RECOGNITION.md).

## Quick start

You need a machine for the server (anything that runs Docker) and the Windows PC you play on. Both can be the same machine.

### 1. Server

Install Docker Engine with the Compose plugin ([guide](https://docs.docker.com/engine/install/)), then:

```bash
git clone https://github.com/SauerExe/ReplayHaven.git && cd ReplayHaven
bash setup-server.sh
```

The script asks for the server address, generates the access key, builds the image and starts it. Running it again after an update rebuilds and keeps your `.env`.

<details>
<summary><b>Without a source checkout, from a published release</b></summary>

Every release publishes a multi-arch image to `ghcr.io/sauerexe/replayhaven`.

```bash
mkdir -p replayhaven && cd replayhaven
curl -fsSLO https://raw.githubusercontent.com/SauerExe/ReplayHaven/main/compose.yaml
curl -fsSL  https://raw.githubusercontent.com/SauerExe/ReplayHaven/main/.env.example -o .env
# edit .env: REPLAYHAVEN_ACCESS_TOKEN (openssl rand -hex 24) and REPLAYHAVEN_PUBLIC_ORIGIN (http://<server-ip>:8787)
docker compose up -d
```

</details>

Open the server address in a browser and create your account. The access key from `.env` is needed once for this, so nobody else can claim a server that is already reachable. Other devices then sign in with name and password, or scan the QR code under **Settings → Devices → Connect phone**.

Running it behind Coolify, Traefik, Caddy or nginx, with Authelia or another single sign-on, is covered in [docs/SERVER.md](docs/SERVER.md).

### 2. Gaming PC

1. Install `ReplayHaven-Client-Setup.exe` from the [releases](https://github.com/SauerExe/ReplayHaven/releases) or from **Settings → Recording PCs** on your server. The installer is not code-signed yet, so SmartScreen asks for confirmation. No release yet? Build it on Windows with `npm ci && npm run client:build`.
2. The setup assistant opens. Enter the server address and click **Connect**. The client shows a six-digit code; approve the same code under **Settings → Recording PCs** in the web library.
3. Pick your recording folder (subfolders included).
4. Install [Ollama](https://ollama.com/download/windows) and let the assistant download the model once: Qwen3.5 9B, about 6.6 GB.
5. Enter your in-game names, choose the optional extras and finish. New recordings are analysed once they are completely written and show up in the library a minute or two later.

The full user guide with every option and troubleshooting is [docs/START.md](docs/START.md).

## Game extras

These are optional and off by default. They add facts the frames alone cannot deliver reliably.

| Game              | What it adds                                                                         | Where it comes from                                                            |
| ----------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Fortnite          | Your kills and knocks with weapon class and distance, your elimination and victory   | The match replays Fortnite writes to `%LOCALAPPDATA%\FortniteGame\Saved\Demos` |
| Rainbow Six Siege | Map name and round results                                                           | Text recognition (PaddleOCR on ONNX Runtime) on the CPU, next to the GPU model |
| Valorant          | Your kills, headshots and deaths from the killfeed                                   | The same text recognition, matched against the player names you entered        |
| Any game          | What was said in voice chat, as context for fun clips without kills or round results | Parakeet speech recognition on the CPU; the transcript never leaves your PC    |

Command-line tools show what these sources contribute to your own clips before you rely on them, without AI and without uploading anything: `npm run fortnite`, `npm run r6`, `npm run audio`, `npm run laughs` and `npm run r6-replays`. The research notes and measurement plans behind them are in [docs](docs).

## Privacy

- **The AI runs on your PC.** With the Windows client, frames go to Ollama on the same machine. Nothing is sent to an AI service.
- **Clips go to your server only.** Apart from Ollama on the same PC, the client talks to the server address you entered. Models are downloaded once when you ask for them: Qwen3.5 through Ollama, the speech models for the voice chat transcript from Hugging Face and GitHub.
- **Your server, your accounts.** Passwords are stored as scrypt hashes, sessions and paired PCs can be revoked one by one, and single sign-on only talks to the provider you configure.
- **Game info by name.** The server looks up game names on Steam (and on IGDB if you add a key) to show covers and descriptions. Only the game name is sent. Without internet access the library simply shows no cover.
- **Server-side AI is opt-in.** If you configure Gemini as the server's AI provider, clips or frames from them are sent to Google for analysis. It is off unless you set it.
- **Replays stay local.** Fortnite replays list every player in a match. ReplayHaven takes only your own events from them; the other names are not used. Rainbow Six replays the client keeps for later stay on your PC.

## Requirements

| Component  | Requirement                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server     | Docker Engine 24+ with Compose v2.24+, linux/amd64 or linux/arm64, disk space for your clips. Without Docker: Node.js 24+ and FFmpeg.                         |
| Gaming PC  | Windows 10/11 x64. For local AI: [Ollama](https://ollama.com) and a GPU with about 10 GB VRAM for Qwen3.5 9B. CPU-only works, but slowly.                     |
| Recordings | MP4, M4V, MOV, WebM or MKV, up to 2 GB, 30 minutes and 8K per file. Light H.264 MP4 plays directly; everything else gets a web version transcoded on the CPU. |
| Recorder   | Anything that writes files into a folder: NVIDIA App (Instant Replay), OBS, Xbox Game Bar and others.                                                         |
| Browser    | Any current browser on desktop, tablet or phone. The library can be added to a phone's home screen.                                                           |

<details>
<summary><b>Configuration</b></summary>

All server settings are environment variables, documented in [`.env.example`](.env.example). The important ones:

| Variable                          | Purpose                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `REPLAYHAVEN_ACCESS_TOKEN`        | Key for creating the first account (and for older clients and scripts), at least 24 characters. Required.           |
| `REPLAYHAVEN_PUBLIC_ORIGIN`       | The address people open, e.g. `https://clips.example.com`. Several are allowed, separated by commas.                |
| `REPLAYHAVEN_TRUST_PROXY`         | Trust `X-Forwarded-*` headers behind a reverse proxy such as Traefik, Caddy or nginx.                               |
| `REPLAYHAVEN_HOST_PORT`           | Host port published by Compose (default 8787).                                                                      |
| `REPLAYHAVEN_IMAGE`               | Image to run. Defaults to the published GHCR image; `setup-server.sh` sets `replayhaven:local`.                     |
| `REPLAYHAVEN_PLAYBACK`            | `web` (default) creates lighter web versions of heavy clips; `original` always plays the original.                  |
| `REPLAYHAVEN_OIDC_*`              | Single sign-on through Authelia, Authentik, Keycloak or Pocket ID; `REPLAYHAVEN_PASSWORD_LOGIN=false` for SSO only. |
| `REPLAYHAVEN_CLIENT_DOWNLOAD_URL` | Where the download button points when no installer is mounted in `./release`. Release images set this.              |
| `REPLAYHAVEN_AI_PROVIDER`         | Optional server-side analysis (`none`, `local`, `gemini`). Not needed with the Windows client.                      |

Operations, backups, roles, reverse proxies, single sign-on and server-side AI are covered in [docs/SERVER.md](docs/SERVER.md).

</details>

## What's next

Ideas for later: share links, clip titles in English, and laughs and shouts from the microphone track as highlight markers. Audio cues and Rainbow Six replay events only go into the analysis once measurements on real clips show that they help.

## FAQ

<details>
<summary><b>Does ReplayHaven delete or move my recordings?</b></summary>

No. The client only reads. Originals on the gaming PC stay where they are, and the server keeps its own copy even after you delete the file at home. Removing a clip from the library keeps the original on the server.

</details>

<details>
<summary><b>Is the interface in English?</b></summary>

Yes. The web library, the sign-in screens and the Windows client are English by default and can be switched to German under **Settings → Appearance** (web) or **Settings → Language** (client). The titles, descriptions and tags the AI writes are German for now; English titles are on the list.

</details>

<details>
<summary><b>Do I need a powerful GPU?</b></summary>

For the local AI, a GPU with about 10 GB VRAM keeps analysis quick. Without one, Ollama runs on the CPU and takes much longer. You can also switch analysis off and use ReplayHaven as a plain archive. The server needs no GPU at all.

</details>

<details>
<summary><b>Does the client slow down my games?</b></summary>

It tries hard not to. With **Pause while gaming** (on by default), analysis and upload wait while a game fills the screen and continue one minute after you stop playing. New clips are still noticed and queued in the meantime.

</details>

<details>
<summary><b>Which games work?</b></summary>

All of them. Every clip gets a title and a description. Event tags such as kills or round wins need an on-screen message, so games without kill or round banners (co-op, survival, sandbox) get a title and description but no event tags. The voice chat transcript helps those clips get a title that fits.

</details>

<details>
<summary><b>How good are the titles?</b></summary>

They are suggestions from a model that sees frames, not the full video, so short moments can slip between them. Titles are checked against the events read from the screen, and everything can be edited. The analysis records its confidence with every result. Measurements on real clips are in [docs/AI-RECOGNITION.md](docs/AI-RECOGNITION.md).

</details>

<details>
<summary><b>Can I reach my library from outside my home?</b></summary>

Yes, behind an HTTPS reverse proxy or a VPN. Every device signs in with its own account (or a QR code), recording PCs are paired by approving their code, and heavy clips get a lighter web version so they play smoothly over a normal upload line. See [docs/SERVER.md](docs/SERVER.md) and [SECURITY.md](SECURITY.md).

</details>

<details>
<summary><b>Can friends or family watch too?</b></summary>

Yes. An admin creates accounts under **Settings → Users**, or lets them sign in through your single sign-on. Users can watch and download; editing, uploading, pairing PCs and managing accounts stay with admins.

</details>

<details>
<summary><b>Is there a macOS or Linux client?</b></summary>

Not yet. The server and the web library run anywhere; the client that watches the recording folder is Windows-only for now. Admins can upload clips from the browser on every system.

</details>

## Development

Node.js 24 or newer is required (SQLite is built in). The web UI and server run on Windows, macOS and Linux; the client installer is built on Windows.

```bash
npm ci
npm run media:refresh  # optional: game artwork for the demo library, fetched from Steam
npm run dev:all        # web UI on http://localhost:5173, server on 127.0.0.1:8787
```

The demo artwork belongs to the game publishers and is not part of the repository; without it the demo library shows empty tiles.

<details>
<summary><b>All commands</b></summary>

| Command                 | What it does                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `npm run dev`           | Web UI only (Vite, demo data, `/api` proxied to the server)                          |
| `npm run server`        | Server only, loopback, no access key needed                                          |
| `npm run client:dev`    | Windows client in Electron                                                           |
| `npm run check`         | Typecheck, ESLint and unit tests                                                     |
| `npm run format`        | Prettier                                                                             |
| `npm run test:e2e`      | Playwright browser tests (`npx playwright install chromium` once)                    |
| `npm run build`         | Production web UI into `dist/`                                                       |
| `npm run server:bundle` | Server bundle into `server-bundle/`                                                  |
| `npm run docker:build`  | Server image `replayhaven:local`                                                     |
| `npm run client:build`  | Windows installer into `release/` (Windows only)                                     |
| `npm run check:browser` | Screenshots of all views at 390–1920 px into `artifacts/visual/`                     |
| `npm run readme:images` | Regenerates the images in `docs/images` from the real interface (needs demo artwork) |

</details>

| Directory | Contents                                                                              |
| --------- | ------------------------------------------------------------------------------------- |
| `src`     | React web UI, domain models, demo data layer; home page and player in `src/streaming` |
| `server`  | Fastify API, SQLite, accounts and pairing, media processing, optional AI providers    |
| `agent`   | Folder watcher, upload retries, Ollama integration, game extras and measurement tools |
| `desktop` | Electron client (main, preload, renderer)                                             |
| `scripts` | Build, packaging, media refresh, browser checks and README images                     |
| `docs`    | Guides, design briefs, research notes and measurement plans                           |

The product and design brief is [docs/DESIGN.md](docs/DESIGN.md), and every settings screen follows [docs/SETTINGS-DESIGN.md](docs/SETTINGS-DESIGN.md). Read them before changing anything user-facing.

**Releasing:** tag a commit as `vX.Y.Z` and push the tag. The release workflow builds the Windows installer, publishes the multi-arch server image to `ghcr.io/sauerexe/replayhaven` and creates a GitHub release with installer, pinned `compose.yaml`, env template, setup script and checksums.

## Contributing

Bug reports, ideas and pull requests are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md). Please report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[PolyForm Noncommercial 1.0.0](LICENSE): free for personal use, hobby projects, research, schools, charities and other non-commercial purposes, including changing and sharing it on the same terms. Selling ReplayHaven, offering it as a paid service or using it for commercial purposes is not allowed without permission; ask via [GitHub](https://github.com/SauerExe/ReplayHaven/issues) if you need that. Releases up to and including 1.2.2 were published under the MIT License and stay available under it.

The demo artwork and trailers belong to their publishers, and the Windows installer bundles GPL-licensed FFmpeg builds; details in [THIRD-PARTY.md](THIRD-PARTY.md).
