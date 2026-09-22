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
