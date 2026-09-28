# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.3] - 2026-09-28

### Added

- The Windows client shows **Download update** when its server runs a newer release; the
  installer comes from that server, and nothing is asked of GitHub.
- Admin commands in the container for when nobody can sign in: `node server-bundle/admin.mjs
users` and `reset-password <name>`, which sets a new random password and signs out the
  account's browsers.
- The server image is attested like the installer and gets a major-version tag (`:1`), which
  `compose.yaml` and the Coolify template now follow instead of `:latest`.

### Changed

- The support banner only shows to admins of a connected server; family and friends on it are
  never asked. `REPLAYHAVEN_SUPPORT_BANNER=false` switches it off. The README has a Support
  section.
- The sign-in page is calmer and fuller: a clip preview with AI title, time marks and tags next to
  the pitch on wide screens, the sample title in the interface language, and wording that also
  holds for servers outside the home.
- Development happens on `develop`; releases are merged into `main` and tagged there. Both are
  protected, and the release workflow refuses tags that are not on `main`.
- Node.js 22.13 is enough to develop; CI and the image keep using 24. Lockfile changes show in
  diffs again.
- The whole web page declares a dark colour scheme, so browser widgets such as password-manager
  keys are drawn light.

### Security

- A paired PC's token is created when the PC picks it up; it is no longer kept in plain text
  between approval and pickup.
- Single sign-on no longer creates accounts for unknown identities unless
  `REPLAYHAVEN_OIDC_AUTO_CREATE=true`, and a prepared account is claimed only by the exact
  `preferred_username`, never by a display name or e-mail.
- Passwords are hashed with scrypt N = 2^17; older hashes are upgraded at the next sign-in.
- Two setup requests at the same time can no longer create two admins.

## [1.1.2] - 2026-09-28

### Added

- A small banner in the web library asks for a tip via PayPal, at most every four days per
  browser and only after the first four days. "Later" or following the link hides it for four
  days, "I already donated" hides it for good; nothing about it reaches the server.

## [1.1.1] - 2026-09-28

### Security

- Single sign-on: on a server without accounts only a member of `REPLAYHAVEN_OIDC_ADMIN_GROUP`
  becomes the first admin; everyone else creates it with the setup link, which now also works
  with password sign-in switched off. A prepared account is claimed only by exactly the same
  provider user name.
- Changing your password signs out your other browsers, and wrong current passwords count
  towards the per-address throttle.
- A pairing ticket of an admin who is demoted before it is redeemed pairs nothing.
- A paired PC can no longer report under another PC's device ID.

### Fixed

- `.env.example`, docs/SERVER.md and docs/START.md no longer say the access key keeps working
  after setup.
- The install script suggests the address of the default route instead of whatever
  `hostname -I` lists first (often Docker or Tailscale).
- The Steam link check matches the host, and the client smoke test renders its picture with
  scripts switched off instead of cutting them out.
- The README says which game languages event recognition covers.

## [1.1.0] - 2026-09-28

### Added

- English titles: titles, descriptions and time marks can be written in English or German
  (client: **Settings → Local AI → Title language**, following the window language on first
  setup; server: `REPLAYHAVEN_CONTENT_LANGUAGE`, default `en`, which also sets the language of
  Steam game descriptions). The analysis still runs and is checked in German; the finished
  result is translated, and a translation that loses the kill count or a time mark falls back to
  the checked German text.
- The web library shows the analysis tags ("Rundensieg", "Tod" …) in English when the interface
  is English; stored tags, filters and automatic collections are unchanged.
- Pairing by link: **Settings → Recording PCs → Connect this PC** opens the client through a
  `replayhaven://` link with a one-time ticket (10 minutes, stored only as a hash). The admin's
  click is the approval, so no address or code has to be typed. The link can also be pasted into
  the client's address field.
- The client's setup assistant finds ReplayHaven servers in the home network (port 8787).
- One-click local AI: the client downloads the official Ollama 0.34.3 installer, checks its size
  and SHA-256, installs it for the Windows user without admin rights and then downloads the
  model.
- Model choice in the client: Qwen3.5 9B (default) or 4B for graphics cards with 6 to 8 GB.
- One-line server installer (`install.sh` in every release, piped from
  `releases/latest/download/install.sh` into `bash`): checks Docker, downloads `compose.yaml` and
  `env.example` from the release and verifies them against `SHA256SUMS.txt`, writes `.env` with a
  new access key and the confirmed LAN address, starts the server and prints a setup link.
  Running it again updates and keeps `.env`.
- Deployment templates: `portainer-template.json` (Portainer app template for template collections) and
  `docker-compose.coolify.yml` (Coolify generates domain and access key).
- Setup link for the first account (`http://host:8787/#setup-key=…`): the sign-in page fills in
  the access key from the URL fragment, which is never sent to the server, and removes it from
  the address bar. While no account exists, the server also prints the link to its log.

### Security

- `npm run dev` serves the web UI on this machine only; `npm run dev:lan` opens it to the
  network. A server without accounts only stays open to requests addressed to this machine, also
  behind the dev proxy.
- Paired PCs of an admin who is demoted stop uploading.
- Only admins see the folders of recording PCs in `/api/status`.
- The access key only sets the server up: once the first account exists it is no longer accepted
  as a bearer token, and the key login of old versions (`/api/session`) is removed. Scripts pair
  like a PC: `npm run agent -- --pair`.
- Failed sign-ins are throttled per client address instead of for the whole server, so nobody can
  lock out everyone else.
- Pairing requests are limited to three open ones per address (twenty in total).
- The client asks before it uses a `replayhaven://` pairing link and shows the server it would
  upload to.
- The client refuses Ollama 0.34.4, which ignores the response schema, and offers to install the
  pinned 0.34.3.
- GitHub Actions are pinned to commit SHAs.

### Changed

- The client window is written in TypeScript: 24 typed modules in `desktop/renderer/src`,
  bundled with esbuild, instead of one plain-JavaScript file.
- `setup-server.sh` is meant for source checkouts and shares its steps with `install.sh`; the
  installer replaces it as a release asset.
- Release builds attest the Windows installer's provenance with GitHub artifact attestations;
  `gh attestation verify` checks it until the installer is code-signed.
- The README calls ReplayHaven source-available instead of open source, matching its
  PolyForm Noncommercial license.

### Fixed

- `/api/status` reports the release the image was built for (`REPLAYHAVEN_VERSION`).
- A clip whose video is not probed yet shows no resolution instead of German placeholder text.
- Code comments and docs no longer point to unpublished measurement notes;
  docs/AI-RECOGNITION.md explains the experiment numbers.

## [1.0.0] - 2026-09-26

The first public release.

### Windows client

- Watches your recording folder (NVIDIA App or any other recorder), waits until a clip is fully
  written, analyses it locally and uploads the original with its title, description, tags and
  time marks. Retries after connection loss and never uploads a recording twice, even after
  the server address changes.
- Local AI with Ollama and Qwen3.5 9B: frames from the end of the clip or spread over the whole
  clip, on-screen messages read verbatim and turned into kills, deaths, round and match results
  by fixed rules. Titles are checked against these events, name the count and the map ("Triple
  Kill auf Mirage") and get one correction round before a plain event title is used.
- Game extras: Fortnite match replays for exact kills, knocks, weapon and distance; Rainbow Six
  map and round results and Valorant kills and headshots from text recognition (PaddleOCR
  PP-OCRv5 on the CPU); R6 match replays kept with the clips; voice chat transcribed with
  Parakeet so fun clips get a title about the topic.
- Your in-game names per game, so the kill feed can be read from your side.
- Overview with the clip in work, the queue with an estimated finish and the recently archived
  clips; a setup assistant for server, folder, local AI, names and extras; settings in sections.
- Pause while gaming: analysis and uploads wait while a game fills the screen and resume a
  minute later. New clips are noticed during the game and processed afterwards.
- Tray menu, taskbar progress, notifications (never during a game), start with Windows and
  resume on start. English and German interface.

### Server

- Docker image for linux/amd64 and linux/arm64 with Compose file and `setup-server.sh`.
- Keeps originals, metadata in SQLite, thumbnails and deduplication by content.
- Smooth playback over the internet: clips above 12 Mbit/s, 60 fps or 1920 px get an H.264 web
  version (at most 60 fps, about 8 Mbit/s); the original stays available for download.
- Accounts like in Immich: an admin account created with the setup key, sign-in on every device
  for 30 days, a QR code that signs in a phone without a password and confirms when it worked.
- Recording PCs pair with a six-digit code that you approve in the browser.
- Single sign-on with OpenID Connect (Authelia, Authentik, Keycloak, Pocket ID …), admin and
  user roles, user management.
- Runs behind a reverse proxy from anywhere (`REPLAYHAVEN_PUBLIC_ORIGIN`,
  `REPLAYHAVEN_TRUST_PROXY`); a guide for Coolify, Traefik and Authelia in docs/SERVER.md.
- Game info from Steam, and optionally IGDB for games Steam does not list.

### Web library

- Streaming-style home page with the newest clip, rows for continue watching, new clips,
  favourites and your games; clip details with the AI time marks; a player with highlight
  markers, keyboard controls and a buffer bar.
- Library with game shelf, search, filters, sorting, bulk actions, collections and automatic
  collections (Aces, Clutches, Multi-kills, Headshots, Trickshots, Funny moments, Won matches,
  Boss fights).
- One settings area for account, devices, appearance, playback, server, recording PCs, users,
  game info and storage, plus a setup guide with copyable commands.
- Split sign-in screen with single sign-on, QR hint and language switch.
- English and German interface; installable on a phone's home screen.

### License

- PolyForm Noncommercial 1.0.0: free for personal and other non-commercial use, not for sale
  or commercial use.

[Unreleased]: https://github.com/SauerExe/ReplayHaven/compare/v1.1.3...HEAD
[1.1.3]: https://github.com/SauerExe/ReplayHaven/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/SauerExe/ReplayHaven/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/SauerExe/ReplayHaven/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/SauerExe/ReplayHaven/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/SauerExe/ReplayHaven/releases/tag/v1.0.0
