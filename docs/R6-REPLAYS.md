# Research: R6 match replays as an event source

**Goal.** Precise R6 events for titles like "Ace auf Oregon" or "Doppel-Kill per Kopfschuss". Reading the dense killfeed via text recognition has failed. The source here would be the match replay files the game writes itself.

Status 2026-09-24: the measurement tool `npm run r6-replays` is built (see below); nothing is integrated into the analysis. It has only been checked on the nine sample rounds of r6-dissect (Y8S1 to Y9S1) and on one rendered clip. No current `.rec` file and no real R6 clips were available here.

Status 2026-09-25: first measurement on real matches, see [First measurement](#first-measurement-2026-09-25). Since then the client backs up the match for every R6 clip (option "Keep R6 replays for clips"), so the rounds are still there when the evaluation is integrated.

## What the game writes

- **Folder:** In the game's install folder under `MatchReplay`, according to Ubisoft roughly `…\Ubisoft Game Launcher\games\Tom Clancy's Rainbow Six Siege\MatchReplay`.
- **Files:** One folder per match, `Match-YYYY-MM-DD_hh-mm-ss-<n>`, containing one file per round: `…-R01.rec`, `…-R02.rec` and so on.
- **Retention:** The game only keeps the most recent matches. Sources mention 10 to 12; on a test PC on 2026-09-25 there were 30 matches totalling 940 MB, so about 30 MB per match. Older clips therefore no longer have a replay unless someone backs it up beforehand.
- **Prerequisite:** Match Replay must be enabled in the game settings. Which game modes are recorded is settled by the first measurement step.
- **Format:** zstd-compressed in blocks. It starts with a header of plain-text properties, followed by undocumented data packets.

## What can be read from it

It is based on the parser r6-dissect (MIT, Go).

| Data                                              | Source             | Note                                                               |
| ------------------------------------------------- | ------------------ | ------------------------------------------------------------------ |
| Map, game mode, match type, round number          | Header             | Exact                                                              |
| Recording player                                  | Header             | Via the Ubisoft profile ID, otherwise the player ID; no heuristics |
| Score, winner, win condition, role                | Header and packets | Win condition such as "enemies eliminated", "bomb defused", "time" |
| Kills with shooter, victim, headshot, round clock | Packets (patterns) | Also DBNO and finish-off; the parser filters out team kills        |
| Defuser planted or disabled, operators            | Packets and header |                                                                    |
| Weapon                                            | not included       | So R6 titles with a weapon stay out                                |

**Derivable from this:**

- The own player's kills per round, and from those, streaks and the ace (five kills in one round).
- Headshots.
- Round win or loss with win condition.
- Clutch, when the own player is the last one left on their team and the team wins.

Other players' names do not belong in titles.

## Which parser

- **Original, redraskal/r6-dissect:** The last change is from 2025-09-15. It only reads up to Y10S3.
- **Fork, Gipson62/r6-dissect:** It is maintained; the last change from 2026-08-21 adds Y11S2. Its version checks say "from Y10S4", so newer seasons take the newest path. Whether Y11S3 is read correctly with that is open. The fork has no releases.
- **Reading works via byte patterns** with version thresholds, not a documented format. After a season update, kills can be missing or wrongly attributed until the parser catches up.

## Time: from the round clock to the clip second

Kill times are the round clock from the HUD, not wall-clock time. In r6-dissect's example, the objective reveal falls in the preparation phase (0:26). "Friendly Fire is now active" appears at 2:59, i.e. at the start of the action phase, which counts down from 3:00. The kills follow below that. After the defuser is planted, the HUD shows the defuser countdown. How the parser keeps time after that is not settled without a real file.

A wall-clock time only exists in the header (`datetime`) and in the file time. The header is probably UTC; r6-dissect converts it to local time for display. That narrows down the round but is not enough for kills to the second: how much time passes between the header time and 3:00 (operator selection, preparation) is unknown.

**Proposal**

1. **Choose the round via wall-clock time.** The clip window comes from NVIDIA names and the file time, as with Fortnite. The round window runs from the header time to the file's last write time. Whether the header is UTC or local time is decided by the file time, as with Fortnite.
2. **Determine the second via the round clock in the image.** For this, the existing text recognition reads only the crop at the top centre, two frames per second, until ten readings agree. If it reads "1:51" at clip second 12, then for every kill in the round: clip second = 12 + (111 − kill seconds). Several anchors must agree (clip second + clock stays constant within a phase); outliers are dropped.
3. **Without a readable clock** there are no kills, only information about the whole round such as map and round outcome.

Cost, measured on the rendered clip: about 70 ms of CPU per crop and 1.2 s until a reliable anchor, including loading the models, instead of about 70 s for whole frames. Where the clock sits in the real HUD has not been measured yet. If this route works, the replay provides map and round outcome more precisely than the current text recognition on whole frames.

## Implementation: two routes

| Route                                                                  | Advantage                                                                                      | Disadvantage                                                                                                  |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Fork as the program `r6-dissect.exe` next to the client                | Reads whatever the fork can; fixes can be adopted. Built here for Windows: 7.7 MB, without cgo | Go build in the release pipeline, pinned to a commit because the fork has no releases                         |
| Reimplementation in TypeScript (header, killfeed, time; zstd via Node) | No third-party program                                                                         | About 1,000 lines of pattern code that can break with every season; cannot be checked here without real files |

**Recommendation:** first a measurement tool with the fork as a program. A reimplementation is only worth it once the measurement holds up.

## Privacy

- Everything runs locally.
- The files contain the names of all ten players. Only the own player's events go into the analysis; other names end up neither in the title nor on your server.

## Measurement plan

| Stage        | How                                                           | Success                                                                                                                        | Discard                                                                         |
| ------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Readability  | Measurement tool over all available matches                   | Every round has map, outcome and own player; the own kills per match match the in-game scoreboard in at least 19 of 20 matches | More than one match in 20 wrong: use only map and outcome, or discard the route |
| Round choice | All clips of one session                                      | Every clip gets the right round or "none", never a wrong one                                                                   | One wrong round in 20 clips: narrow the window or discard                       |
| Time         | 20 clips with own kills, clip second per kill against viewing | ≥ 90 % of kills within ± 1 s                                                                                                   | > 10 % more than 3 s off: no kill seconds, only round information               |
| Cost         | Computing time of parser plus clock detection per clip        | < 10 s CPU                                                                                                                     | Noticeable stutter while playing                                                |
| Title        | R6 clips with and without replay events, rated by you         | More titles that match what you remember (ace, clutch, headshots); no contradiction with the clip                              | No gain over today: option stays off                                            |
| Season patch | Run the measurement tool again after the next patch           | Keeps reading or reports an unknown version instead of returning wrong data                                                    | Wrong data without a warning: tighten the plausibility check or discard         |

## Measurement tool `npm run r6-replays`

It changes nothing in the analysis and uploads nothing.

1. Enable Match Replay in R6, play a few matches and save clips as usual.
2. Build the parser once: `npm run r6-replays -- --build`. This fetches the fork via Git at the pinned commit `e360e2b` and builds it with Go. If Go is missing: `winget install GoLang.Go`, then open a new terminal. The program then lives under `%LOCALAPPDATA%\ReplayHaven\tools`.
3. Measure: `npm run r6-replays -- --clips "D:\Clips\Tom Clancy's Rainbow Six Siege" --clock --json r6.json --csv times.csv`. Without a folder argument it looks for `MatchReplay` in the install folders of Ubisoft Connect and Steam. If the game is installed elsewhere, pass the folder as the first argument.

**Output**

- **Per match:** map, match type, season, rounds, rounds won, own kills including headshots, deaths. Compare these numbers with the in-game scoreboard (stage Readability).
- **Per round:** side, outcome with win condition, own kills with round clock, streaks (at most 12 s apart), ace, clutch and own death.
- **Warnings:** killfeed and statistics disagree, a kill names unknown players, or the season is newer than the parser version (stage Season patch).
- **Per clip:** the round via wall-clock time, otherwise "no round" with a reason (stage Round choice).
- **With `--clock`:** additionally the round clock read, the anchor, and every own kill and death as a clip second (stage Time). Kills after the defuser is planted stay "time open". With `--csv`, one row per kill and death is added, with an empty column for the second you see in the video.
- **Names:** your own player name only appears in the terminal. The JSON file contains no names and no account or match IDs.

**Checked so far**

- **Sample rounds:** parser and evaluation on the nine sample rounds of r6-dissect (Y8S1 to Y9S1). In seven, the own player was detected; two are spectator recordings. In one round only the profile ID matched, not the player ID. A round lasted 2 to 6 s here.
- **Round clock:** on a rendered 30 s clip with the clock at the top centre. All 60 readings were correct; the kills were accurate to half a second.
- **End to end:** a sample round with adjusted file time plus a rendered clip with an NVIDIA name were assigned and anchored correctly.

**Not checked:** current seasons, real clips, the position of the clock in the real HUD and the time after the defuser is planted. That is exactly what the measurement will settle.

## Next steps

1. You run the measurement tool over your matches and clips and compare with the in-game scoreboard and the videos. The JSON file contains no player names and can be shared safely.
2. Only after passing the measurement is it integrated, behind an option that is off at first. For that, the Go build goes into the release pipeline.

## First measurement (2026-09-25)

30 matches from July 2026 (season Y11S2), parser at the pinned revision `e360e2b`.

- **Readability:** 134 of 155 rounds read (86 %). 21 rounds abort with a parser crash; four matches yield no round at all. Each round read provides outcome with win condition, own kills with round clock, headshots, knockdowns, streaks, ace, clutch and own death. The recording player was detected in all rounds read.
- **Maps:** in 16 of 26 matches the parser does not know the map ID ("Map(441825219764)"); the others have internal names such as "ChaletY10". For titles, the map would still come from text recognition, which has read it reliably since the rework on the same day.
- **Noticeable:** some times look implausible, for example a kill at 0:00 or a kill and own death in the same second. Whether that is correct will only be settled by comparing with the in-game scoreboard.
- **Round choice and time:** not measurable. The existing R6 clips are from 2024 and 2025; there are no replays for them any more. The only clip from July is 0.3 s long.

**Conclusion:** the parser largely reads the current season. It will only be integrated after the Round choice and Time stages, and that requires new R6 clips with a backed-up match. That is exactly why the client now backs up the match for every R6 clip: right after the upload, never during the gaming pause, and, for a match that may still be running, again once a minute until the last round is written. The target is `%LOCALAPPDATA%\ReplayHaven\r6-replays`.
