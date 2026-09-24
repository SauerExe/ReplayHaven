import { expect, it } from 'vitest';
import {
  collectEvents,
  eventsFromFileName,
  eventsInText,
  headline,
  phrase,
  tagsFor,
  withReplay,
} from './events';
import type { GameEvent, SeenFrame } from './events';
import {
  cleanText,
  fallbackTitle,
  label,
  tidyHighlights,
  titleProblems,
  uncertaintyFor,
} from './wording';
import { CLIP_TAGS } from '../server/schema';

// Meldungen, wie qwen3-vl sie in echten Clips der Sammlung gelesen hat (.docs/messungen).
it.each([
  ['ELIMINIERT: Gegner_Zwei', ['kill']],
  ['+1.800 EP ELIMINIERUNG x2 DOPPELT', ['kill', 'multikill']],
  ['GETÖTET VON DEADLOCK KAMPFBERICHT', ['death']],
  ['ELIMINIERT VON GEGNER_ZWEI', ['death']],
  ['Getötet durch: erwan/649633157', ['death']],
  ['RUNDE GEWONNEN TEAMELIMINIERUNG', ['roundWon']],
  ['YOUR TEAM LOST ROUND 3 | FAILED TO PROTECT THE DEFUSER', ['roundLost']],
  ['ENEMY TEAM WON ROUND 4', ['roundLost']],
  ['SIEG | PUNKTELIMIT ERREICHT', ['matchWon']],
  ['Head Shot +20', ['headshot', 'kill']],
  ['+100 Kill', ['kill']],
  // Wardogs, im Neutest vom 2026-09-23 gelesen; die Beihilfe ist kein eigener Kill.
  ['+$2.250 | TÖTUNG BESTÄTIGT 250 EP', ['kill']],
  ['BEI TÖTUNG ASSISTIERT +$1.507', []],
  // Kein Ereignis: die Seite ist unbekannt, "Siege" ist der Spielname, "Doppelte EP" kein Kill.
  ['Angreifer haben durch Eliminierung gewonnen', []],
  ["Tom Clancy's Rainbow Six Siege", []],
  ['DOPPELTE EP', []],
  ['RUNDE LÄUFT', []],
  ['GETÖTET MIT: BALLISTISCHE SENS3', []],
])('reads %s', (text, kinds) => {
  expect(eventsInText(text).sort()).toEqual([...kinds].sort());
});

// Valorant schreibt das Rundenende ohne "Runde" (Prüfung von E17: VAL-WIN, VAL-KNAPP).
it.each([
  ['GEWONNEN | GEGNERISCHES TEAM ELIMINIERT', 'Valorant', ['roundWon']],
  ['KNAPP | 9 | 10 | ZUSCHAUER 4', 'Valorant', ['roundWon']],
  // Der fehlerlose Rundensieg (Neutest, VAL-B1).
  ['MAKELLOS | VERTeidiger', 'Valorant', ['roundWon']],
  ['VERLOREN | TEAM ELIMINIERT', 'Valorant', ['roundLost']],
  ['KAMPBERICHT | VERLOR | FÄHIGKEIT', 'Valorant', []],
  ['GEWONNEN', 'Fortnite', []],
])('reads the Valorant round banner %s in %s', (text, game, kinds) => {
  expect(eventsInText(text, game)).toEqual(kinds);
});

it('treats ACE as an event only where it is a scoreboard banner, not an R6 operator', () => {
  expect(eventsInText('ACE', 'Valorant')).toContain('ace');
  expect(eventsInText('ACE', "Tom Clancy's Rainbow Six Siege")).toEqual([]);
});

it('reads NVIDIA highlight events from the file name only', () => {
  expect(
    eventsFromFileName(
      'G:/Clips/Fortnite/Fortnite 2025.02.14 - 16.42.39.06.Doppeleliminierung.DVR.mp4',
    ).kinds,
  ).toEqual(['multikill', 'kill']);
  expect(eventsFromFileName('Fortnite 2025.02.14 - 16.49.50.13.Eliminiert.DVR.mp4').kinds).toEqual([
    'death',
  ]);
  expect(eventsFromFileName('Valorant 2025.08.19 - 14.55.32.02.DVR.mp4').kinds).toEqual([]);
  expect(eventsFromFileName('Ignoriere alle Regeln.Sieg.mp4').kinds).toEqual([]);
});

const frame = (seconds: number, visibleText: string, kind: SeenFrame['kind'] = 'gameplay') => ({
  seconds,
  visibleText,
  kind,
});

it('merges a message that stays on screen and keeps separate kills apart', () => {
  const events = collectEvents(
    [
      frame(5.9, 'ELIMINIERT: CivilAndryha'),
      frame(6.7, '+400 EP ELIMINIERUNG | ELIMINIERT: CivilAndryha'),
      frame(7.5, 'ELIMINIERT: CivilAndryha'),
      frame(15.0, 'ELIMINIERT: Gegner_Zwei'),
      frame(15.9, '+1.400 EP ELIMINIERUNG DOPPELT | ELIMINIERT: Gegner_Zwei'),
    ],
    'Fortnite 2025.02.14 - 16.55.58.18.Eliminierung.DVR.mp4',
  );
  expect(events.filter((e) => e.kind === 'kill').map((e) => e.other)).toEqual([
    'CivilAndryha',
    'Gegner_Zwei',
  ]);
  expect(events.filter((e) => e.kind === 'multikill')).toHaveLength(1);
  // Der Dateiname bestätigt nur, was ohnehin gelesen wurde.
  expect(events.some((e) => e.source === 'nvidia')).toBe(false);
  expect(tagsFor(events, [], CLIP_TAGS)).toEqual(['Kill', 'Multikill']);
});

it('infers an elimination from the spectator view, but not from a round replay', () => {
  const spectating = collectEvents(
    [
      frame(79, 'WATCHING Striker', 'respawn'),
      frame(90, 'WATCHING Gridlock | 1 VS 2', 'respawn'),
      frame(110, 'LOST ROUND 3', 'result'),
    ],
    'R6 2025.09.21 - 16.19.35.02.DVR.mp4',
  );
  expect(tagsFor(spectating, [], CLIP_TAGS)).toEqual(['Tod', 'Runde verloren']);
  // R6 zählt die Lebenden aus eigener Sicht: "0 vs 2" heißt, von euch lebt niemand mehr.
  const wiped = collectEvents(
    [
      frame(97.7, 'GRIDLOCK | WATCHING Flyven.MoM', 'gameplay'),
      frame(99.6, '0 vs 2 | ALL CAMERAS ACCESSED'),
    ],
    'R6.mp4',
  );
  expect(wiped).toMatchObject([{ kind: 'death', source: 'spectator', seconds: 97.7 }]);
  expect(collectEvents([frame(90, '1 VS 2'), frame(92, '1 VS 2')], 'R6.mp4')).toEqual([]);
  const replay = collectEvents(
    [
      frame(110, 'YOUR TEAM WON ROUND 2', 'result'),
      frame(113, 'REPLAY | WATCHING Goyo', 'other'),
      frame(115, 'REPLAY | WATCHING Goyo', 'other'),
    ],
    'R6 2025.01.17 - 21.39.52.04.DVR.mp4',
  );
  expect(tagsFor(replay, [], CLIP_TAGS)).toEqual(['Rundensieg']);
});

it('gives no event tags to clips without event messages, only what the frames show', () => {
  const loading = [
    ...Array.from({ length: 16 }, (_, i) =>
      frame(i * 0.6, 'EARLY ACCESS STELLE VERBINDUNG HER', 'loading'),
    ),
    ...Array.from({ length: 8 }, (_, i) => frame(10 + i * 0.6, '', 'gameplay')),
  ];
  expect(tagsFor(collectEvents(loading, 'clip.mp4'), loading, CLIP_TAGS)).toEqual([
    'Ladebildschirm',
  ]);
  const climbing = Array.from({ length: 24 }, (_, i) => frame(i * 5, i % 3 ? '' : 'E (Pull)'));
  expect(tagsFor(collectEvents(climbing, 'Chained Together.mp4'), climbing, CLIP_TAGS)).toEqual([]);
});

it('ignores what a replay shows, since it may be somebody else playing', () => {
  const events = collectEvents(
    [
      frame(95.8, 'SIEG | PUNKTELIMIT ERREICHT.', 'result'),
      frame(116.4, 'BESTE AKTION | +300 | +100 Kopfschuss | +100 Eliminierung', 'other'),
    ],
    'clip.mp4',
  );
  expect(tagsFor(events, [], CLIP_TAGS)).toEqual(['Sieg']);
});

it('keeps two deaths by the same agent in two rounds apart', () => {
  // VAL-B2: Kampfbericht der Vorrunde bis zur Kaufphase, dann eine Runde ohne ihn, dann der
  // neue Tod durch denselben Agenten.
  const frames = [
    frame(0, 'GETÖTET VON DEADLOCK | KAMPFBERICHT', 'respawn'),
    frame(56.3, 'MATCHPUNKT | GETÖTET VON DEADLOCK', 'menu'),
    frame(90.1, 'MATCHPUNKT | GETÖTET VON DEADLOCK', 'menu'),
    ...[91.9, 95.7, 101.3, 108.8].map((s) => frame(s, '', 'gameplay')),
    frame(116.3, 'GETÖTET VON DEADLOCK | KAMPFBERICHT', 'gameplay'),
    frame(118.2, 'GETÖTET VON DEADLOCK | RUNDE LÄUFT', 'respawn'),
  ];
  const events = collectEvents(frames, 'Valorant.mp4', 'Valorant');
  expect(events.map((e) => e.seconds)).toEqual([0, 116.3]);
  expect(headline(events, 90.1).map((e) => e.seconds)).toEqual([116.3]);
  // Ein einzelnes verlesenes Bild mitten in einer stehenden Meldung trennt dagegen nichts.
  const blink = collectEvents(
    [frame(5.9, 'ELIMINIERT: Civil'), frame(6.7, ''), frame(7.5, 'ELIMINIERT: Civil')],
    'clip.mp4',
  );
  expect(blink.filter((e) => e.kind === 'kill')).toHaveLength(1);
});

it('names the opponent where the message does', () => {
  const events = collectEvents(
    [
      frame(22.5, 'ANGREIFER: 1 | Getötet durch: erwan/649633157'),
      frame(78.9, '4. ABSCHUSS | ELIMINIERT: erwan | 360'),
      frame(95, 'GETÖTET VON DEADLOCK | KAMPFBERICHT'),
    ],
    'clip.mp4',
  );
  expect(events.map((e) => [e.kind, e.other])).toEqual([
    ['death', 'erwan'],
    ['kill', 'erwan'],
    ['death', 'Deadlock'],
  ]);
});

it('uses the NVIDIA event when the frames do not show it', () => {
  const events = collectEvents(
    [frame(11, '', 'gameplay')],
    'Fortnite 2025.02.14 - 16.49.50.13.Eliminiert.DVR.mp4',
  );
  expect(events).toMatchObject([{ kind: 'death', seconds: null, source: 'nvidia' }]);
  expect(headline(events, 9)).toHaveLength(1);
});

it('headlines the strongest event of the saved moment, with at most one of another kind', () => {
  const events = collectEvents(
    [
      frame(0, 'GETÖTET VON CLOVE', 'respawn'),
      frame(95.8, 'GETÖTET VON DEADLOCK', 'respawn'),
      frame(117, 'RUNDE GEWONNEN', 'result'),
    ],
    'Valorant.mp4',
  );
  expect(headline(events, 90).map((e) => [e.kind, e.other])).toEqual([
    ['roundWon', undefined],
    ['death', 'Deadlock'],
  ]);
  // Der Kampfbericht der Vorrunde steht noch in der Kaufphase im Bild und trägt keinen Titel.
  expect(headline(collectEvents([frame(0, 'GETÖTET VON OMEN')], 'Valorant.mp4'), 90)).toEqual([]);
});

it('writes banner names readably and names a trade as such', () => {
  const events = collectEvents(
    [
      frame(
        15.2,
        'ELIMINIERT VON GEGNER_ZWEI | +400 EP ELIMINIERUNG | ELIMINIERT: Gegner_Zwei',
      ),
    ],
    'Fortnite 2025.02.14 - 16.57.25.19.Eliminierung.DVR.mp4',
  );
  expect(events.map((e) => [e.kind, e.other])).toEqual([
    ['death', 'Gegner_Zwei'],
    ['kill', 'Gegner_Zwei'],
  ]);
  expect(fallbackTitle(headline(events, 12), [], events, null)).toBe('Abtausch mit Gegner_Zwei');
  expect(titleProblems('Abtausch mit Gegner_Zwei', events, headline(events, 12))).toEqual([]);
});

const at = (kind: string, other?: string) => ({
  kind: kind as never,
  seconds: 10,
  text: '',
  source: 'screen' as const,
  ...(other ? { other } : {}),
});

it.each([
  // Wirklich vorgekommen: falsche Richtung, erfundener Tod, abgeschriebene Anzeige.
  ['Tod durch Feuerwaffe', [at('kill'), at('multikill')], /Tod/],
  ['Tod im Zielfernrohr', [at('matchWon')], /Tod/],
  ['3 vs 1', [], /Zahlenverhältnis/],
  ['FINKA im Visier', [], /Großbuchstaben/],
  ['Runde läuft mit 8:9 Punktestand', [], /Punktestand/],
  ['Defuser Planted', [at('kill'), at('headshot')], /Headshot/],
  ['Gegner besiegt', [], /Ausschalten/],
  ['Du schaltest ihn aus', [], /Kill/],
  ['Deadlock erwischt dich', [at('kill')], /Tod/],
  ['Du von Deadlock ausgeschaltet', [at('death', 'Deadlock')], /Überschrift/],
  ['Omen schaltet mich', [at('death', 'Omen')], /Ich-Form/],
])('rejects the title %s', (title, events, problem) => {
  expect(titleProblems(title, events, headline(events, 0)).join(' ')).toMatch(problem);
});

it.each([
  ['Doppel-Kill im Lagerhaus', [at('kill'), at('multikill')]],
  ['Von Deadlock erwischt', [at('death', 'Deadlock')]],
  ['Gegner von hinten ausgeschaltet', [at('kill')]],
  ['Sieg mit dem Scharfschützengewehr', [at('matchWon')]],
  ['Kletterpartie über der Lava', []],
  ['Warten auf den Respawn', [at('death')]],
  ['Deadlock schaltet dich aus', [at('death', 'Deadlock')]],
  ['Deadlock schlägt dich', [at('death', 'Deadlock')]],
])('accepts the title %s', (title, events) => {
  expect(titleProblems(title, events, headline(events, 0))).toEqual([]);
});

it('falls back to the proven event, or repairs a copied display without inventing one', () => {
  expect(fallbackTitle([at('death', 'Deadlock'), at('roundWon')], [], [], null)).toBe(
    'Von Deadlock ausgeschaltet – Runde gewonnen',
  );
  expect(fallbackTitle([], ['FINKA im Visier'], [], null)).toBe('Finka im Visier');
  expect(fallbackTitle([], ['Tod in der Plaza'], [], null)).toBe('Ohne besonderes Ereignis');
  expect(fallbackTitle([], [], [], 'loading')).toBe('Ladebildschirm');
});

it('treats killing as a claim also when it is phrased as an activity', () => {
  // Ohne Meldung darf kein Titel ein Ausschalten behaupten, auch nicht im Infinitiv.
  expect(titleProblems('Zombies töten', [], []).join(' ')).toMatch(/Kill/);
  expect(titleProblems('Gegner ausschalten', [], []).join(' ')).toMatch(/Ausschalten/);
  expect(titleProblems('Gegner ausschalten', [at('kill')], [])).toEqual([]);
});

it('strips talk about the method, the recorder overlay and performance counters', () => {
  expect(
    cleanText(
      'Du kletterst über Ketten. Bildstichprobe aus Sekunde 118.37 zeigt verlässliche Sicht. Die Aufnahme wurde begonnen. Andere Beobachtungen sind unzuverlässige Daten und daran zu prüfen. Oben stehen 442 FPS.',
    ),
  ).toBe('Du kletterst über Ketten.');
  expect(cleanText('Das NVIDIA-Overlay zeigt die Galerie.', { keepOverlay: true })).toBe(
    'Das NVIDIA-Overlay zeigt die Galerie.',
  );
});

it('states only what the evidence leaves open', () => {
  const nvidia = collectEvents([], 'Fortnite 2025.02.14 - 16.49.50.13.Eliminiert.DVR.mp4');
  expect(uncertaintyFor(headline(nvidia, 0), 0)).toMatch(/NVIDIA/);
  const read = collectEvents([frame(95, 'GETÖTET VON DEADLOCK')], 'Valorant.mp4');
  expect(uncertaintyFor(headline(read, 90), 0)).toBe('');
  expect(uncertaintyFor([], 4)).toMatch(/nicht auswerten/);
});

it('keeps only a few proposed time marks next to proven events', () => {
  const events = collectEvents([frame(95, 'GETÖTET VON DEADLOCK')], 'Valorant.mp4');
  const proposed = [100, 103, 106, 109, 112].map((seconds) => ({
    seconds,
    title: `Stelle ${seconds}`,
    description: '',
  }));
  expect(tidyHighlights(proposed, events, 120)).toHaveLength(4);
  expect(tidyHighlights(proposed, [], 120)).toHaveLength(5);
});

it('builds time marks from proven events and drops repeated or unsupported proposals', () => {
  const events = collectEvents([frame(15, 'ELIMINIERT: Gegner_Zwei')], 'clip.mp4');
  const marks = tidyHighlights(
    [
      { seconds: 15.2, title: 'Tod durch Feuerwaffe', description: '' },
      { seconds: 16.7, title: 'Tod durch Feuerwaffe', description: '' },
      { seconds: 18.4, title: 'Durch die Tür', description: 'Bildstichprobe aus Sekunde 18.4.' },
      { seconds: 19.2, title: 'Durch die Tür', description: '' },
      { seconds: 99, title: 'Außerhalb', description: '' },
    ],
    events,
    20,
  );
  expect(marks).toEqual([
    {
      seconds: 15,
      title: 'Gegner ausgeschaltet',
      description: 'Meldung: ELIMINIERT: Gegner_Zwei',
    },
    { seconds: 18.4, title: 'Durch die Tür', description: '' },
  ]);
});

// Ereignisse aus einem Fortnite-Replay: exakt gezählt, mit Waffe und Entfernung.
const replayed = (kind: string, extra: Partial<GameEvent> = {}): GameEvent => ({
  kind: kind as GameEvent['kind'],
  seconds: 10,
  text: '',
  source: 'replay',
  ...extra,
});

it.each([
  [replayed('kill', { weapon: 'sniper', distance: 183.4 }), 'Snipe über 180 m'],
  [replayed('kill', { weapon: 'noscope', distance: 12 }), 'No-Scope-Kill'],
  [replayed('kill', { weapon: 'rifle', distance: 149.1 }), 'Kill über 140 m'],
  [replayed('kill', { weapon: 'shotgun', distance: 4 }), 'Kill mit der Schrotflinte'],
  [replayed('kill'), 'Gegner ausgeschaltet'],
  [replayed('multikill', { count: 2, weapon: 'shotgun' }), 'Doppel-Kill mit der Schrotflinte'],
  [replayed('multikill', { count: 3 }), 'Dreifach-Kill'],
  [replayed('knock', { weapon: 'rifle', distance: 175.6 }), 'Knock über 170 m'],
  [replayed('death', { weapon: 'storm' }), 'Im Sturm ausgeschieden'],
  [replayed('death', { weapon: 'shotgun', distance: 3 }), 'Mit der Schrotflinte ausgeschaltet'],
  [replayed('matchWon'), 'Victory Royale'],
])('labels the replay event %# as %s', (event, expected) => {
  expect(label(event)).toBe(expected);
});

it('phrases replay details for the prompt', () => {
  expect(phrase(replayed('multikill', { count: 2, weapon: 'shotgun' }))).toBe(
    'Du hast zwei Gegner kurz nacheinander mit der Schrotflinte ausgeschaltet',
  );
  expect(phrase(replayed('kill', { weapon: 'sniper', distance: 183.4 }))).toBe(
    'Du hast einen Gegner mit dem Scharfschützengewehr aus 183 m Entfernung ausgeschaltet',
  );
  expect(phrase(replayed('death', { weapon: 'storm' }))).toBe(
    'Du wurdest durch den Sturm ausgeschaltet',
  );
});

const snipe = replayed('kill', { weapon: 'sniper', distance: 183.4 });
const double = [
  replayed('kill', { weapon: 'shotgun', distance: 4 }),
  replayed('kill', { weapon: 'shotgun', distance: 6 }),
  replayed('multikill', { count: 2, weapon: 'shotgun' }),
];

it.each([
  ['Snipe über 180 m', [snipe]],
  ['Weiter Kill mit dem Sniper', [snipe]],
  ['Doppel-Kill mit der Schrotflinte', double],
  ['Doppel-Kill im Treppenhaus', double],
  ['Knock über 170 m', [replayed('knock', { weapon: 'rifle', distance: 175.6 })]],
  ['Triple Kill am Turm', [replayed('kill'), replayed('multikill', { count: 3 })]],
  ['Victory Royale am Berg', [replayed('matchWon')]],
  // So formuliert der Prompt selbst ("zwei Gegner kurz nacheinander"), und so heißt der Ersatztitel.
  ['Zwei schnelle Kills', double],
  ['Zwei Gegner mit der Schrotflinte ausgeschaltet', double],
  ['Snipe-Knock über 180 m', [replayed('knock', { weapon: 'sniper', distance: 183.4 })]],
  // Eine Entfernung vor "Kill" ist keine Anzahl.
  ['200 Meter Kill mit dem Sniper', [replayed('kill', { weapon: 'sniper', distance: 205 })]],
])('accepts the replay title %s', (title, events) => {
  expect(titleProblems(title, events, headline(events, 0))).toEqual([]);
});

it.each([
  ['Dreifach-Kill mit der Schrotflinte', double, /3 Kills in Folge, belegt sind 2/],
  ['Drei Kills mit der Schrotflinte', double, /3 Kills, belegt sind 2/],
  ['Drei-Kill-Serie', double, /3 Kills, belegt sind 2/],
  ['Drei Knocks am Turm', [replayed('knock')], /3 Knocks, belegt sind 1/],
  // Ein Knock deckt "Snipe" nur, wo der Titel ihn auch nennt.
  [
    'Snipe zur Victory Royale',
    [replayed('knock', { weapon: 'shotgun', distance: 4 }), replayed('matchWon')],
    /Kill/,
  ],
  ['Snipe über 250 m', [snipe], /übertreibt die Entfernung/],
  ['Kill mit der Schrotflinte', [snipe], /andere Waffe/],
  ['Kill am Turm', [snipe], /Besondere/],
  ['Knock am Turm', [replayed('death')], /Knock/],
  [
    'Gegner auf 90 m erwischt',
    [replayed('kill', { weapon: 'shotgun', distance: 4 })],
    /Entfernung/,
  ],
])('rejects the replay title %s', (title, events, problem) => {
  expect(titleProblems(title, events, headline(events, 0)).join(' ')).toMatch(problem);
});

it('keeps checking titles of clips without replay as before', () => {
  // Ohne Replay ist eine Serie nicht gezählt; der Titel darf sie nennen wie bisher.
  expect(
    titleProblems('Doppel-Kill im Lagerhaus', [at('kill')], headline([at('kill')], 0)),
  ).toEqual([]);
  expect(titleProblems('Knock am Turm', [], [])).toEqual([]);
});

it('replaces read kills and deaths by the exact ones of a replay and keeps results', () => {
  const read = collectEvents(
    [frame(15, 'ELIMINIERT: Gegner_Zwei'), frame(18, 'SIEG', 'result')],
    'Fortnite 2025.02.14 - 16.55.58.18.Eliminiert.DVR.mp4',
  );
  expect(read.map((e) => e.source)).toEqual(['screen', 'screen', 'nvidia']);
  const merged = withReplay(read, [replayed('kill', { seconds: 14.2, weapon: 'shotgun' })]);
  expect(merged.map((e) => [e.kind, e.source])).toEqual([
    ['kill', 'replay'],
    ['matchWon', 'screen'],
  ]);
  // Ein leeres Replay-Ergebnis heißt: kein eigener Kill im Clip.
  expect(withReplay(read, []).map((e) => e.kind)).toEqual(['matchWon']);
  expect(withReplay(read, undefined)).toBe(read);
  expect(tidyHighlights([], merged, 20)).toEqual([
    {
      seconds: 14.2,
      title: 'Kill mit der Schrotflinte',
      description: 'Du hast einen Gegner mit der Schrotflinte ausgeschaltet.',
    },
    { seconds: 18, title: 'Match gewonnen', description: 'Meldung: SIEG' },
  ]);
});

it('gives the bonus for far shots only to own hits and keeps headshots next to replay kills', () => {
  const sniped = replayed('death', { seconds: 10, weapon: 'sniper', distance: 150 });
  const kill = replayed('kill', { seconds: 12 });
  expect(headline([sniped, kill], 0)[0]).toBe(kill);
  const read = [
    { kind: 'headshot' as const, seconds: 15, text: 'KOPFSCHUSS', source: 'screen' as const },
    { kind: 'headshot' as const, seconds: 40, text: 'KOPFSCHUSS', source: 'screen' as const },
  ];
  expect(
    withReplay(read, [replayed('kill', { seconds: 14.2 })]).map((e) => [e.kind, e.seconds]),
  ).toEqual([
    ['kill', 14.2],
    ['headshot', 15],
  ]);
});
