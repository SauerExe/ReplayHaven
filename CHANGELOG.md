# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Accounts like in Immich: the first visit creates an account (the access key from the server
  setup is needed once, so nobody else can claim an exposed server). Every device then signs
  in with name and password and stays signed in for 30 days, renewed on use.
- "Handy verbinden" under Geräte shows a QR code that signs in one more device without a
  password; it is valid for five minutes and works once.
- Pairing for recording PCs: the client only needs the server address, shows a six-digit
  code, and the owner approves the matching request under Geräte. The PC receives its own
  access, stored encrypted with the Windows account. All browsers and PCs are listed under
  Geräte and can be removed one by one. The access key keeps working for older clients.
- A redesigned Windows client: a status overview with the clip in work (preview image, steps,
  progress, elapsed time), the queue with states and an estimated finish, and the recently
  archived clips with their AI titles. A seven-step setup wizard guides through server,
  recording folder, local AI, player names and recognition options. Progress shows in the
  taskbar, the tray menu pauses or resumes, and a notification announces each archived clip
  (never during a game). The client can resume on start and start with Windows.

## [1.0.0] - 2026-09-25

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
- New web UI in streaming style (`src/streaming`). The home page shows a hero with the newest
  analysed clip, rows for continue watching, new, favourites and your top games, game and
  collection tiles, a clip detail dialog with the AI time stamps and a full-screen player with
  highlight markers and keyboard controls. Details and player follow the address (`?clip=`,
  `?play=`), so the back button closes them. `npm run dev` also shows it with sample data at
  `/streaming-preview.html`; the production build does not include the preview.
- Library and collections in the same style. The library opens with a shelf of your games
  with the same covers, names and counts as "Deine Spiele"; picking a game shows its genre,
  release date and description from Steam, with a link to its store page. Search also finds
  the Steam name and genre. Search, filters, sorting, selection with favourite, add to
  collection and delete stay as before, and every clip has a menu for rename, tags, share,
  download, delete and the full clip page. Collections show their games and total length and
  play their clips in order.
- Automatic collections built from clip tags: Aces, Clutches, Mehrfach-Kills, Headshots,
  Trickshots, Lustige Momente, Gewonnene Matches and Bosskämpfe. They use the tags the Windows
  client sets (Ace, Clutch, Multikill, Headshot, Sieg) plus your own tags in common spellings;
  Trickshots also take No-Scopes from titles and jump marks. A collection appears once two clips
  match, on the collections page and as a row on the home page, keeps itself up to date and can
  be saved as a regular collection. Nothing is detected beyond the tags: funny moments and boss
  fights only fill up when you (or Gemini) tag clips that way.
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
- Valorant kills, headshots and deaths from the kill feed: the text recognition reads only the
  top-right corner twice a second and matches your in-game names; your name on the left is a
  kill, on the right your death. These replace kills and deaths the model guessed from the
  screen (it took the previous round's combat report for a death). Needs your Valorant names,
  including older ones.
- "Ganzer Clip · ein Bild alle 3 Sekunden" in the client: frames spread evenly over the whole
  clip instead of two thirds from the end, so kill-feed lines, which stay about five seconds,
  are all seen. Short clips still get at least 24 frames.
- "R6-Replays zu Clips aufbewahren" in the client, on by default: after an R6 clip is uploaded,
  the match it was saved in is copied from the game's MatchReplay folder (the game keeps only
  about 30 matches, 30 MB each), so exact kills and rounds can be read from it later. The newest
  match started before the clip wins; rounds written later are added once the game is closed.
- Clips the NVIDIA App files under "Desktop" or "Base Profile" get the game that was in the
  foreground in the two minutes before saving: known games by their NVIDIA folder name, others
  by window title.
- "Beim Spielen pausieren" in the client, on by default: while a game fills the screen
  (fullscreen or borderless window), analysis and uploads wait, and resume one minute after the
  game left the foreground. Browsers, video players and maximised windows do not count.
- "Voice-Chat mitschreiben (Spaßclips)" in the client: Parakeet TDT 0.6B v3 via sherpa-onnx
  transcribes the microphone track (or the mixed track) on the CPU in a separate process, a few
  seconds per clip; the models (about 670 MB) are downloaded once on first use and checked by
  SHA-256. The transcript goes to the summary, so clips without game events can be titled after
  a joke, a question or a mishap in the chat. A short text-only question first asks the model
  what the talk is about, and the title rule then names that topic; single words and quoted
  sentences do not count as a topic. Titles about the chat itself ("Verwirrung im Voice-Chat")
  are rejected, and the fallback title keeps the topic of the later proposal.

### Changed

- New app icon for the Windows client, also embedded in the program file, shortcuts and
  installer (they showed the Electron icon before).
- Game info from Steam is refreshed on its own: after uploads, game detection and renamed games,
  once at start and every hour for due entries, and on demand under Einstellungen → Spielinfos,
  which also shows how many games are matched. Covers fall back to Steam's header image.
- Optional second source for game info: with `REPLAYHAVEN_IGDB_CLIENT_ID` and
  `REPLAYHAVEN_IGDB_CLIENT_SECRET` the server asks IGDB (Twitch) for games Steam does not list,
  such as Valorant, Fortnite and Minecraft, preferring the main game over ports and editions.
- A setup guide in the web UI walks through server, access key and Windows client with
  copyable commands; settings, devices and collections pages share one heading and layout.
- The player's volume opens as a vertical slider on hover, like on streaming services; a click
  on the speaker mutes.
- Default model is Qwen3.5 9B instead of Qwen3-VL 8B. On twelve hand-checked clips it named the
  proven event in 6 of 6 titles instead of 5 of 6, at the same speed (docs/KI-ERKENNUNG.md).
- Text recognition reads with the PP-OCRv5 latin model (downloaded and checked by SHA-256 when
  the client is built): 62 instead of 53 of 75 kill-feed names read exactly, at the same speed.
- Kills spread over a clip count as one multi-kill with their number ("Vierfach-Kill"), and it
  may lead the title even when the kills happen before the final seconds.
- Time marks for kills and deaths start one second before the last frame without the message
  instead of on the message, which appears after the kill; several kills keep a mark each.
- Game shelf in the library pages with arrows like the rows on the home page.
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

- R6 text recognition with the PP-OCRv5 reader: it reads banners without spaces
  ("NIGHTHAVENLABS", "WONROUND2"), so neither maps nor round results were found. Map names are
  now compared without spaces and with one misread letter allowed for long names, banners are
  split back into words, and a round banner read in pieces ("YOURTEAA" | "WONROUND2") still
  counts. Only capitalised lines count as a map, so the room "Tower" on Skyscraper is not one.
  In 12 R6 clips: 8 maps and 6 round results instead of 5 maps (one wrong) and none.
- Clips up to 30 seconds, usually trimmed by hand, count as one moment, so an early kill
  names the title. A title about the own death must say whose elimination it was
  ("Ausgeschaltet von …"), and fallback titles put the map after the first event.
- Clips in the old NVIDIA folder "R6siege" are recognised as Rainbow Six, so text
  recognition and your R6 names apply to them.
- Titles: with a recognised map and an event, the map is required ("… auf Oregon"); a
  multikill says how many kills were headshots ("Doppel-Kill per Kopfschuss"), plural
  "Kopfschüsse" counts as a kill, and a title claiming more headshots than proven is rejected.
- Steam game info for Rainbow Six Siege: Steam answers the old app id under its new one.
- Closing a dialog opened from a clip menu in the library, collections or clip detail returns
  focus to the menu button.
- R6 kill pop-ups read as "+100 | Kill" count as kills, and one pop-up on two frames in a row
  counts once unless the alive count changed. Titles naming more kills than counted, an "Ace"
  (in R6 an operator), or a place the text recognition never read are corrected.
- Sample collections and the "Beispiel-Cards" label disappear once a server is connected.
- The library search field showed two focus rings.
- Recordings with a separate microphone track play with your voice in the library: the
  playback copy mixes all audio tracks (the video is copied, not re-encoded), since browsers
  only play the first track. Extra tracks are folded to the centre, as a mono microphone often
  sits on one channel of a stereo track. Server-side analysis with audio hears the mix as well.

- Analyses no longer fail when the model numbers frames across batches or returns one frame
  too few; unreadable batches are retried once and partially recovered.
- Time marks outside the clip no longer discard the whole analysis.
- "Spiel & Tags übernehmen" no longer replaces the folder game name with the model's guess.

[Unreleased]: https://github.com/SauerExe/ReplayHaven/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/SauerExe/ReplayHaven/releases/tag/v1.0.0
