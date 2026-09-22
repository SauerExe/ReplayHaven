/**
 * Spielinfos von Steam: Name, Kurzbeschreibung und Titelbild zu einem Spielnamen.
 *
 * Beide Endpunkte sind öffentlich und brauchen keinen Schlüssel. Abgefragt wird nur der
 * Spielname, nie etwas über die Aufnahme oder den Nutzer.
 */
const SEARCH = 'https://steamcommunity.com/actions/SearchApps';
const DETAILS = 'https://store.steampowered.com/api/appdetails';

export interface GameInfo {
  key: string;
  name: string;
  appId: number;
  description: string;
  genre: string;
  released: string;
  coverUrl: string;
  source: string;
}

/**
 * Vergleichsform eines Spielnamens: Kleinschreibung, ohne Satzzeichen und Marken­zeichen,
 * Mehrfachleerzeichen zusammengezogen. "Tom Clancy's Rainbow Six  Siege" und
 * "Tom Clancy’s Rainbow Six Siege" werden damit gleich.
 */
export function gameKey(name: string) {
  return (
    name
      .toLocaleLowerCase('de')
      .replace(/[®™©]/g, '')
      // "+" bleibt bedeutungstragend: sonst wird aus dem SteamVR-Werkzeug "Desktop+" ein
      // "desktop" und passt exakt auf NVIDIAs Auffangprofil (gemessen 2026-09-22).
      .replace(/[^\p{L}\p{N}+]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ')
  );
}

/**
 * NVIDIA benennt Aufnahmen ohne erkanntes Spiel nach seinen Auffangprofilen. Für die gibt es
 * kein Spiel nachzuschlagen, und die Suche liefert dazu irreführende Treffer.
 */
const NOT_GAMES = new Set(['desktop', 'base profile', 'nvidia share', 'game bar', 'steam']);

/**
 * Wählt aus den Suchtreffern nur einen **exakt** passenden aus. Bewusst streng: die Suche
 * liefert zu "Call of Duty Black Ops 7" das nie erschienene "Black Ops III" und zu "Minecraft"
 * das "Minecraft Dungeons". Ein falsches Cover im Archiv ist schlimmer als gar keines.
 */
export function pickExact<T extends { appid: string | number; name: string }>(
  query: string,
  candidates: T[],
): T | undefined {
  const wanted = gameKey(query);
  return candidates.find((c) => gameKey(c.name) === wanted);
}

async function json(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    headers: { 'accept-language': 'de' },
    signal: signal ?? AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Steam antwortet mit HTTP ${response.status}.`);
  return response.json();
}

/** Sucht ein Spiel und liefert seine Infos, oder undefined, wenn es keinen exakten Treffer gibt. */
export async function lookupGame(
  name: string,
  signal?: AbortSignal,
): Promise<GameInfo | undefined> {
  const key = gameKey(name);
  if (!key || NOT_GAMES.has(key)) return undefined;
  const results = (await json(`${SEARCH}/${encodeURIComponent(name)}`, signal)) as {
    appid: string;
    name: string;
  }[];
  const hit = pickExact(name, Array.isArray(results) ? results : []);
  if (!hit) return undefined;
  const appId = Number(hit.appid);
  const details = (await json(`${DETAILS}?appids=${appId}&l=german`, signal)) as Record<
    string,
    { success?: boolean; data?: Record<string, unknown> }
  >;
  const data = details[String(appId)]?.success ? details[String(appId)].data : undefined;
  if (!data) return undefined;
  const genres = (data.genres as { description: string }[] | undefined) || [];
  return {
    key,
    name: String(data.name || hit.name),
    appId,
    description: String(data.short_description || '').slice(0, 600),
    genre: genres
      .map((g) => g.description)
      .slice(0, 3)
      .join(', '),
    released: String((data.release_date as { date?: string } | undefined)?.date || ''),
    // Das Hochformat der Bibliothek passt zu den Kacheln; header_image ist der Rückfall.
    coverUrl: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900_2x.jpg`,
    source: `https://store.steampowered.com/app/${appId}/`,
  };
}
