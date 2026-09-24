import { z } from 'zod';

/**
 * Eigene Spielernamen. Wer in jedem Spiel anders heißt, trägt je Spiel einen Namen ein; ein
 * Eintrag ohne Spiel gilt überall. Die Analyse nennt der KI nur die Namen, die zum Spiel des
 * Clips passen — ein Fortnite-Name hilft in R6 nicht und könnte dort einen Fremden meinen.
 */
export const MAX_PLAYER_NAMES = 20;
export const playerNameSchema = z.object({
  name: z.string().trim().min(1).max(60),
  game: z.string().trim().max(100).default(''),
});
export type PlayerName = z.infer<typeof playerNameSchema>;
export const playerNamesSchema = z.array(playerNameSchema).max(MAX_PLAYER_NAMES);

/**
 * Kürzel, die für einen NVIDIA-Spielordner stehen. Der Client schlägt die Ordnernamen vor; wer
 * trotzdem "R6" schreibt, meint "Tom Clancy's Rainbow Six Siege".
 */
const ALIASES: Record<string, string[]> = {
  r6: ['rainbow', 'six'],
  r6s: ['rainbow', 'six'],
  cod: ['call', 'of', 'duty'],
  cs: ['counter', 'strike'],
  cs2: ['counter', 'strike', '2'],
  csgo: ['counter', 'strike'],
  fn: ['fortnite'],
  val: ['valorant'],
  valo: ['valorant'],
};

/** Wörter eines Spielnamens, ohne Akzente, Satzzeichen und Markenzeichen. */
function tokens(game: string) {
  return game
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .flatMap((word) => ALIASES[word] ?? [word]);
}

/** Ob `part` als zusammenhängende Wortfolge in `whole` vorkommt. */
function contains(whole: string[], part: string[]) {
  for (let start = 0; start + part.length <= whole.length; start++)
    if (part.every((word, i) => whole[start + i] === word)) return true;
  return false;
}

/**
 * Ob ein eingetragenes Spiel das Spiel eines Clips meint. Ganze Wörter zählen, nicht Buchstaben:
 * "Siege" passt zu "Tom Clancy's Rainbow Six Siege", "Rust" aber nicht zu "Trust".
 */
export function sameGame(entry: string, game: string) {
  const a = tokens(entry);
  const b = tokens(game);
  if (!a.length || !b.length) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  // Ein einzelnes kurzes Wort wie "2" oder "of" beschreibt kein Spiel.
  if (short.join('').length < 3 && short.join('') !== long.join('')) return false;
  return contains(long, short);
}

/**
 * Die Namen, unter denen du im Spiel des Clips auftrittst: zuerst die für dieses Spiel, dann
 * die für alle Spiele. Doppelte fallen weg, Groß- und Kleinschreibung zählt dabei nicht.
 */
export function namesFor(list: readonly PlayerName[], game: string): string[] {
  const specific = list.filter((p) => p.game.trim() && sameGame(p.game, game));
  const general = list.filter((p) => !p.game.trim());
  const seen = new Set<string>();
  const names: string[] = [];
  for (const entry of [...specific, ...general]) {
    const name = entry.name.replace(/\s+/g, ' ').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  return names;
}

/**
 * Bereinigt eine Namensliste: ungültige und leere Einträge fallen weg, ebenso doppelte
 * Kombinationen aus Name und Spiel. Mehrfache Leerzeichen werden zusammengezogen.
 */
export function tidyPlayerNames(input: readonly unknown[]): PlayerName[] {
  const seen = new Set<string>();
  const out: PlayerName[] = [];
  for (const raw of input) {
    const parsed = playerNameSchema.safeParse(raw);
    if (!parsed.success) continue;
    const entry = {
      name: parsed.data.name.replace(/\s+/g, ' '),
      game: parsed.data.game.replace(/\s+/g, ' '),
    };
    const key = `${entry.name.toLowerCase()}\u0000${tokens(entry.game).join(' ')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length === MAX_PLAYER_NAMES) break;
  }
  return out;
}

/**
 * Namen aus gespeicherten Einstellungen. Bis zu dieser Fassung gab es nur ein Feld
 * "playerName"; ein dort eingetragener Name gilt weiter für alle Spiele.
 */
export function savedPlayerNames(saved: { playerNames?: unknown; playerName?: unknown }) {
  if (Array.isArray(saved.playerNames)) return tidyPlayerNames(saved.playerNames);
  return typeof saved.playerName === 'string' ? tidyPlayerNames([{ name: saved.playerName }]) : [];
}
