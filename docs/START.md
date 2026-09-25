# Setting up ReplayHaven

Your gaming PC does the AI analysis. Your server stores videos and results and serves the archive in the browser. The server needs neither an AI model nor a graphics driver for this.

## 1. Set up the server

Requirement: a Linux machine, NAS or mini PC with [Docker Engine and the Compose plugin](https://docs.docker.com/engine/install/).

**Option A – prebuilt image (recommended):**

```bash
mkdir -p replayhaven && cd replayhaven
curl -fsSLO https://raw.githubusercontent.com/SauerExe/ReplayHaven/main/compose.yaml
curl -fsSL  https://raw.githubusercontent.com/SauerExe/ReplayHaven/main/.env.example -o .env
nano .env        # set REPLAYHAVEN_ACCESS_TOKEN and REPLAYHAVEN_PUBLIC_ORIGIN
docker compose up -d
```

Generate the access key with `openssl rand -hex 24`. As the server address, enter exactly what you will later open in the browser, for example `http://192.168.1.20:8787`.

**Option B – from source:**

```bash
git clone https://github.com/SauerExe/ReplayHaven.git
cd ReplayHaven
bash setup-server.sh
```

The script asks for the server address, generates the access key, builds the image and starts the server. The first build needs internet access and takes a few minutes.

Then open the server address in the browser and **create your account**: name, password and, once, the access key from setup. It prevents someone else from creating the first account if the server is already reachable from the internet. The Windows download is then available under **Devices**.

**Other devices** such as a phone or laptop simply open the server address and sign in with name and password. A QR code is faster: on a signed-in device go to **Devices → Connect phone**, then scan with the phone camera. The code is valid for five minutes and signs in exactly one device. Sign-ins last 30 days and are extended with every use; under **Devices** you can see all of them and remove each one individually.

## 2. Set up the Windows client

1. Install `ReplayHaven-Client-Setup.exe` and open ReplayHaven Client. You do not need to install Node.js, Python or FFmpeg separately.
2. Choose the recordings folder. Subfolders are included.
3. Enter the server address, for example `replay.your-domain.com` or `192.168.1.20:8787`, and click **Connect**. The client shows a six-digit code. In the web interface, the same code appears under **Devices** with your PC's name; click **Approve** there. The PC gets its own access, which the client stores encrypted with your Windows account and which you can revoke at any time under **Devices**. Older servers without accounts are connected via **Use access key instead**.
4. **Install Ollama** opens the official download. Install and start Ollama, then click **Check connection** in the client.
5. **Download model** downloads Qwen3.5 9B once, about 6.6 GB. This only happens when you click.
6. Start with **24 frames** and click **Start analysis & upload**.

Enable **Include existing recordings on first start** before starting for the first time if you want to import old clips as well. Otherwise they are marked as skipped. This choice applies per recordings folder and server. The game name is optional; without it, the subfolder name serves as a hint for the AI.

Under **Your player names**, enter what you are called in-game. If your name differs per game, give each name its game; the game folders of your recordings are suggested so that entry and folder match. A name without a game applies everywhere. The AI only learns the names that match the clip's game and uses them to tell which side of the killfeed is yours.

The installer is currently not signed with a publisher certificate. Windows SmartScreen will therefore ask once.

## 3. Record as before

Save your clips as usual, for example the last two minutes via the NVIDIA App. After at least ten seconds without file changes, the client analyses the recording. Then it uploads **original video and result**. The clip appears in the archive automatically. Title, description and tags are editable; timestamps jump to the spot in the video.

While gaming you can **pause** and then resume with **Start analysis & upload**. An FFmpeg step already running may still finish. Closing the window keeps the client running in the Windows notification area; **Quit** in the tray menu ends it. After a Windows restart, start the client again. Starting automatically with Windows is not set up yet.

For a first connection test you can turn off **Analyse new clips locally before upload**. Originals are then archived without an AI result; Ollama is not required for that. Manual uploads in the browser do not call the PC's AI either.

## Fortnite replays (optional)

Fortnite stores a replay of every match under `%LOCALAPPDATA%\FortniteGame\Saved\Demos`. With **Include Fortnite replays**, the client reads your kills, knocks, your elimination and a victory, including weapon type and distance, from it instead of from on-screen messages. This produces titles like "Doppel-Kill mit der Schrotflinte" or "Snipe über 180 m".

- The clip time is derived from the time in the NVIDIA file name and the time the file was written. Originals are only read for this.
- A replay does not say who recorded it. The client recognises your account by the fact that it appears in almost every replay on this PC, and by the match statistics. If it stays unclear, it does not use the replay. It becomes unambiguous once you enter your **Epic account ID**; you can find it on epicgames.com in your account settings.
- If you play duos or squads with regular teammates, they appear in the same replays as you. In team matches the client then picks no account rather than possibly counting their kills as yours. In that case, enter your Epic account ID.
- A clip from a match that is still running waits until it ends, at most 45 minutes. After that it is analysed with frames only, as before.
- Replay recording must be enabled in Fortnite. The client only reads a replay's header and events, not the whole match.

## Text recognition: R6 map, round outcome and Valorant killfeed (optional)

With **Text recognition: R6 map and round outcome, Valorant killfeed**, the client reads two frames per second in R6 clips with text recognition (PaddleOCR via ONNX Runtime, on the CPU). From these it takes the map name and round results such as "ROUND WON", making titles like "Rundensieg auf Oregon" possible.

- A map only counts once it has been read reliably in at least two frames. A title may then not name any other map.
- In R6 the text recognition deliberately does not read kills. Who caused a killfeed line and whether it belongs to the clip could not be determined reliably this way.
- In Valorant it only reads the killfeed at the top right. If one of your entered Valorant names is on the left of a line, it is your kill; if it is on the right, your death. The headshot icon is usually read as well. Enter every name you have ever played under, otherwise clips from that period have no kills. Kills and deaths from the killfeed then replace those the AI interpreted from on-screen text. This takes about 15 to 25 seconds of CPU per clip.
- Text recognition needs about one minute of CPU time per clip. It runs at the same time as the AI, which computes on the graphics card, in its own thread so the window does not stall, and uses at most half of the processor cores.
- It uses Microsoft's ONNX Runtime. Its Windows version contains telemetry events (ETW). According to the project's privacy notice, they are only recorded while a trace session is running and only transmitted with your consent to Windows diagnostic data.

## Transcribe voice chat (optional)

With **Transcribe voice chat (fun clips)**, the client transcribes what is said in the clip and gives it to the AI as context. Clips without kills or round results thus get titles based on the conversation, for example "Obi-Wan oder Yoda?" instead of "Spitzhacke am Eiszaun".

- Recognition runs with Parakeet TDT 0.6B v3 via sherpa-onnx on the CPU, in its own process alongside the AI. Two minutes of audio take a few seconds.
- The first time the option is used, the client downloads the speech models once to `%LOCALAPPDATA%\ReplayHaven\models\parakeet-v3`, about 670 MB, verifying every file against its checksum.
- If the recording has its own microphone track (NVIDIA App: "Microphone as separate track"), the client listens only to that. Otherwise it reads the mixed track; loud game sounds then swallow individual words.
- The model occasionally mishears English names in German conversation. Quotes therefore do not end up verbatim in the title.
- The transcript stays on your PC; as before, only title, description, tags and timestamps go to the server.

## Pause while gaming

**Pause while gaming** is on by default. As long as a game is running in fullscreen or a borderless window, analysis and upload wait so that the graphics card, processor and connection belong to the game. They resume one minute after no game is in the foreground any more; briefly switching to Discord therefore does not end the pause.

- What counts is the foreground window: if it fills the whole screen, it counts as a game. A game in a small window is not detected.
- Browsers and video players in fullscreen do not count as games, and neither does a maximised window.
- An AI request already running finishes, then the AI frees the graphics memory. The clip stays in the queue and is fully analysed later.
- Along the way, the client remembers which program was in front. If the NVIDIA App files a clip under "Desktop" or "Base Profile" because it did not recognise the game, the clip gets the game that was in front during the two minutes before saving, for example "Tom Clancy's Rainbow Six Siege" or the window title of an unknown game. This only applies to clips saved while the client is running.

## Keep R6 replays for clips

With "Match Replay" (game settings), Rainbow Six writes every round as a file but only keeps the last 30 or so matches. **Keep R6 replays for clips** is on by default: after uploading an R6 clip, the client copies the match it came from to `%LOCALAPPDATA%\ReplayHaven\r6-replays`, about 30 MB per match. The analysis does not use these files yet; they are the basis for later reading kills, headshots, ace and clutch precisely from the game ([R6-REPLAYS.md](R6-REPLAYS.md)). The files contain the names of all players in the match and stay on your PC.

## What actually happens

- The local AI receives downscaled individual frames in consecutive batches. The client only evaluates audio with **Transcribe voice chat**, and does so on your PC. Fast events can fall between frames; results are suggestions.
- In the default mode, no recordings are sent to a cloud AI provider.
- The server receives the unmodified original, including any recorded audio. It creates a thumbnail and, if needed, an H.264 playback copy.
- If the NVIDIA App records the microphone as its own track ("Microphone as separate track"), the playback copy mixes all audio tracks. Otherwise a browser only plays the first track and your voice is missing. Additional tracks go into the centre of the mix, even if the microphone is on only one channel. The video is only copied; the original keeps the separate tracks.
- On the PC, originals are never renamed, moved or deleted. The AI title is the display name in the archive.
- After connection errors, the client retries. Finished analyses stay cached until confirmed. The server detects duplicate files by their content.
- **Remove from library** hides the entry; its original file stays on the server. There is no automatic storage cleanup yet.
- Metadata and favourites of your own server clips live on the server. Collections, playback progress and display settings currently stay in each browser.

## Troubleshooting

| Problem                                    | Next step                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Server not reachable                       | Check the address in the browser; on the server, run `docker compose ps` and `docker compose logs --tail=80`.                        |
| "This origin is not allowed"               | `REPLAYHAVEN_PUBLIC_ORIGIN` in `.env` must match the browser address exactly. Then run `docker compose up -d`.                       |
| Wrong key                                  | Enter the key again. It is in `.env` on the server.                                                                                  |
| Ollama not reachable                       | Start Ollama on Windows, then **Check connection**.                                                                                  |
| Model missing                              | Choose **Download model** and wait.                                                                                                  |
| GPU memory low / game stutters             | Pause the client and resume after gaming. Start with 24 frames. During analysis, `ollama ps` shows GPU usage.                        |
| File stays pending                         | Wait until the recording has been fully written. Supported: MP4, M4V, MOV, WebM, MKV; at most 2 GB, 30 minutes and 8K per recording. |
| Fortnite clip stays pending                | It is waiting for its match to end. It continues after the match or after 45 minutes at the latest.                                  |
| Start reports "Visual C++ Redistributable" | R6 text recognition needs it. Install the current x64 version from Microsoft and start again, or turn off the R6 option.             |
| No AI title                                | Check whether client analysis was active. Files already archived are not re-analysed automatically when you turn it on later.        |
| No Windows download under Devices          | The image has no download address. Set `REPLAYHAVEN_CLIENT_DOWNLOAD_URL` in `.env` or put the installer in `release/`.               |

## Limits

Model quality, speed and graphics memory requirements depend on your hardware. Qwen3.5 9B runs smoothly on graphics cards with about 10 GB of VRAM or more; without a suitable GPU, Ollama computes on the CPU and takes considerably longer. After setup, check with a real clip: start the server → connect the client → save a new recording → watch GPU usage → check the result in the archive → download the original.

Further reading: [Running the server](SERVER.md), [Development](../README.md), [Qwen3.5 on Ollama](https://ollama.com/library/qwen3.5:9b), [Ollama GPU support](https://docs.ollama.com/gpu).
