import { parseArgs } from 'node:util';
import { access, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { clipWindow } from './fortnite';
import { developmentModels, TextReader } from './ocr';
import { actionAnchor, clipSecond, clockAnchors, readClock } from './r6-clock';
import type { ClockAnchor } from './r6-clock';
import { isR6 } from './r6';
import { gameLabel, listVideos } from './watcher';
import {
  buildDissect,
  closeRounds,
  defaultReplayFolders,
  DISSECT,
  dissectFile,
  matchFolders,
  ownRound,
  readRound,
  recorder,
  roundFileTimes,
  roundForClip,
} from './r6-replays';
import type { OwnKill, OwnRound, RoundChoice } from './r6-replays';
import { MediaProcessor } from '../server/media';
import { loadConfig } from '../server/config';

/**
 * Measurement tool for the R6 match replays (docs/R6-REPLAYS.md, measurement plan): lists map,
 * side, result and the player's own kills with round clock per match and round, and assigns
 * clips to a round. Without AI and without upload; the analysis does not use any of it yet.
 */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    clips: { type: 'string' },
    json: { type: 'string' },
    csv: { type: 'string' },
    dissect: { type: 'string' },
    build: { type: 'boolean', default: false },
    clock: { type: 'boolean', default: false },
    jobs: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});
const usage = [
  'Check R6 match replays:',
  'npm run r6-replays -- ["…\\MatchReplay"] [--clips "D:\\Clips\\Tom Clancy\'s Rainbow Six Siege"] [--clock] [--json result.json] [--jobs 2]',
  '--clock reads the round clock in every assigned clip and converts own kills to clip seconds.',
  '--csv times.csv also writes one row per kill and death with an empty column for the second seen in the video.',
  'npm run r6-replays -- --build   builds r6-dissect once from the pinned source revision (needs Go and Git)',
  'Without a folder it looks for MatchReplay in the install folders of Ubisoft Connect and Steam.',
].join('\n');
if (values.help) {
  console.log(usage);
  process.exit(0);
}
const jobs = values.jobs === undefined ? 2 : Number(values.jobs);
if (!(Number.isInteger(jobs) && jobs >= 1)) {
  console.log('--jobs needs a whole number from 1, e.g. 2.');
  process.exit(1);
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
let program = values.dissect ?? process.env.REPLAYHAVEN_R6_DISSECT ?? dissectFile();
if (values.build) {
  program = await buildDissect(dissectFile(), console.log);
  console.log(`Done: ${program}`);
  if (!positionals.length && !values.clips) process.exit(0);
}
if (!(await exists(program))) {
  console.log(
    `r6-dissect is missing (${program}).\nBuild it once: npm run r6-replays -- --build\nOr pass an existing program: --dissect "…\\r6-dissect.exe"`,
  );
  process.exit(1);
}
const folders = positionals.length
  ? positionals.map((p) => resolve(p))
  : (
      await Promise.all(defaultReplayFolders().map(async (f) => ((await exists(f)) ? f : '')))
    ).filter(Boolean);
if (!folders.length) {
  console.log(`No MatchReplay folder found. Is Match Replay turned on in the game?\n${usage}`);
  process.exit(1);
}

/** Works through the list with at most `limit` concurrent tasks, keeping the order. */
async function pool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await work(items[i]);
      }
    }),
  );
  return results;
}

const decimal = (value: number, digits = 1) => value.toFixed(digits).replace('.', ',');
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
const side = { attack: 'attack', defense: 'defense' } as const;
const killText = (k: OwnKill) =>
  `${clock(k.clock)}${k.headshot ? ' (headshot)' : ''}${k.afterPlant ? ' (after plant)' : ''}`;

/** One line per round: side, result, own kills and highlights. */
function roundLine(r: OwnRound) {
  if (r.problem) return `R${String(r.number).padStart(2, '0')}  ${r.problem}`;
  const outcome =
    r.won === undefined
      ? 'result unclear'
      : `${r.won ? 'win' : 'loss'}${r.condition ? `: ${r.condition}` : ''}`;
  const facts = [
    r.kills.length ? `kills ${r.kills.map(killText).join(', ')}` : 'no kills',
    ...(r.knocks.length ? [`enemies knocked down ${r.knocks.map(clock).join(', ')}`] : []),
    ...(r.death !== undefined
      ? [`died ${clock(r.death)}${r.deathAfterPlant ? ' (after plant)' : ''}`]
      : []),
    ...r.series.map((n) => `streak ${n}`),
    ...(r.ace ? ['Ace'] : []),
    ...(r.clutch ? [`clutch 1 vs ${r.clutch}`] : []),
  ];
  return `R${String(r.number).padStart(2, '0')}  ${(r.side ? side[r.side] : '?').padEnd(12)} ${outcome.padEnd(36)} ${facts.join(' · ')}`;
}

interface MatchResult {
  match: string;
  rounds: OwnRound[];
  errors: { file: string; error: string }[];
  /** Run time of r6-dissect for all rounds of the match, in seconds. */
  seconds: number;
}
const matches: MatchResult[] = [];
for (const folder of folders) {
  const found = await matchFolders(folder);
  console.log(`${folder}: ${found.length} match(es)`);
  for (const match of found) {
    const started = performance.now();
    const names = new Set<string>();
    const errors: MatchResult['errors'] = [];
    const read = await pool(match.rounds, jobs, async (path) => {
      try {
        const times = await roundFileTimes(path);
        const round = await readRound(program, path);
        const me = recorder(round)?.username;
        if (me) names.add(me);
        return ownRound(round, { path, ...times });
      } catch (error) {
        errors.push({
          file: basename(path),
          error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      }
    });
    const rounds = closeRounds(read.filter((r): r is OwnRound => !!r));
    const seconds = Math.round((performance.now() - started) / 100) / 10;
    matches.push({ match: match.name, rounds, errors, seconds });
    const first = rounds[0];
    const own = rounds.filter((r) => !r.problem);
    const kills = own.flatMap((r) => r.kills);
    console.log(
      `\n${match.name}: ${[first?.map, first?.matchType, first?.mode, first?.season].filter(Boolean).join(', ')} · ${rounds.length} rounds, ${own.filter((r) => r.won).length} won · own kills ${kills.length}, ${kills.filter((k) => k.headshot).length} of them headshots, ${own.filter((r) => r.death !== undefined).length} deaths · ${decimal(seconds)} s`,
    );
    // The player's own name appears only here in the terminal, not in the JSON output.
    if (names.size) console.log(`  Own player: ${[...names].join(', ')}`);
    for (const r of rounds) console.log(`  ${roundLine(r)}`);
    for (const warning of new Set(
      rounds.flatMap((r) => r.warnings.map((w) => `R${r.number}: ${w}`)),
    ))
      console.log(`  Warning ${warning}`);
    for (const e of errors) console.log(`  Error in ${e.file}: ${e.error}`);
  }
}
if (matches.length)
  console.log(
    '\nPlease compare each match with the in-game summary: own kills, deaths, rounds won.',
  );

interface ClockResult {
  /** Frames with a readable round clock. */
  readings: number;
  anchors: ClockAnchor[];
  anchor?: ClockAnchor;
  /** Own kills and own death as clip seconds; null where the time is open. */
  moments: { kind: 'kill' | 'death'; clock: number; headshot?: boolean; seconds: number | null }[];
  /** Wall time and CPU time of this process; FFmpeg is not counted. */
  seconds: number;
  cpuSeconds: number;
}

/** Reads the clip's round clock and maps the round's own moments to clip seconds. */
async function clockFor(path: string, round: OwnRound): Promise<ClockResult> {
  const started = performance.now();
  const cpu = process.cpuUsage();
  // One thread: more threads barely save time here but cost several times the CPU.
  reader ??= TextReader.load(developmentModels(), 1);
  const samples = await readClock(media, await reader, path);
  const anchors = clockAnchors(samples);
  const anchor = actionAnchor(anchors);
  const at = (clock: number, afterPlant = false) =>
    anchor && !afterPlant ? clipSecond(anchor, clock) : null;
  const used = process.cpuUsage(cpu);
  return {
    readings: samples.length,
    anchors,
    ...(anchor ? { anchor } : {}),
    moments: [
      ...round.kills.map((k) => ({
        kind: 'kill' as const,
        clock: k.clock,
        headshot: k.headshot,
        seconds: at(k.clock, k.afterPlant),
      })),
      ...(round.death !== undefined
        ? [
            {
              kind: 'death' as const,
              clock: round.death,
              seconds: at(round.death, round.deathAfterPlant),
            },
          ]
        : []),
    ],
    seconds: Math.round((performance.now() - started) / 100) / 10,
    cpuSeconds: Math.round((used.user + used.system) / 1e5) / 10,
  };
}

/** One line for the round clock and one for the moments, to compare with the video. */
function clockLines(result: ClockResult, duration: number) {
  const anchor = result.anchor;
  const head = anchor
    ? `Round clock: ${result.readings} readings, anchor ${decimal(anchor.anchor)} from ${anchor.samples} matching (${anchor.action ? 'action phase' : 'phase open: only values up to 0:45'}), ${decimal(result.cpuSeconds)} s CPU`
    : `Round clock: ${result.readings} readings, no anchor (too few agree)`;
  const moments = result.moments.map((m) => {
    const what =
      m.kind === 'kill'
        ? `kill ${clock(m.clock)}${m.headshot ? ' (headshot)' : ''}`
        : `death ${clock(m.clock)}`;
    if (m.seconds === null) return `${what} → time open`;
    return `${what} → ${m.seconds >= 0 && m.seconds <= duration ? `${decimal(m.seconds)} s` : `outside (${decimal(m.seconds)} s)`}`;
  });
  return [head, ...(moments.length ? [moments.join(' · ')] : [])];
}

const clips: {
  clip: string;
  duration?: number;
  window?: { start: string; end: string; anchor: string };
  choice?: Omit<RoundChoice, 'round'> & { match?: string; round?: number };
  clock?: ClockResult;
  error?: string;
}[] = [];
// For the Time stage of the measurement plan: you enter the seen second by hand.
const rows = ['clip;round;event;round_clock;headshot;clip_second_computed;clip_second_seen'];
const media = new MediaProcessor(loadConfig());
let reader: Promise<TextReader> | undefined;
if (values.clips) {
  const all = matches.flatMap((m) => m.rounds.map((round) => ({ match: m.match, round })));
  const paths = (await listVideos(resolve(values.clips))).filter((p) => isR6(gameLabel('', p)));
  console.log(`\nR6 clips in ${resolve(values.clips)}: ${paths.length}`);
  for (const path of paths) {
    try {
      const { duration } = await media.probe(path);
      const window = clipWindow(path, duration, (await stat(path)).mtimeMs);
      const choice: RoundChoice = window
        ? roundForClip(
            window,
            all.map((a) => a.round),
          )
        : {
            overlap: 0,
            candidates: [],
            reason: 'clip time unknown (no NVIDIA name or edited file)',
          };
      const hit = choice.round ? all.find((a) => a.round === choice.round) : undefined;
      const timed =
        values.clock && hit && !hit.round.problem ? await clockFor(path, hit.round) : undefined;
      clips.push({
        clip: basename(path),
        duration,
        ...(window
          ? {
              window: {
                start: new Date(window.start).toISOString(),
                end: new Date(window.end).toISOString(),
                anchor: window.anchor,
              },
            }
          : {}),
        choice: {
          overlap: choice.overlap,
          candidates: choice.candidates,
          ...(choice.reason ? { reason: choice.reason } : {}),
          ...(hit ? { match: hit.match, round: hit.round.number } : {}),
        },
        ...(timed ? { clock: timed } : {}),
      });
      const text = hit
        ? `R${String(hit.round.number).padStart(2, '0')} in ${hit.match}, ${decimal(choice.overlap)} s in the clip — ${roundLine(hit.round).slice(5).trim()}`
        : `no round (${choice.reason}${choice.candidates.length ? `: ${choice.candidates.map((c) => `R${c.number} ${decimal(c.overlap)} s`).join(', ')}` : ''})`;
      console.log(`  ${basename(path)} (${decimal(duration)} s): ${text}`);
      if (timed) for (const line of clockLines(timed, duration)) console.log(`    ${line}`);
      for (const m of timed?.moments ?? [])
        rows.push(
          [
            basename(path),
            `R${hit!.round.number}`,
            m.kind === 'kill' ? 'kill' : 'death',
            clock(m.clock),
            m.headshot ? 'yes' : '',
            m.seconds === null ? 'open' : decimal(m.seconds),
            '',
          ].join(';'),
        );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      clips.push({ clip: basename(path), error: message });
      console.log(`  ${basename(path)}: error (${message})`);
    }
  }
}

await (await reader?.catch(() => undefined))?.close();

if (values.csv) {
  await writeFile(resolve(values.csv), `${rows.join('\n')}\n`);
  console.log(`\nCSV: ${resolve(values.csv)} (${rows.length - 1} rows)`);
}
if (values.json) {
  await writeFile(
    resolve(values.json),
    JSON.stringify({ parser: { ...DISSECT, program: basename(program) }, matches, clips }, null, 2),
  );
  console.log(`\nJSON: ${resolve(values.json)}`);
}
