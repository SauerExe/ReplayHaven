# Concept: Recognition for all games

**Goal.** Titles, tags and timestamps should be right in every game, not just in Fortnite and Rainbow Six. Today the AI reads on-screen messages from 24 or 48 frames and fixed code interprets them; results are only exact where a replay (Fortnite) or text recognition (R6) is added. This concept sorts out where proven events for the other games can come from, what measurably improves on the image and audio side, and in which order that pays off.

It is based on research from 2026-09-24 (sources at the end). When it was written, none of it had been measured, so every stage ends with a measurement step, as in `MEASUREMENT-PLAN.md`; what has been measured since is recorded in the measurement sections further down. Anything that only comes from second-hand sources is marked _unconfirmed_.

Experiment numbers in the code and here (E12, E17 …) refer to the maintainer's measurement notes. They are not published because the test clips and their ground truth contain real player names; the numbers that matter are quoted where they are used.

## What already exists

_This section describes the state on 2026-09-24, when the concept was written. Since then Qwen3.5 9B is the default model, the whole clip can be analysed, text recognition uses PP-OCRv5 and also reads the Valorant killfeed, and voice chat is transcribed with Parakeet; see the measurements below._

- `server/media.ts`: ffmpeg extracts frames at 1280 px width, two thirds from the last 30 seconds.
- `agent/ollama.ts`: Qwen3-VL 8B classifies four frames at a time (gameplay, result, menu, loading screen, respawn) and copies messages verbatim; every frame carries its timestamp as text, the way the model was trained.
- `agent/events.ts`: fixed code interprets the messages as kills, deaths, round and match results; the model does not interpret on its own.
- `agent/fortnite.ts`, `agent/r6.ts`: exact sources that replace events read from the screen.
- `agent/laughs.ts`, `AUDIO-CONCEPT.md`: laughs and shouts from the microphone track as a measurement tool, not yet part of the analysis.
- The game name comes from the recording's folder and is considered unreliable.

## The principle: source before image, image before guesswork

Everything titles and tags should carry needs a ranking of evidence, and the analysis takes the highest one available for each event:

1. **Game data.** Replay, demo, local game API or the markers of Steam's recording. Exact, with time, weapon, opponent.
2. **On-screen text.** Text recognition on fixed HUD regions, interpreted by code, as with R6 today.
3. **Audio.** Loudness peaks, laughs, game announcements, transcript.
4. **Description by the AI.** Only what none of the three sources provides: what can be seen, how it feels, a title in gamer language.

Studies on highlight detection in gameplay videos agree that audio is the strongest single signal and that an image model is poor at locating events in time within a video (VideoGameQA-Bench: the best model found 36 % of the sought moments). The AI should therefore name candidates, not find them.

## Stage 1: Which game

The game name decides which sources, HUD regions and announcements apply. Three ways, from most to least reliable:

- **File name and location.** The NVIDIA App writes `[Game] YYYY.MM.DD - HH.MM.SS.ii.DVR.mp4` into `Videos\<Game>\` and sets the tag `EncodedBy = "GeForce SHARE"` at the end of the file. Game Bar writes the game name with the date into the file name. Steam recordings carry the app ID in the folder and timeline names (`bg_<appid>_…`, `timeline_<appid>…json`); `appmanifest_<appid>.acf` provides the name. OBS writes nothing into the file name; here only the log in `%APPDATA%\obs-studio\logs\` (which process Game Capture hooked) or the next point helps.
- **Foreground process at save time.** The client is running anyway while you play. `get-windows` returns the title, process name and path of the active window; matching it against the install folders from Steam's `libraryfolders.vdf` and `appmanifest_*.acf` and the Epic manifests in `C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests\*.item` yields the game name. If the client remembers, per recording, what was in the foreground when the file was created, the folder name becomes only a fallback.
- **Image matching.** For recordings with neither: SigLIP 2 embeddings of the frames against a reference bank built from your own already-assigned clips (k-nearest neighbours). Matching against game names as text without reference images confuses similar shooters, _unconfirmed_, so only as the last resort.

## Stage 2: Exact events per game

Whatever is readable locally and without an account comes first. Everything else remains an option with its own consent.

| Game                                                                                  | Source                                                                                  | Provides                                                           | Tool                                                                      | Status                                                                                  |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Fortnite                                                                              | `.replay` in `%LOCALAPPDATA%\FortniteGame\Saved\Demos`                                  | Kills, knocks, victory, weapon, distance                           | own parser; reference Shiqan/FortniteReplayDecompressor (v3.0.1, .NET 10) | built in; format changes with each version                                              |
| Rainbow Six                                                                           | Match replays                                                                           | Map, rounds, kills, round clock                                    | r6-dissect                                                                | built in                                                                                |
| Counter-Strike 2                                                                      | `.dem` (GOTV, must be downloaded from match history) + Steam timeline markers           | Kills, weapon, rounds, bomb                                        | demoparser2 (Rust with Node bindings), deadem (pure JS)                   | feasible; automate the download or use Steam's recording                                |
| Steam recording                                                                       | `Steam\userdata\<id>\gamerecordings\`: `timeline_*.json`, `clip.pb`                     | Game markers (CS2, Dota 2 confirmed), achievements in all games    | protobuf without schema; model: SteamRecordingYouTubeUploader             | feasible; Steam counts multi-kills unreliably, count single events yourself             |
| Rocket League                                                                         | `.replay` in `Documents\My Games\Rocket League\TAGame\Demos`                            | Goals, highlights with frame number (`RecordFPS`)                  | rrrocket / boxcars (Rust, also WASM)                                      | feasible                                                                                |
| Dota 2                                                                                | `.dem`, only after downloading in-game                                                  | everything                                                         | deadem (JS), manta (Go)                                                   | feasible                                                                                |
| League of Legends                                                                     | Live Client Data API `https://127.0.0.1:2999/liveclientdata/eventdata` during the match | ChampionKill, Multikill, Ace, dragons, Baron, towers, end of match | own poller with wall-clock time per event                                 | feasible; `.rofl` has had no stats since 13.20, the replay API only controls the camera |
| Valorant                                                                              | `match-details` via the local client's token (unofficial)                               | Kill log with milliseconds, weapon, headshot                       | techchrism documentation                                                  | grey area: Riot requires every product to be registered, allows post-match analysis     |
| PUBG                                                                                  | Developer API, telemetry per match                                                      | `LogPlayerKillV2`, `LogPlayerMakeGroggy`, match start              | API key                                                                   | account only                                                                            |
| Halo Infinite                                                                         | Waypoint API, Theater films                                                             | Highlights with timestamps                                         | SPNKr (Python)                                                            | only with Xbox Live sign-in                                                             |
| Destiny 2                                                                             | Bungie API, Post Game Carnage Report                                                    | Kills, medals, without timestamps                                  |                                                                           | for titles only, not for timestamps                                                     |
| Minecraft, Warframe, Tarkov                                                           | `latest.log`, `EE.log`, game logs                                                       | Chat, death, mission and raid boundaries, map                      | warframe-deathlog, TarkovMonitor                                          | coarse, no kills with time (Tarkov: map only)                                           |
| Apex, CoD/Warzone, Overwatch 2, Marvel Rivals, The Finals, Battlefield 6, Hunt, GTA V | nothing readable                                                                        |                                                                    |                                                                           | image and audio only                                                                    |

Overwolf provides real-time events for more than 60 games, but only to apps on the Overwolf platform. Medal, Outplayed and the like live on exactly that; for a standalone Electron app it is not an option.

**Integration.** Each source is a module like `agent/fortnite.ts`: a lookup with path, game and duration that returns events with clip seconds or says `none`, and `withReplay` stays the one place that replaces events read from the screen. Matching clip to match works everywhere via wall-clock time: the recording's file time against the match start, as with Fortnite. For LoL the client has to start the poller as soon as the game is in the foreground and store the events with their time.

## Stage 3: Read the HUD instead of guessing

The image model sees one token per 32 pixels of frame edge. At 1280 px width, a twelve-pixel-high killfeed line is less than half a token tall. That, not the model, is why small messages are missed or misread.

- **Upgrade text recognition.** PP-OCRv4 is two generations old. On the project's test set, PP-OCRv5 recognises 84 % instead of 57 % of the text (server model); PP-OCRv6 (PaddleOCR 3.7, June 2026) adds another good five points, is published as ONNX and trained on signage and displays. Swapping the models in `agent/ocr.ts` is the cheapest gain in the whole concept. Whether the v6 recognition model uses the same input shape and dictionary file as v4 is _unconfirmed_ and must be checked first.
- **Crops instead of full frames.** Cut out the killfeed (usually top right) and the centre (result banner) at original resolution, upscale them 2x and read them separately; the full frame goes to the AI at small size for the frame type. CropVLM measures +7.5 points on TextVQA and +14.9 on DocVQA for targeted crops compared with the full frame; a hands-on test with Gemma 4 on game frames read details in 256 px crops in 7 of 7 cases, in the full frame in 5 of 7.
- **HUD profiles per game.** A small file per game: regions for killfeed and banner, the result phrases in German and English, team colours, position of the weapon icon. Whoever stands in front of the icon in the killfeed got the kill; geometry and colour decide that, not the AI. That is exactly where it fails today (E14, E17). Profiles are text files that others can contribute; crispy and valoscribe show how for Valorant, CS2, Overwatch and LoL. If a user changes their HUD, the profile does not apply; then the existing path remains.
- **Deduplicate persistent overlays.** A killfeed entry stays visible for seconds and appears in several frames. NVIDIA's study on annotating gameplay videos names exactly this as a source of error: an old HUD state gets counted as a new event. The same text within a few seconds is one event.
- **Fine-tuning only here.** Retraining the text recognition model on HUD fonts, or a tiny YOLO for killfeed lines, needs a few hundred labelled crops and no change to Ollama. Retraining the image model itself is not worth it: Ollama does not load custom models with a separate vision projector; only llama.cpp could.

## Stage 4: Audio as a signal

`AUDIO-CONCEPT.md` describes laughs and quotes for fun clips. But audio carries more:

- **Loudness as candidate search.** RMS and peak values of the microphone track with ffmpeg `astats` or `ebur128`, then z-scores per second. Where the voice spikes, that is the moment. This replaces the fixed end window: frames go where audio and scene cuts show peaks; the last third remains only a fallback.
- **Game announcements.** "Ace", "Clutch", "Victory" and kill sounds are fixed files, identical every time. For them an audio fingerprint (in the style of dejavu) is more reliable than speech recognition; zero-shot with CLAP ("shouting", "gunshot", "explosion") as a supplement. No ready-made announcement classifier exists; collecting them per game is manual work.
- **Transcript as context.** Parakeet-TDT-0.6B-v3 understands German (FLEURS 5.0 % word error rate) and English, with word timings, CC-BY licence, and runs via the sherpa-onnx addon in Node; Qwen3-ASR 0.6B is the alternative, Whisper remains possible. Callouts, names and reactions in voice chat make titles concrete; as in the audio concept, quotes belong only in the description.
- **Don't wait.** Ollama does not accept audio and has made no commitment to do so. Audio is passed to the AI as text.

## Stage 5: Choose frames more cleverly

- **Bursts instead of a grid.** Three to five frames at 1 to 2 frames per second around every audio and scene-cut peak, plus a sparse grid over the whole clip. Single frames miss motion; short bursts show how a kill unfolds (F2C measures up to +8 points over a uniform grid at the same token count).
- **Detect cuts.** ffmpeg `scdet` provides a scene score per frame; death cam, respawn and menu are hard cuts. Near-identical frames are dropped, one frame per cut remains.
- **Diversity.** Where neither audio nor cuts show anything: SigLIP 2 embeddings of the candidates and the selection that spans the largest space (MaxInfo); on the CPU that costs fractions of a second for a good hundred frames.
- **Timestamps stay.** Every frame keeps carrying its second as text; that is the format Qwen was trained on. Ollama cannot do video; llama.cpp can since June 2026, with real time tokens for Qwen 3.5. That is a possible second backend, not a prerequisite.

## Stage 6: Model and prompt

| Model                    | Size (Ollama) | Text recognition (OCRBench) | Video (Video-MME)  | Assessment                                                                                    |
| ------------------------ | ------------- | --------------------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| Qwen3-VL 8B Instruct     | 6.1 GB        | 896                         | 71.4               | default until 2026-09-24                                                                      |
| Qwen3.5 9B               | 6.6 GB        | 892                         | 78.4               | default since 2026-09-24 (measured: 6/6 instead of 5/6 titles with a proven event, see below) |
| Qwen3-VL 4B / Qwen3.5 4B | 3.3 / 3.4 GB  | 881 / 850                   | 69.3 / 76.9        | for 6 GB cards                                                                                |
| Qwen3.5 27B, Qwen3.8 27B | 17 / 18 GB    | –                           | –                  | for 24 GB cards                                                                               |
| Gemma 4 E4B / 12B        | –             | not stated                  | –                  | at most 1120 tokens per frame: too coarse for HUD text                                        |
| Molmo 2 8B               | –             | no individual scores        | strong, 128 frames | interesting for video, Ollama status _unconfirmed_                                            |

Five things change in the prompt, all possible via Ollama: stay short (longer instructions measurably lower the hit rate); temperature 0 and a JSON schema for the frame review; demand frame numbers as evidence for every statement; generate the summary twice and keep only what appears in both; and for the title a verification round in which the model checks every claim against the named frame (Woodpecker). Today's follow-up question for a deficient title stays.

## Stage 7: Search and learning from corrections

- **Embeddings on the server.** SigLIP 2 (Base or so400m as ONNX) per thumbnail, stored with sqlite-vec in the existing SQLite. This enables similar clips, search by image content, the reference bank from stage 1 and the frame selection from stage 5. Jina CLIP v2 is ruled out by its non-commercial licence.
- **Corrections as examples.** When someone changes a title or tags, the pair of image embedding and final version is stored. In the next analysis in the same game, the three most similar ones go into the prompt as examples, no more, otherwise the small model suffers. Tags are the cleaner signal, titles carry style. Prompt optimisers such as DSPy or GEPA run only on our side, offline, to build the shipped default prompt per genre; not on users' PCs.

## Privacy

- Everything runs locally; network access is only needed for model downloads with checksums and for the game APIs that do not exist otherwise (Valorant, PUBG, Halo, Destiny). Each is a per-game option, off by default, with a note on where which sign-in goes.
- Valorant: Riot requires every product to be registered, even for unofficial interfaces, and prohibits real-time overlays. Post-match analysis is allowed. Register before building it in, otherwise leave it out.
- Foreground process: the client only remembers the game name per recording, no window log.
- Transcripts and raw events stay in the trace on the PC; titles, description, tags and timestamps go to the server.

## Measurement plan

Without a measurement set, every prompt change is a matter of faith. The set comes first, then everything else.

| Stage           | How                                                                                                                             | Success                                                                                                                                  | Discard                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Measurement set | 100 to 300 clips from about ten games; per clip the game, events with second, three to eight tags, one sentence of ground truth | Runs with promptfoo against Ollama; event precision and recall at ± 2 s, tag F1, title faithfulness as questions to a larger local model | –                                                                      |
| Game            | All clips of the measurement set without folder names                                                                           | File name or process ≥ 0.98; image matching ≥ 0.9 with ≥ 20 reference images                                                             | Image matching < 0.8: file name and process only                       |
| OCR v6          | 200 killfeed and banner crops, transcribed by hand                                                                              | Character errors halved compared with v4; ≤ 50 ms per crop on the CPU                                                                    | No gain: test crop and upscaling logic without swapping the model      |
| HUD profile     | One game (CS2 or Valorant), 50 clips with kills                                                                                 | Who eliminated whom ≥ 0.95 correct; duplicates ≤ 1 per clip                                                                              | < 0.85: profile only for result banners, killfeed stays with the model |
| Game data       | 20 clips with a match per source                                                                                                | Clip-to-match assignment ≥ 0.95; kill second ± 1 s                                                                                       | Assignment < 0.8: source only for titles without timestamps            |
| Audio peaks     | 50 clips with a microphone track, moment marked by hand                                                                         | Peak within ± 3 s of the moment in ≥ 0.7                                                                                                 | < 0.5: end window stays, audio only as a supplement                    |
| Frame selection | Measurement set, grid versus bursts at the same frame count                                                                     | More proven events, fewer lost frames, no longer runtime                                                                                 | Runtime +20 % without gain                                             |
| Model           | Measurement set, Qwen3-VL 8B versus Qwen3.5 9B (`think: false`)                                                                 | As many messages read, better description of what happens                                                                                | Fewer messages read: stays with Qwen3-VL                               |
| Examples        | 30 corrected clips, analysis with and without three examples                                                                    | More titles you would have kept as they are; no invented events                                                                          | Invented content from examples: only tags as examples                  |

## Order

1. Measurement set and measurement run (stage "Measurement set"). Everything else is measured against it.
2. Game from file name and foreground process (stage 1). Small, safe, helps all other stages.
3. Text recognition on PP-OCRv6 and crops (stage 3, first two points). Largest gain per effort.
4. Audio peaks for frame selection and bursts around the peaks (stages 4 and 5).
5. Steam recording, Rocket League, LoL, CS2 as exact sources, in this order by effort.
6. HUD profiles for two or three shooters, with a contribution guide.
7. Prompt changes and model comparison (stage 6), only now, because only now can they be measured.
8. Embeddings, search, examples from corrections (stage 7).

Not planned: retraining the image model, waiting for audio or video in Ollama, Overwolf, TransNetV2 or trained frame selection (AKS, Frame-Voyager), Jina CLIP.

## Sources

Models and prompts

- Qwen3-VL Technical Report: https://arxiv.org/pdf/2511.21631v2
- Qwen3.5-9B, -4B: https://huggingface.co/Qwen/Qwen3.5-9B, https://huggingface.co/Qwen/Qwen3.5-4B
- Ollama libraries: https://ollama.com/library/qwen3-vl, https://ollama.com/library/qwen3.5
- Gemma 4 model card (token cap per image): https://ai.google.dev/gemma/docs/core/model_card_4
- Molmo 2: https://allenai.org/blog/molmo2
- Ollama, no video: https://github.com/ollama/ollama/issues/18151; no audio: https://github.com/ollama/ollama/issues/11798; no custom vision projector: https://github.com/ollama/ollama/issues/14575
- llama.cpp video input (June 2026): https://github.com/ggml-org/llama.cpp/discussions/20965
- Structured output in Ollama: https://docs.ollama.com/capabilities/structured-outputs
- CropVLM (crops): https://arxiv.org/html/2511.19820v2
- Hands-on test of Gemma 4 on game frames: https://github.com/AntoninPrazsky/BS3D/issues/440
- VideoGameQA-Bench: https://arxiv.org/html/2505.15952v1
- NVIDIA, VLMs for annotating gameplay videos (persistent HUD states): https://arxiv.org/html/2608.05949
- HAVEN, hallucination in video models (short prompts): https://arxiv.org/html/2503.19622
- Woodpecker: https://arxiv.org/abs/2310.16045
- Fine-tuning: https://unsloth.ai/docs/models/qwen3.5/fine-tune, https://github.com/modelscope/ms-swift

Text recognition

- PP-OCRv6: https://arxiv.org/html/2606.13108v1, https://huggingface.co/blog/PaddlePaddle/pp-ocrv6
- PP-OCRv5 versus v4: http://www.paddleocr.ai/main/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5.html
- ONNX models: https://huggingface.co/monkt/paddleocr-onnx; RapidOCR: https://github.com/RapidAI/RapidOCR
- crispy: https://github.com/Flowtter/crispy; valoscribe: https://github.com/JIYUN000000/valoscribe; Battlefield killfeed: https://github.com/luandev/batlefield_killefeed

Game data

- Steam Timeline: https://partner.steamgames.com/doc/features/timeline; where recordings are stored: https://steamcommunity.com/groups/SteamClientBeta/discussions/5/4630358592048904420; readers: https://github.com/Nahassa/SteamRecordingYouTubeUploader, https://github.com/Cereal916/steam-recording-browser
- CS2: https://github.com/LaihoE/demoparser, https://github.com/Igor-Losev/deadem, https://github.com/claabs/cs-demo-downloader, markers: https://github.com/valvesoftware/steam-for-linux/issues/12366
- Rocket League: https://github.com/nickbabcock/boxcars, https://github.com/nickbabcock/rrrocket
- Dota 2: https://github.com/dotabuff/manta
- LoL Live Client Data: https://github.com/XHXIAIEIN/LeagueCustomLobby/wiki/client:--game-client; replay API: https://developer.riotgames.com/replay-apis.html; ROFL without stats: https://github.com/RiotGames/developer-relations/issues/831
- Valorant: https://techchrism.github.io/valorant-api-docs/, https://valapidocs.techchrism.me/endpoint/match-details; Riot's rules: https://support-developer.riotgames.com/hc/en-us/articles/22698769097107-VALORANT
- PUBG telemetry: https://documentation.pubg.com/en/telemetry-events.html
- Halo: https://github.com/acurtis166/SPNKr; Destiny: https://bungie-net.github.io/multi/operation_get_Destiny2-GetPostGameCarnageReport.html
- Fortnite reference parser: https://github.com/Shiqan/FortniteReplayDecompressor/blob/master/CHANGELOG.md
- Hunt, no longer local: https://github.com/Bzly/hunt-showdown-stat-recording; Tarkov: https://github.com/the-hideout/TarkovMonitor; Warframe: https://github.com/WFCD/warframe-deathlog
- Overwolf GEP: https://dev.overwolf.com/ow-electron/live-game-data-gep/live-game-data-gep-intro/; Medal: https://medal.tv/auto-clipping

Detecting the game

- NVIDIA file names and the `GeForce SHARE` tag: https://github.com/rebane2001/NvidiaInstantRename
- Game Bar names: https://learn.microsoft.com/en-us/answers/questions/4299624/game-bar-captures-file-naming-conventions
- OBS file names: https://obsproject.com/forum/threads/ability-to-change-replay-buffer-output-path-based-on-the-name-of-a-program-or-game.145438/
- get-windows: https://github.com/sindresorhus/get-windows; Steam manifests: https://github.com/mattb-prg/steam-acf-parser; Epic manifests: https://jayd.ml/games/2020/05/16/epic-games-store-steam-libraries.html

Audio, frame selection, search, measurement

- Audio as the strongest signal: https://arxiv.org/html/2609.17923, https://www.sciencedirect.com/science/article/pii/S2666827022000469
- Gameplay Highlights Generation (X-CLIP per second): https://arxiv.org/html/2505.07721
- Parakeet-TDT-0.6B-v3: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3; Qwen3-ASR: https://github.com/QwenLM/Qwen3-ASR; sherpa-onnx in Node: https://deepwiki.com/k2-fsa/sherpa-onnx/3.9-node.js-bindings-(addon-api-and-wasm)
- CLAP in Transformers.js: https://huggingface.co/Xenova/clap-htsat-unfused; BattleSound: https://www.mdpi.com/1424-8220/23/2/770/htm; dejavu: https://github.com/worldveil/dejavu
- ffmpeg scdet: https://ffmpeg.org/ffmpeg-filters.html; PySceneDetect: https://www.scenedetect.com/features/
- Frame selection: F2C https://arxiv.org/html/2510.02262v2/, MaxInfo https://arxiv.org/html/2502.03183v3, BOLT https://arxiv.org/html/2503.21483v1
- SigLIP 2: https://huggingface.co/blog/siglip2, ONNX: https://huggingface.co/onnx-community/siglip2-large-patch16-512-ONNX; sqlite-vec: https://alexgarcia.xyz/sqlite-vec/js.html; Jina CLIP v2 (licence): https://huggingface.co/jinaai/jina-clip-v2
- Measurement: promptfoo with Ollama https://www.promptfoo.dev/docs/providers/ollama/; VDCscore https://arxiv.org/abs/2410.03051; GEPA https://github.com/gepa-ai/gepa
- Datasets: VideoGameBunny https://huggingface.co/datasets/VideoGameBunny/Dataset, GamePhysics https://huggingface.co/datasets/asgaardlab/GamePhysics-FullResolution

## First measurement (2026-09-24)

Twelve hand-checked clips (sample `pruefung-2`: Valorant, Fortnite, Rainbow Six, Call of Duty, Chained Together, ARC Raiders, Desktop). Same settings per run: player names, whole clip with one frame every three seconds, text recognition, Fortnite replays.

| Run                                                | Title names a proven event | Invented content in title | Runtime per clip |
| -------------------------------------------------- | -------------------------- | ------------------------- | ---------------- |
| Qwen3-VL 8B, PP-OCRv4, no audio                    | 4/6                        | 0                         | 77 s             |
| Qwen3-VL 8B, PP-OCRv5 recognition, with transcript | 5/6                        | 0                         | 77 s             |
| Qwen3.5 9B, PP-OCRv5 recognition, with transcript  | 6/6                        | 1 (map "Dantzig")         | 76 s             |

Since then the title check catches the invented map (`agent/wording.ts`: "auf" followed by a proper noun must be the recognised map for R6). PP-OCRv5 for Latin script read 62 victim names exactly on 75 killfeed crops with known ground truth, PP-OCRv4 read 53, at the same computing time. Twelve clips are thin for a decision; the measurement set from the order above is still needed.

## Voice chat in the title (2026-09-25)

Parakeet TDT 0.6B v3 (sherpa-onnx, CPU) transcribes a two-minute clip in about 4 to 8 seconds; Whisper medium needed 91 seconds. The transcript alone was not enough: in the summary with frames, the model mostly described the image, even when the clip lives on a conversation. A Fortnite clip in which two players puzzle over whether a character is Obi-Wan Kenobi or Yoda was titled "Obi-Wan oder Yoda?", "Spitzhacke vor Eiswand" and "Eiswand-Abenteuer" in three runs.

Since then, for clips without a proven event, the pipeline first asks, using the text only, what the conversation is about (`LocalAnalyzer.topic`), and hands that topic to the title rule. A single word or a verbatim quoted sentence does not count as a topic (`usableTopic`). Result on the same sample `pruefung-2`:

| Clip                                   | without audio                  | transcript, no topic question | with topic question                 |
| -------------------------------------- | ------------------------------ | ----------------------------- | ----------------------------------- |
| Fortnite, Star Wars puzzle (3 + 2)     | —                              | 1 of 3 about the conversation | 5 of 5 "Wer ist Obi-Wan Kenobi?"    |
| ARC Raiders, panicked missed shot      | Duckt hinter Säule             | Versteckt hinter der Säule    | Entschuldigung für den Falschschuss |
| Conversation about vocational training | Deck-Ansicht im Fortnite-Thema | Kampfmenü im Fortnite-Modus   | Was ist vernünftig?                 |
| Desktop, headless character            | Interaktion am pinken Auto     | Kopflöser am pinken Auto      | Kopfloser Charakter                 |
| Chained Together, chaos on the rope    | Hängt an Kette                 | Hängen an der Kette           | Zuruf an einen Mitspieler           |

The six clips with a proven event stayed unchanged (6/6 name the event, nothing invented); the topic question does not run for them. The Chained Together title is an in-game arrangement instead of the punchline ("never in the middle again"); it is not wrong, but weaker. Parakeet does not recognise laughter: unlike Whisper, it does not write repetitions during laughing fits, so it produces no laugh markers.

## Larger test set (2026-09-25)

34 hand-checked clips from 13 games (samples `pruefung` and `neutest`) that were not used for development. Compared with the state of 2026-09-23 (Qwen3-VL 8B, 24 frames from the end window, no text recognition or audio) on the same clips:

| State                                                                                             | Tags correct | Title names a proven event | Wrong content in title | Runtime per clip |
| ------------------------------------------------------------------------------------------------- | ------------ | -------------------------- | ---------------------- | ---------------- |
| 2026-09-23                                                                                        | 24/26        | 12/16                      | 0                      | 51 s             |
| 2026-09-25: Qwen3.5 9B, whole clip every 3 s, text recognition, replays, voice chat, title checks | 41/41        | 16/16                      | 0                      | 67 s             |

Newly found are mainly kills and headshots from the Valorant killfeed plus map and round outcome in R6: titles now read, for example, "Runde gewonnen auf Border", "Ausgeschaltet von … auf Fortress" or "Drei Kopfschüsse zum Sieg". Five discrepancies between pipeline and hand check were down to the hand check: still frames of the killfeed showed the headshots and second kills the pipeline had reported. The ground truth was corrected with evidence, not adjusted to the pipeline.

Fixed along the way:

- **R6 text recognition with PP-OCRv5.** The recognition model writes banners without spaces ("NIGHTHAVENLABS", "WONROUND2"); neither map nor round outcome was recognised. On 12 R6 clips there are now 8 maps and 6 round outcomes, each outcome confirmed on the still frame, instead of 5 maps (one wrong: "Tower" is a room on Skyscraper) and no outcome.
- **Folder "R6siege"** of older recordings was not treated as Rainbow Six, so text recognition did not run for 61 clips.
- **Short clips.** For clips up to 30 seconds, the whole clip counts as the moment; otherwise a kill at 1.3 of 12 seconds was missing from the title.
- **Measurement tool.** Speech recognition and text recognition each bring their own ONNX Runtime; in the same process the second one fails (error 182). In the client they run separately, now in the measurement tool as well.

Limits: there are only five Valorant clips, all already in the samples. None of the 268 clips has its own microphone track; events from game audio only pay off with "Microphone as separate track" in the NVIDIA App.
