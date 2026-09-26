# Measurement plan for changes to the analysis

A change to the analysis only counts as an improvement once it has been measured on real clips. This document states in advance what is measured for each change, what counts as success and when the change is discarded. Measurement logs and ground-truth data stay local.

## Player names per game

**What changes.** The client stores a list of names; each name applies to one game or to all. The analysis only tells the AI the names for the clip's game. Events, tags and the title check do not depend on names. With exactly one matching name, the prompt stays word for word as before. The only new thing is that each game gets the right name where previously a wrong one or none at all appeared. Which names were given is recorded in the trace under `playerNames`.

**Measurement.** Take a sample from at least two games with killfeed scenes, for example from the 41 checked clips.

- Run A: one name for all games, as before.
- Run B: the list per game.

Compare descriptions, titles and tags.

**Success.**

- In the games that got a wrong name or none in run A, there are fewer descriptions with the wrong direction (kill as death, someone else's kill as yours).
- The tags stay identical. Any difference would be a bug, because names do not create events.
- Titles with a proven event name it at least as often as before (14 of 17).

**Discard** if any of these occurs:

- Run B has more direction errors or mixes up people.
- Titles or descriptions mention your name in the third person ("SpielerEins gewinnt").

Then the sentence with several names is removed from the prompt. The stored list stays.

## Fortnite events from replays

**What changes.** With **"Include Fortnite replays"** (default: off), the client reads the match's replay.

- Kills, knocks, your own elimination, streaks (kills at most 12 s apart) and victory then come from the replay, along with weapon type and distance.
- The replay replaces kills and deaths read from the screen as well as NVIDIA events from the file name. Round and match messages from the screen stay.
- Titles that get the streak, weapon or distance wrong, or leave out what is special (streak, snipe, long shot), get a follow-up question. This stricter check only applies to clips with replay events; without a replay the analysis checks as before.
- Clips from a match still in progress wait until it ends, at most 45 minutes.

**Tool.** `npm run fortnite -- --clips "<NVIDIA folder>" --json fortnite.json` needs neither AI nor upload and shows:

- per replay, the detected account and the reasoning,
- per Fortnite clip, the time interpretation (`name-end`: file name = save time, `name-start`: file name = recording start),
- the events with clip second and the title that would result from them without AI.

With `--account <Epic account ID>` the given ID is used instead of automatic detection.

| Check      | How                                                                                                                               | Success                                                                             | Discard                                                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account    | Detected ID per replay against your own account ID (epicgames.com, account settings)                                              | No wrong account; at most 20 % "ambiguous"                                          | Even one wrong account: automatic detection is not used, only the entered ID                                                                        |
| Time       | Clips with a visible "ELIMINIERT: …" message or an NVIDIA event in the name: replay second against the second the message appears | Deviation ≤ 2 s in ≥ 90 % of clips; time interpretation open for ≤ 20 % of clips    | Systematic offset above 3 s or more than 20 % open: the time mapping is reworked, the replay is not used                                            |
| Count      | Your own kills and knocks in the clip, counted by hand                                                                            | Exact in ≥ 90 % of clips; no clip with a kill where there is none                   | One invented kill (other account or wrong time)                                                                                                     |
| Weapon     | Weapon type per kill, checked visually                                                                                            | ≥ 90 % correct                                                                      | Below 80 %: Fortnite has shifted the encoding of death causes; the weapon is dropped from titles until the table in `agent/fortnite.ts` is adjusted |
| Distance   | Five long-range kills or snipes: distance plausible given the image                                                               | All in the right order of magnitude                                                 | Way off: distance is dropped from titles                                                                                                            |
| Title (AI) | Fortnite clips with the option on versus off                                                                                      | Titles with a replay event name it in ≥ 15 of 17; the special feature where present | A title contradicts the replay facts, or titles get worse than without the replay: the option stays off                                             |
| Tags       | Kill, multikill, death, victory from the replay against ground truth                                                              | At least as good as from messages (29 of 31)                                        | Worse than from messages                                                                                                                            |
| Queue      | Clips saved during a match                                                                                                        | Analysed and uploaded after the match, none held back longer than 45 minutes        | A clip stays pending permanently                                                                                                                    |

**Open assumptions** that the measurement will settle:

- The encoding of death causes has been checked on replays up to version 32.00 (2024); newer seasons may have shifted it.
- The structure of eliminations has also only been checked on real replays up to 32.00. According to a bug report for the C# reader FortniteReplayDecompressor, it reads replays from June 2026 (Engine 5.8) with the same structure. No replays of our own from 2026 were available here.
- Whether an NVIDIA name holds the save time or the recording start is decided by the file's modification time; for clips shorter than about 17 seconds it remains open.
- In team matches the match statistics may only be written when the last team member is eliminated. That is why the elimination at statistics time only counts once there, and as soon as another player also appears in other replays, automatic detection does not decide. With regular teammates, "ambiguous" in team matches is therefore intended; there only the entered ID counts.
- Fortnite writes the replay of a running match continuously, so its modification time keeps increasing. Only then does a clip wait for the end of the match. Otherwise it is analysed immediately without a replay; the "Queue" row shows this.

## Audio tracks and microphone

**What changes.**

- `ffprobe` returns all audio tracks of a recording.
- The microphone track is detected: first by its title, then by levels (silent tracks do not count), then by order (game audio first, microphone after). If it remains unclear, there is no microphone track rather than a guessed one.
- A track can be extracted as a 16 kHz mono WAV.
- The analysis does not use audio yet; how it should is described in `docs/AUDIO-CONCEPT.md`, including its own measurement plan.
- On the server, recordings with several audio tracks get a playback copy with mixed audio. The video is copied, not re-encoded. Additional tracks are folded to the centre, because according to forum reports a mono microphone often sits on only one channel of a stereo track.

**Measurement.** In the NVIDIA App, turn on "Microphone as separate track" and record ten clips from different games in which you speak. Then run `npm run audio -- "<folder>" --out "<WAV folder>"` and listen to the tracks; also play the clips in the archive.

**Success.**

- The microphone track is detected correctly in all ten clips or stays open, never wrong.
- In the archive, game audio and voice can be heard, the voice on both ears and without audible clipping.
- Clips with only one track stay unchanged: they get no playback copy.

**Discard** if any of these occurs:

- A track is wrongly detected as the microphone: the order rule is dropped, and the track number becomes a selectable setting.
- Playback distorts: mix level and limiter are adjusted.

## R6: map and round outcome via text recognition

**What changes.** With **"R6: map and round outcome via text recognition"** (default: off), the client reads every R6 clip with PaddleOCR PP-OCRv4 via ONNX Runtime on the CPU. It takes two frames per second at 1280 pixels width, as in the blind test.

- Map: the map name must be a whole line read or appear in front of location and country ("OREGON, USA"), with confidence ≥ 0.85, in at least two frames. If two maps tie, none applies.
- Round outcome: the lines read go through the same lexicon as the model's messages; only round and match results are taken. A model result at the same position (±5 s) gives way to the text recognition result.
- Title: the map is stated as a fact in the prompt. If a title names a different or an unrecognised R6 map, there is a follow-up question; the fallback title appends "auf <map>". Without the option, the title check stays as before.

**Tool.** `npm run r6 -- "<R6 folder>" --json r6.json` needs neither AI nor upload and shows map, results and computing time per clip. With `--rows` it writes all lines read per frame to the JSON file, to trace misreads.

| Check         | How                                                      | Success                                                | Discard                                                                                     |
| ------------- | -------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Map           | Detected map against ground truth, at least 26 clips     | Never wrong; open is allowed                           | One wrong map: the rule becomes stricter (for example three frames or a fixed image region) |
| Coverage      | Share of clips with a detected map                       | Measured and reported, no threshold                    | —                                                                                           |
| Round outcome | Results against ground truth                             | Never wrong; at least as many found as by the model    | One wrong result: text recognition no longer provides round results, only the map           |
| Tags          | Round win, round lost, victory, defeat                   | At least as good as before (29 of 31 across all tags)  | Worse than without text recognition                                                         |
| Title (AI)    | R6 clips with the option on versus off                   | Map in the title only if detected; never a wrong one   | A title with a wrong map                                                                    |
| Cost          | Computing time from the trace (`texts.seconds`) per clip | Under 90 s for a 2-minute clip, no stutter in the game | Noticeable stutter while playing: fewer cores or read only the end window                   |

More precise R6 events including kills could come from the game's match replays. That route is described in `docs/R6-REPLAYS.md`, including its own measurement plan. The measurement tool `npm run r6-replays` is built; nothing of it is integrated yet.
