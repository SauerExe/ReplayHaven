# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/SauerExe/ReplayHaven/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/SauerExe/ReplayHaven/releases/tag/v1.0.0
