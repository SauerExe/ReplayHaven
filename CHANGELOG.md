# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- The web app explains the Windows SmartScreen warning next to every client download button ("More
  info", then "Run anyway"), and the release notes and docs/START.md name the same two clicks.

## [1.1.6] - 2026-09-29

### Added

- The start page can be filtered by who recorded the clips, and under "Everyone" shows a
  "New from <name>" row per person. The choice carries over into the library and back.

## [1.1.5] - 2026-09-28

### Added

- The client setup asks "Without AI" or "With AI on this PC" up front and recommends one from the
  detected NVIDIA graphics card; setting up AI installs Ollama and the model with calm progress,
  and a failure offers to retry or continue without AI.
- Resumable uploads: the Windows client sends clips in 50 MiB pieces and continues where it
  stopped after a dropped connection or restart, so servers behind Cloudflare Tunnel (100 MB per
  request) accept large clips. Older servers still get the single upload. docs/SERVER.md explains
  the forward-auth (Authelia) exception the client needs for `/api/`.
- The web library can filter clips by who recorded them ("Recorded by"), and the clip details
  name the person. Clips uploaded from a paired PC belong to that PC's account;
  `admin.mjs assign-uploader <name> --yes` assigns older clips to one account.
- The installer backs up the database inside the volume before every update (newest three kept)
  and updates in place when run inside an existing install directory.
- The server records a schema version and refuses to start on a database written by a newer
  release, so pinning an older image cannot damage newer data.
- Server troubleshooting section in docs/SERVER.md; every documented setting is passed through
  in `compose.yaml` and the Coolify template.
- Opening a QR sign-in link while already signed in asks before switching accounts and names both.
- The web library shows a reload message instead of a blank page when a page fails to load after
  an update.

### Changed

- Sign-in attempts still being checked count toward the limit, so parallel requests cannot get
  past it; at most 64 password checks wait at once.
- `REPLAYHAVEN_TRUST_PROXY=1` now trusts one proxy hop instead of every hop.
- Only the PC that uploaded a clip (or another PC of the same account) can deliver its AI result.
- Uploads need 3 GB of free space on the server; leftovers of interrupted uploads are removed at
  startup. FFmpeg only reads video containers.
- The web library no longer stores server clips in the browser, skips unchanged poll results and
  sends bulk changes four at a time with one refresh at the end.
- The client pauses an upload when a game starts, opens the release page for updates and uses
  https for domain names without a scheme. Its error messages are translated.
- Release jobs get only the permissions they need; pre-release tags never become `latest`. Base
  images are pinned by digest and the image carries an SBOM.
- AI titles and descriptions: kill and win synonyms, streak counts with a single kill, invented
  map names in any game and claims added by the English translation are rejected. Events read
  only once from the screen no longer make an analysis "certain".

### Fixed

- The client explains when an address answers but is not ReplayHaven, such as the sign-in page of
  Authelia in front of the public address, instead of reporting "HTTP 200" as an error, and
  points to the address in the home network.
- The "Download Windows client" button keeps working when `.env` has an empty
  `REPLAYHAVEN_CLIENT_DOWNLOAD_URL=` line: release images keep their download address under
  `REPLAYHAVEN_RELEASE_DOWNLOAD_URL`, and only a set value overrides it.
- Changing the server address in the client no longer drops clips that were still waiting.
- A settings file with one bad field keeps all other settings (and a backup) instead of resetting.
- A database error in the background job no longer crashes the server; two simultaneous uploads
  of one file no longer fail with an orphaned copy.
- Shutdown finishes within seconds; a PC result survives a failed video preparation.
- Archived R6 matches keep their round times; a clip from the first round of a new match no
  longer archives the previous match.
- Speech recognition cannot hang on a stalled model download or a cancelled clip, and no longer
  transcribes a silent or game audio track.
- A Valorant killfeed that read nothing no longer removes all kills.

## [1.1.4] - 2026-09-28

### Added

- `admin.mjs purge-removed` deletes clips removed from the library for good and reports the space
  it frees; without `--yes` it only reports.
- The server logs server errors with their cause (FFmpeg's own message included) and failed
  sign-ins with address and name, for tools such as fail2ban; `REPLAYHAVEN_LOG_LEVEL` sets the
  level. Requests themselves are not logged.
- docs/SERVER.md: changes of your own go into `compose.override.yaml`, with examples, a backup
  before updates and how to restore one; banner, language and log settings have their own table.

### Changed

- The installer no longer replaces a `compose.yaml` you edited: it stops, leaves the new one as
  `compose.yaml.new` and asks to move your changes into `compose.override.yaml`.
- The client waits longer after every failed upload (1, 2, 4 … up to 30 minutes) and hashes a
  recording only once per version of the file.
- The R6 match archive keeps the newest 60 matches (about 1.8 GB).
- At most four password hashes run at once, so a burst of sign-ins cannot tie up the server.
- Removed three unused old pages of the web library.

### Fixed

- A clip whose video reached the server but whose AI result did not is completed on the next
  attempt: the client hands over the cached result instead of skipping it.
- Sentences of the AI description that claim a kill, death or win no event backs up are dropped,
  as the title check already did.
- Two unusable AI summaries no longer fail the analysis; the clip gets a title and description
  from the proven events.

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

### Fixed

- Error messages from the server, such as a wrong password, appear in the interface language
  instead of always in English.
- A server that cannot be reached shows a clear, translated message instead of the browser's
  "Failed to fetch".
- The sign-in page keeps a readable text column between 1400 and 1700 px.
- An English title is no longer rejected when the German one says "auf" plus a common word
  ("Kopfschuss auf Distanz" becomes "Long-Range Headshot").
- THIRD-PARTY.md, docs/START.md and .env.example match the client and the image tags again.

### Security

- **Fixed a sign-in bypass present since 1.0.0:** an API path with percent-escapes (for
  example `/%61pi/clips`) skipped the sign-in check, so anyone who could reach the server could
  list, download, upload and remove clips. The check now follows the route the server actually
  matched. Update every server that is reachable without a login proxy in front.
- The open mode of a server without access key and accounts no longer applies to requests a
  reverse proxy on the same machine forwards.
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

[Unreleased]: https://github.com/SauerExe/ReplayHaven/compare/v1.1.6...HEAD
[1.1.6]: https://github.com/SauerExe/ReplayHaven/compare/v1.1.5...v1.1.6
[1.1.5]: https://github.com/SauerExe/ReplayHaven/compare/v1.1.4...v1.1.5
[1.1.4]: https://github.com/SauerExe/ReplayHaven/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/SauerExe/ReplayHaven/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/SauerExe/ReplayHaven/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/SauerExe/ReplayHaven/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/SauerExe/ReplayHaven/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/SauerExe/ReplayHaven/releases/tag/v1.0.0
