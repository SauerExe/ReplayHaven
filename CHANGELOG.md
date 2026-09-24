# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Web library with search, filters, collections, favourites and a keyboard-friendly player.
- Archive server: uploads, SQLite metadata, thumbnails, H.264 playback copies, content
  deduplication, shared access key.
- Windows client: watches a recording folder, analyses new clips locally with Ollama and
  Qwen3-VL, uploads originals plus AI results, retries after connection loss.
- Docker image (linux/amd64, linux/arm64), Compose setup and `setup-server.sh`.
- GitHub Actions for CI and releases (installer, GHCR image, release assets).

### Changed

- Clip tags are derived from on-screen messages the model reads (eliminations, deaths, round
  and match results, NVIDIA highlight names) instead of being picked by the model. Titles are
  checked against these events; a contradicting or copied title gets one correction round and
  otherwise a plain event title.
- A new analysis of an already archived clip replaces the previous analysis and its tags;
  titles and tags you set yourself are kept.
- The Windows client keeps a list of your in-game names instead of a single one. Each name can
  be tied to a game, suggested from the game folders of your recordings; the analysis tells the
  model only the names for the clip's game. A name from earlier versions applies to every game.

### Fixed

- Analyses no longer fail when the model numbers frames across batches or returns one frame
  too few; unreadable batches are retried once and partially recovered.
- Time marks outside the clip no longer discard the whole analysis.
- "Spiel & Tags übernehmen" no longer replaces the folder game name with the model's guess.
