import { z } from 'zod';

/**
 * Your own player names. Anyone with a different name in each game enters one name per game; an
 * entry without a game applies everywhere. The analysis only gives the AI the names that match
 * the clip's game — a Fortnite name does not help in R6 and could mean a stranger there.
 */
export const MAX_PLAYER_NAMES = 20;
export const playerNameSchema = z.object({
  name: z.string().trim().min(1).max(60),
  game: z.string().trim().max(100).default(''),
});
export type PlayerName = z.infer<typeof playerNameSchema>;
export const playerNamesSchema = z.array(playerNameSchema).max(MAX_PLAYER_NAMES);

/**
 * Abbreviations that stand for an NVIDIA game folder. The client suggests the folder names;
 * anyone who still writes "R6" means "Tom Clancy's Rainbow Six Siege".
 */
const ALIASES: Record<string, string[]> = {
  r6: ['rainbow', 'six'],
  r6s: ['rainbow', 'six'],
  // Folder name of older NVIDIA recordings (2024).
  r6siege: ['rainbow', 'six', 'siege'],
  cod: ['call', 'of', 'duty'],
  cs: ['counter', 'strike'],
  cs2: ['counter', 'strike', '2'],
  csgo: ['counter', 'strike'],
  fn: ['fortnite'],
  val: ['valorant'],
  valo: ['valorant'],
};

/** Words of a game name, without accents, punctuation and trademark signs. */
function tokens(game: string) {
  return game
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .flatMap((word) => ALIASES[word] ?? [word]);
}

/** Whether `part` occurs as a contiguous word sequence in `whole`. */
function contains(whole: string[], part: string[]) {
  for (let start = 0; start + part.length <= whole.length; start++)
    if (part.every((word, i) => whole[start + i] === word)) return true;
  return false;
}

/**
 * Whether an entered game means the game of a clip. Whole words count, not letters: "Siege"
 * matches "Tom Clancy's Rainbow Six Siege", but "Rust" does not match "Trust".
 */
export function sameGame(entry: string, game: string) {
  const a = tokens(entry);
  const b = tokens(game);
  if (!a.length || !b.length) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  // A single short word like "2" or "of" does not describe a game.
  if (short.join('').length < 3 && short.join('') !== long.join('')) return false;
  return contains(long, short);
}

/**
 * The names you appear under in the clip's game: first those for this game, then those for all
 * games. Duplicates are dropped, ignoring case.
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
 * Cleans up a name list: invalid and empty entries are dropped, as are duplicate combinations
 * of name and game. Repeated spaces are collapsed.
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
 * Names from saved settings. Before this version there was only a "playerName" field; a name
 * entered there still applies to all games.
 */
export function savedPlayerNames(saved: { playerNames?: unknown; playerName?: unknown }) {
  if (Array.isArray(saved.playerNames)) return tidyPlayerNames(saved.playerNames);
  return typeof saved.playerName === 'string' ? tidyPlayerNames([{ name: saved.playerName }]) : [];
}
