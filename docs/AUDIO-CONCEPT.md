# Concept: Audio for fun clips

**Goal.** Titles for fun clips based on what is said or laughed about, for example "Lachkrampf nach dem Fallschaden" or a short quote. This works in two stages. First a small model on the CPU finds laughs and shouts across the whole microphone track. Then Whisper transcribes only those spots. No model ships in the installer yet; everything is downloaded on demand.

This concept is based on research from 2026-09-24 with 63 sources. None of it has been measured; which numbers need to be settled beforehand is listed in the measurement plan below.

## What already exists

- `ffprobe` lists all audio tracks. The microphone track is detected: first by its title, then by levels (silent tracks are dropped), then by order (game audio first, microphone after). Three independent scripts online assume the same order; a real NVIDIA App file has not confirmed it here yet.
- A track can be extracted as a 16 kHz mono WAV, the input format of YAMNet and Whisper.
- `npm run audio -- "<folder>" --out "<WAV folder>"` shows tracks and levels and writes out each track for listening.
- The playback copy mixes all tracks, with additional tracks folded to the centre. Otherwise the voice would be missing in the browser or only reach one ear.
- `npm run laughs` measures stage 1 without changing the analysis (see below).

## Stage 1: Finding laughs and shouts

**Model: YAMNet** (Google, Apache-2.0). It recognises 521 classes from AudioSet.

- **Runtime:** ONNX Runtime on the CPU. It is already in the client for R6 text recognition, so no new runtime is needed.
- **Model:** The community version via tf2onnx is 16 MB, takes the waveform directly and has the mel front end in the graph. It is downloaded on demand, pinned to a Hugging Face revision and SHA-256.

**Classes**

| Purpose            | Indices                                | Note                                                                                                         |
| ------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Laughter           | 13–18 (Laughter and five subtypes)     | Combine as a family; subtypes such as Giggle, Snicker, Chuckle are not good enough for titles (AP 0.17–0.26) |
| Shouting, cheering | 6–11 (Shout to Screaming), 61 Cheering | As "excitement"                                                                                              |
| Context            | 0 Speech                               | Plausibility of the microphone track: lots of speech, little game sound                                      |

**Process**

1. Decode the microphone track as 16 kHz mono. If the microphone sits on only one channel, that channel is taken instead of averaging both; averaging costs 6 dB.
2. Run YAMNet over 0.96 s windows with a 0.48 s hop. The laugh score per window is the highest score of classes 13–18.
3. Smoothing: a laugh counts once two of three consecutive windows are above the threshold. The threshold is calibrated on your own clips, starting value 0.3.
4. Result: `laugh` and `shout` events with start, duration and strength.

**System track.** Teammates' voices and laughter from Discord are, if anywhere, only in the system track, mixed with game sound. That only applies if Discord runs through the default device. Stage 1 runs separately there with a higher threshold; whether it is usable only the measurement will tell.

**Cost.** YAMNet needs about 69 million multiplications per window. With ONNX Runtime in the cloud container, one minute of audio cost about 0.3 s of CPU (two threads). On your PC, `npm run laughs` shows the value per run.

**Measurement tool.** `npm run laughs -- "<folder>" --json lacher.json --scores fenster.csv` takes the detected microphone track of each clip (or a fixed one with `--track 2`), reads it at 16 kHz, with a one-sided microphone only the loud channel, and shows:

- laughs and shouts with start, end and strength,
- the highest laugh score of the clip and the share of windows with speech,
- the computing time per minute of microphone track.

`--scores` writes the scores of every window as CSV (semicolon, decimal comma) for calibration; `--threshold` sets the threshold (default 0.3). It skips clips without their own microphone track. It downloads YAMNet on the first run to `%LOCALAPPDATA%\ReplayHaven\models` and checks size and SHA-256.

**Checked in advance,** not a measurement in the sense of the measurement plan:

- A 60 s test clip with five short laughs (1–2 s) from the ESC-50 collection, with keyboard, fireworks, breathing and clapping in between: threshold 0.3 found one of the five laughs, 0.2 three, 0.1 four, each without false alarms.
- 130 s of read-aloud speech (LibriSpeech) produced no laugh at any of these thresholds.
- Computing time in the cloud container with two threads: about 0.3 s of CPU per minute of audio.

When calibrating on your clips, it is therefore worth checking 0.2 and 0.1 as well. Real microphone tracks with excited talking and game audio in the headset are missing from this test; your clips have to decide.

**Alternative: CED-tiny** (Apache-2.0, 6.7 MB, AudioSet mAP 48.1 instead of 30.6). It is a clip tagger; time resolution only comes from our own windows. It is only considered if YAMNet fails the measurement.

## Stage 2: Transcribe only at the hits

**Excerpts**

- Per laugh, 6 s before to 1 s after, because what is being laughed about is usually said shortly before the laugh.
- Per shout, 3 s before to 3 s after.
- Overlapping excerpts are merged, at most three per clip.

**Runtime and model**

- whisper.cpp (MIT) via `@fugood/whisper.node`: MIT, prebuilt, Windows CPU addon 2.8 MB without the VC++ runtime. It runs in its own process so the client stays responsive. The fallback is `whisper-cli.exe` as a child process.
- The GPU stays free; it belongs to Ollama.
- Default model `ggml-small-q8_0` at 252 MiB. According to the Whisper paper, the word error rate for German (FLEURS) is 10.2 %.
- Quality tier `ggml-large-v3-turbo-q5_0` at 547 MiB, roughly on the level of large-v2 at 4.5 %.
- Both models are downloaded on demand, verified by SHA-256 and stored in the client's cache.

**Protection against invented text**

- Voice activity detection (Silero VAD, 0.9 MB, MIT) runs before Whisper. Pure laughter without words is exactly the case in which Whisper otherwise invents text.
- Afterwards a blocklist filters known hallucinations, such as "Untertitel der Amara.org-Community", "Untertitel im Auftrag des ZDF" or "Copyright WDR".
- On top of that comes a "no speech" threshold.

**Cost.** Whisper always processes a 30 s window, so a short excerpt costs as much as a long one. Extrapolated, that is 2–5 s of CPU per excerpt with small and 10–30 s with turbo. This is not measured either.

## Integration into the analysis

- **Facts in the prompt,** for example "Second 42.1: you laugh (microphone)." and "Said just before: "…"".
- **Title:** a title may mention laughs and shouts if they are proven. A quote in the title must appear in the transcript, otherwise there is a follow-up question. This is the same check as for kills.
- **Tags** such as "Lachen" only come after the measurement, because they change the tag vocabulary.
- **Without a separate microphone track** neither stage runs: in the mixed track the game sound drowns out the voice.
- **Option:** as with Fortnite and R6, this becomes an option that is off at first.

## Privacy

- Everything runs locally. Network access is only needed for the one-time model download, with checksum.
- Transcripts reach your server only as title, description and timestamps. The raw text stays in the trace on the PC.
- Microsoft's ONNX Runtime contains telemetry events (ETW) in its Windows builds. According to the project's privacy notice, they are only recorded while a trace session is running and only transmitted with your consent to Windows diagnostic data. There is no switch in Node. The WASM version would have no telemetry but would be too slow for text recognition.

## Measurement plan

| Stage      | How                                                                      | Success                                                                        | Discard                                                                                                           |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Tracks     | Real recording: speak only into the microphone for 10 s, `npm run audio` | Order, channels and duplicates known; microphone track detected                | Track detected wrongly: fixed track number as a setting                                                           |
| Laughs     | 30 clips with microphone track, laughs marked by hand                    | Precision ≥ 0.9 at recall ≥ 0.6 ("clip has laughs at the end"), time ± 1 s     | Precision < 0.8, for example due to game sound in the headset: higher threshold, test CED-tiny or give up stage 1 |
| Cost 1     | Computing time per minute of microphone track                            | < 5 s CPU                                                                      | Noticeable stutter while playing                                                                                  |
| Transcript | 20 laugh excerpts, checked by hand                                       | The intelligible key word is in the transcript in ≥ 70 %; no hallucination     | Invented text despite VAD and blocklist: quotes only in the description, never in the title                       |
| Cost 2     | Time per excerpt, small versus turbo                                     | small ≤ 5 s; turbo only if clearly better                                      | small > 15 s: only one excerpt per clip                                                                           |
| Title      | Fun clips with and without the audio stages, rated by you                | More titles that match what you remember; no contradiction with the transcript | No gain over titles without audio: option stays off                                                               |

## Next steps, once you approve them

1. Check a real NVIDIA App recording with a separate microphone track (`npm run audio`).
2. ~~Build a measurement tool `npm run laughs`~~: done, see stage 1.
3. Calibrate the threshold, then Whisper as the second measurement tool.
4. Integrate only after passing the measurement, behind an option.
