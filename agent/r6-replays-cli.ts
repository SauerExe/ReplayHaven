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
  roundForClip,
} from './r6-replays';
import type { OwnKill, OwnRound, RoundChoice } from './r6-replays';
import { MediaProcessor } from '../server/media';
import { loadConfig } from '../server/config';

/**
 * Messwerkzeug für die R6-Match-Replays (docs/R6-REPLAYS.md, Messplan): listet je Match und
 * Runde Karte, Seite, Ausgang und die eigenen Kills mit Rundenuhr und ordnet Clips einer Runde
 * zu. Ohne KI und ohne Upload; die Analyse nutzt davon noch nichts.
 */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    clips: { type: 'string' },
    json: { type: 'string' },
    csv: { type: 'string' },
    dissect: { type: 'string' },
    build: { type: 'boolean', default: false },
    uhr: { type: 'boolean', default: false },
    jobs: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});
const usage = [
  'R6-Match-Replays prüfen:',
  'npm run r6-replays -- ["…\\MatchReplay"] [--clips "D:\\Clips\\Tom Clancy\'s Rainbow Six Siege"] [--uhr] [--json ergebnis.json] [--jobs 2]',
  '--uhr liest in jedem zugeordneten Clip die Rundenuhr und rechnet eigene Kills auf Clipsekunden um.',
  '--csv zeit.csv schreibt dazu je Kill und Tod eine Zeile mit leerer Spalte für die im Video gesehene Sekunde.',
  'npm run r6-replays -- --build   baut r6-dissect einmalig aus dem gepinnten Quellstand (braucht Go und Git)',
  'Ohne Ordner sucht es MatchReplay im Installationsordner von Ubisoft Connect und Steam.',
].join('\n');
if (values.help) {
  console.log(usage);
  process.exit(0);
}
const jobs = values.jobs === undefined ? 2 : Number(values.jobs);
if (!(Number.isInteger(jobs) && jobs >= 1)) {
  console.log('--jobs braucht eine ganze Zahl ab 1, etwa 2.');
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
  console.log(`Fertig: ${program}`);
  if (!positionals.length && !values.clips) process.exit(0);
}
if (!(await exists(program))) {
  console.log(
    `r6-dissect fehlt (${program}).\nEinmalig bauen: npm run r6-replays -- --build\nOder ein vorhandenes Programm angeben: --dissect "…\\r6-dissect.exe"`,
  );
  process.exit(1);
}
const folders = positionals.length
  ? positionals.map((p) => resolve(p))
  : (
      await Promise.all(defaultReplayFolders().map(async (f) => ((await exists(f)) ? f : '')))
    ).filter(Boolean);
if (!folders.length) {
  console.log(
    `Kein MatchReplay-Ordner gefunden. Ist Match Replay im Spiel eingeschaltet?\n${usage}`,
  );
  process.exit(1);
}

/** Arbeitet die Liste mit höchstens `limit` gleichzeitigen Aufgaben ab, in fester Reihenfolge. */
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
const side = { attack: 'Angriff', defense: 'Verteidigung' } as const;
const killText = (k: OwnKill) =>
  `${clock(k.clock)}${k.headshot ? ' (Kopfschuss)' : ''}${k.afterPlant ? ' (nach dem Legen)' : ''}`;

/** Eine Zeile je Runde: Seite, Ausgang, eigene Kills und Besonderheiten. */
function roundLine(r: OwnRound) {
  if (r.problem) return `R${String(r.number).padStart(2, '0')}  ${r.problem}`;
  const outcome =
    r.won === undefined
      ? 'Ausgang unklar'
      : `${r.won ? 'Sieg' : 'Niederlage'}${r.condition ? `: ${r.condition}` : ''}`;
  const facts = [
    r.kills.length ? `Kills ${r.kills.map(killText).join(', ')}` : 'keine Kills',
    ...(r.knocks.length ? [`Gegner niedergeschlagen ${r.knocks.map(clock).join(', ')}`] : []),
    ...(r.death !== undefined ? [`gestorben ${clock(r.death)}`] : []),
    ...r.series.map((n) => `Serie ${n}`),
    ...(r.ace ? ['Ace'] : []),
    ...(r.clutch ? [`Clutch 1 gegen ${r.clutch}`] : []),
  ];
  return `R${String(r.number).padStart(2, '0')}  ${(r.side ? side[r.side] : '?').padEnd(12)} ${outcome.padEnd(36)} ${facts.join(' · ')}`;
}

interface MatchResult {
  match: string;
  rounds: OwnRound[];
  errors: { file: string; error: string }[];
  /** Laufzeit von r6-dissect für alle Runden des Matches, in Sekunden. */
  seconds: number;
}
const matches: MatchResult[] = [];
for (const folder of folders) {
  const found = await matchFolders(folder);
  console.log(`${folder}: ${found.length} Match(es)`);
  for (const match of found) {
    const started = performance.now();
    const names = new Set<string>();
    const errors: MatchResult['errors'] = [];
    const read = await pool(match.rounds, jobs, async (path) => {
      try {
        const info = await stat(path);
        const round = await readRound(program, path);
        const me = recorder(round)?.username;
        if (me) names.add(me);
        return ownRound(round, { path, mtime: info.mtimeMs, birthtime: info.birthtimeMs });
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
      `\n${match.name}: ${[first?.map, first?.matchType, first?.mode, first?.season].filter(Boolean).join(', ')} · ${rounds.length} Runden, ${own.filter((r) => r.won).length} gewonnen · eigene Kills ${kills.length}, davon ${kills.filter((k) => k.headshot).length} Kopfschüsse, ${own.filter((r) => r.death !== undefined).length} Tode · ${decimal(seconds)} s`,
    );
    // Der eigene Name steht nur hier im Terminal, nicht in der JSON-Ausgabe.
    if (names.size) console.log(`  Eigener Spieler: ${[...names].join(', ')}`);
    for (const r of rounds) console.log(`  ${roundLine(r)}`);
    for (const warning of new Set(
      rounds.flatMap((r) => r.warnings.map((w) => `R${r.number}: ${w}`)),
    ))
      console.log(`  Achtung ${warning}`);
    for (const e of errors) console.log(`  Fehler in ${e.file}: ${e.error}`);
  }
}
if (matches.length)
  console.log(
    '\nBitte je Match mit der Übersicht im Spiel vergleichen: eigene Kills, Tode, gewonnene Runden.',
  );

interface ClockResult {
  /** Bilder mit lesbarer Rundenuhr. */
  readings: number;
  anchors: ClockAnchor[];
  anchor?: ClockAnchor;
  /** Eigene Kills und der eigene Tod als Clipsekunde; null, wo die Zeit offen ist. */
  moments: { kind: 'kill' | 'death'; clock: number; headshot?: boolean; seconds: number | null }[];
  /** Laufzeit und Rechenzeit dieses Prozesses; FFmpeg zählt nicht mit. */
  seconds: number;
  cpuSeconds: number;
}

/** Liest die Rundenuhr des Clips und setzt die eigenen Momente der Runde auf Clipsekunden. */
async function clockFor(path: string, round: OwnRound): Promise<ClockResult> {
  const started = performance.now();
  const cpu = process.cpuUsage();
  // Ein Thread: Mehr Threads sparen hier kaum Zeit, kosten aber ein Vielfaches an CPU.
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
        ? [{ kind: 'death' as const, clock: round.death, seconds: at(round.death) }]
        : []),
    ],
    seconds: Math.round((performance.now() - started) / 100) / 10,
    cpuSeconds: Math.round((used.user + used.system) / 1e5) / 10,
  };
}

/** Eine Zeile für die Rundenuhr und eine für die Momente, zum Abgleich mit dem Video. */
function clockLines(result: ClockResult, duration: number) {
  const anchor = result.anchor;
  const head = anchor
    ? `Rundenuhr: ${result.readings} Lesungen, Anker ${decimal(anchor.anchor)} aus ${anchor.samples} passenden (${anchor.action ? 'Aktionsphase' : 'Phase offen: nur Werte bis 0:45'}), ${decimal(result.cpuSeconds)} s CPU`
    : `Rundenuhr: ${result.readings} Lesungen, kein Anker (zu wenige übereinstimmende)`;
  const moments = result.moments.map((m) => {
    const what =
      m.kind === 'kill'
        ? `Kill ${clock(m.clock)}${m.headshot ? ' (Kopfschuss)' : ''}`
        : `Tod ${clock(m.clock)}`;
    if (m.seconds === null) return `${what} → Zeit offen`;
    return `${what} → ${m.seconds >= 0 && m.seconds <= duration ? `${decimal(m.seconds)} s` : `außerhalb (${decimal(m.seconds)} s)`}`;
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
// Für die Stufe Zeit im Messplan: die gesehene Sekunde trägst du von Hand ein.
const rows = ['clip;runde;ereignis;rundenuhr;kopfschuss;clipsekunde_berechnet;clipsekunde_gesehen'];
const media = new MediaProcessor(loadConfig());
let reader: Promise<TextReader> | undefined;
if (values.clips) {
  const all = matches.flatMap((m) => m.rounds.map((round) => ({ match: m.match, round })));
  const paths = (await listVideos(resolve(values.clips))).filter((p) => isR6(gameLabel('', p)));
  console.log(`\nR6-Clips in ${resolve(values.clips)}: ${paths.length}`);
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
            reason: 'Clipzeit unbekannt (kein NVIDIA-Name oder bearbeitete Datei)',
          };
      const hit = choice.round ? all.find((a) => a.round === choice.round) : undefined;
      const timed =
        values.uhr && hit && !hit.round.problem ? await clockFor(path, hit.round) : undefined;
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
        ? `R${String(hit.round.number).padStart(2, '0')} in ${hit.match}, ${decimal(choice.overlap)} s im Clip — ${roundLine(hit.round).slice(5).trim()}`
        : `keine Runde (${choice.reason}${choice.candidates.length ? `: ${choice.candidates.map((c) => `R${c.number} ${decimal(c.overlap)} s`).join(', ')}` : ''})`;
      console.log(`  ${basename(path)} (${decimal(duration)} s): ${text}`);
      if (timed) for (const line of clockLines(timed, duration)) console.log(`    ${line}`);
      for (const m of timed?.moments ?? [])
        rows.push(
          [
            basename(path),
            `R${hit!.round.number}`,
            m.kind === 'kill' ? 'Kill' : 'Tod',
            clock(m.clock),
            m.headshot ? 'ja' : '',
            m.seconds === null ? 'offen' : decimal(m.seconds),
            '',
          ].join(';'),
        );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      clips.push({ clip: basename(path), error: message });
      console.log(`  ${basename(path)}: Fehler (${message})`);
    }
  }
}

await (await reader?.catch(() => undefined))?.close();

if (values.csv) {
  await writeFile(resolve(values.csv), `${rows.join('\n')}\n`);
  console.log(`\nCSV: ${resolve(values.csv)} (${rows.length - 1} Zeilen)`);
}
if (values.json) {
  await writeFile(
    resolve(values.json),
    JSON.stringify({ parser: { ...DISSECT, program: basename(program) }, matches, clips }, null, 2),
  );
  console.log(`\nJSON: ${resolve(values.json)}`);
}
