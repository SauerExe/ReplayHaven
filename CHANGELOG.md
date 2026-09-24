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
- Optional Fortnite replay events: with "Fortnite-Replays einbeziehen" the client reads the
  match replays in `%LOCALAPPDATA%\FortniteGame\Saved\Demos` and takes your kills, knocks,
  elimination and victory from them, with weapon class and distance, instead of reading them
  from on-screen messages. Clips from a match still in progress wait until it ends (at most
  45 minutes). `npm run fortnite` shows what the replays contribute to your clips without AI.
- Audio tracks: probing lists every audio track, the microphone track of NVIDIA recordings
  with "Mikrofon als separate Spur" is found by title, level and order, and a track can be
  extracted as 16 kHz mono WAV. `npm run audio` shows the tracks and writes them out to listen.
- `npm run laughs`: a measurement tool that finds laughs and shouts in the microphone track with
  YAMNet on the CPU (downloaded on first use, pinned by SHA-256) and lists them per clip with
  time and strength, plus per-window scores for calibrating the threshold. The analysis does
  not use it yet.
- New home page in streaming style (`src/streaming`): a hero with the newest analysed clip,
  rows for continue watching, new, favourites and your top games, game and collection tiles, a
  clip detail dialog with the AI time stamps and a full-screen player with highlight markers
  and keyboard controls. Details and player follow the address (`?clip=`, `?play=`), so the
  back button closes them. `npm run dev` also shows it with sample data at
  `/streaming-preview.html`; the production build does not include the preview.
- `npm run r6-replays`: a measurement tool for Rainbow Six match replays. It builds the
  maintained r6-dissect fork from a pinned commit on first use (needs Go and Git), lists per
  match and round the map, side, outcome and your kills with the round clock, series, ace and
  clutch, and assigns clips to rounds by time. With `--uhr` it reads the round clock at the top
  of each assigned clip and converts your kills and death to clip seconds; `--csv` writes them
  with an empty column for the second you see in the video. The JSON output holds no player
  names or IDs. The analysis does not use it yet.
- Optional Rainbow Six text recognition: "R6: Karte und Rundenausgang per Texterkennung" reads
  two frames per second with PaddleOCR PP-OCRv4 on ONNX Runtime (CPU, in parallel to the GPU
  model) and takes the map name and round results from it. Titles may name the recognised map
  and no other. Kills are deliberately not read. The Windows client grows by about 45 MB.
  `npm run r6` shows map and round results per clip without AI. The recognition runs in a
  worker thread and keeps its models across restarts, so the client window stays responsive.
  With the option on, starting the client first loads it once and names a missing Microsoft
  Visual C++ runtime instead of leaving every clip without a map.

### Changed

- The README shows the product with screenshots of the web library, the AI summary and the
  Windows client, an architecture graphic for light and dark mode and a flow diagram.
  `npm run readme:images` regenerates all images from the real interface with demo data. The
  product brief moved from `agent.md` to `docs/DESIGN.md`, and new installs start with the
  neutral display name "Spieler".
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

- Recordings with a separate microphone track play with your voice in the library: the
  playback copy mixes all audio tracks (the video is copied, not re-encoded), since browsers
  only play the first track. Extra tracks are folded to the centre, as a mono microphone often
  sits on one channel of a stereo track. Server-side analysis with audio hears the mix as well.

- Analyses no longer fail when the model numbers frames across batches or returns one frame
  too few; unreadable batches are retried once and partially recovered.
- Time marks outside the clip no longer discard the whole analysis.
- "Spiel & Tags übernehmen" no longer replaces the folder game name with the model's guess.
