/**
 * Spielinfos von Steam, ersatzweise IGDB: Name, Kurzbeschreibung und Titelbild zu einem Spielnamen.
 *
 * Die Steam-Endpunkte sind öffentlich und brauchen keinen Schlüssel, IGDB eine eigene
 * Twitch-Anwendung. Abgefragt wird nur der Spielname, nie etwas über die Aufnahme oder den Nutzer.
 */
import { gameKey } from '../src/domain/gameKey';
export { gameKey } from '../src/domain/gameKey';

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
  fallbackCoverUrl: string;
  source: string;
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

/**
 * Sucht ein Spiel und liefert seine Infos, oder undefined, wenn es keinen exakten Treffer gibt.
 * Zuerst Steam (ohne Schlüssel); kennt Steam das Spiel nicht, IGDB, sofern eingerichtet.
 */
export async function lookupGame(
  name: string,
  signal?: AbortSignal,
  igdb?: Igdb,
): Promise<GameInfo | undefined> {
  const key = gameKey(name);
  if (!key || NOT_GAMES.has(key)) return undefined;
  return (await lookupSteam(name, key, signal)) ?? (await igdb?.lookup(name, key, signal));
}

async function lookupSteam(
  name: string,
  key: string,
  signal?: AbortSignal,
): Promise<GameInfo | undefined> {
  const results = (await json(`${SEARCH}/${encodeURIComponent(name)}`, signal)) as {
    appid: string;
    name: string;
  }[];
  const hit = pickExact(name, Array.isArray(results) ? results : []);
  if (!hit) return undefined;
  const appId = Number(hit.appid);
  if (!Number.isSafeInteger(appId) || appId <= 0) return undefined;
  const details = (await json(`${DETAILS}?appids=${appId}&l=german`, signal)) as Record<
    string,
    { success?: boolean; data?: Record<string, unknown> }
  >;
  // Steam leitet umbenannte Spiele auf eine neue ID um und antwortet dann unter dieser: nach
  // 359550 (Rainbow Six Siege) kam am 2026-09-24 ein Eintrag unter 5290420 zurück.
  const entries = Object.values(details ?? {});
  const entry = details?.[String(appId)] ?? (entries.length === 1 ? entries[0] : undefined);
  const data = entry?.success ? entry.data : undefined;
  if (!data) throw new Error('Steam liefert gerade keine Spieldetails.');
  if (data.type && data.type !== 'game') return undefined;
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
    fallbackCoverUrl: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    source: `https://store.steampowered.com/app/${appId}/`,
  };
}

export interface IgdbCredentials {
  clientId: string;
  clientSecret: string;
}

const TWITCH_TOKEN = 'https://id.twitch.tv/oauth2/token';
const IGDB_GAMES = 'https://api.igdb.com/v4/games';

/**
 * IGDB (Twitch) als zweite Quelle für Spiele, die es auf Steam nicht gibt, etwa Valorant oder
 * Fortnite. Braucht eine eigene Twitch-Anwendung (Client-ID und Secret); das Zugriffstoken wird
 * per Client-Credentials geholt und bis kurz vor Ablauf wiederverwendet. Kostenlos für
 * nicht-kommerzielle Nutzung. Abgefragt wird nur der Spielname.
 */
export class Igdb {
  private token?: { value: string; until: number };
  constructor(
    private readonly credentials: IgdbCredentials,
    private readonly get: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async bearer(signal?: AbortSignal) {
    if (this.token && this.token.until > Date.now()) return this.token.value;
    const { clientId, clientSecret } = this.credentials;
    const response = await this.get(
      `${TWITCH_TOKEN}?${new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      })}`,
      { method: 'POST', signal: signal ?? AbortSignal.timeout(15000) },
    );
    if (!response.ok)
      throw new Error(`Twitch lehnt die IGDB-Anmeldung ab (HTTP ${response.status}).`);
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('Twitch liefert kein IGDB-Token.');
    // Eine Minute Puffer, damit ein Token nicht mitten in einer Anfrage abläuft.
    this.token = {
      value: body.access_token,
      until: Date.now() + Math.max(0, (body.expires_in ?? 0) - 60) * 1000,
    };
    return this.token.value;
  }

  async lookup(name: string, key: string, signal?: AbortSignal): Promise<GameInfo | undefined> {
    const token = await this.bearer(signal);
    const query = `search "${name.replace(/["\\]/g, ' ')}"; fields name,summary,first_release_date,genres.name,cover.image_id,url,game_type,parent_game,total_rating_count; limit 20;`;
    const response = await this.get(IGDB_GAMES, {
      method: 'POST',
      headers: {
        'Client-ID': this.credentials.clientId,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain',
      },
      body: query,
      signal: signal ?? AbortSignal.timeout(15000),
    });
    if (response.status === 401) this.token = undefined;
    if (!response.ok) throw new Error(`IGDB antwortet mit HTTP ${response.status}.`);
    const results = (await response.json()) as {
      id: number;
      name: string;
      summary?: string;
      first_release_date?: number;
      genres?: { name: string }[];
      cover?: { image_id?: string };
      url?: string;
      game_type?: number;
      parent_game?: number;
      total_rating_count?: number;
    }[];
    const exact = Array.isArray(results)
      ? results.filter((r) => r.name && gameKey(r.name) === key)
      : [];
    // Gleichnamige Einträge gibt es: zu "Fortnite" das Hauptspiel und die chinesische Fassung
    // (Portierung mit Elternspiel, 2026-09-24). Das Hauptspiel ohne Elternspiel gewinnt, dann das
    // bekanntere; ohne Cover nur, wenn keiner eins hat.
    const rank = (r: (typeof exact)[number]) =>
      Number(r.game_type === 0 && !r.parent_game) * 1e9 +
      Number(Boolean(r.cover?.image_id)) * 1e8 +
      (r.total_rating_count ?? 0);
    const hit = [...exact].sort((a, b) => rank(b) - rank(a))[0];
    if (!hit || !Number.isSafeInteger(hit.id)) return undefined;
    const image =
      hit.cover?.image_id && /^[a-z0-9]+$/i.test(hit.cover.image_id) ? hit.cover.image_id : '';
    return {
      key,
      name: hit.name,
      appId: hit.id,
      description: String(hit.summary || '').slice(0, 600),
      genre: (hit.genres ?? [])
        .map((g) => g.name)
        .slice(0, 3)
        .join(', '),
      released: hit.first_release_date
        ? new Intl.DateTimeFormat('de-DE', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: 'UTC',
          }).format(new Date(hit.first_release_date * 1000))
        : '',
      // Hochformat wie die Bibliothekskacheln; das kleinere Format ist der Rückfall.
      coverUrl: image
        ? `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${image}.jpg`
        : '',
      fallbackCoverUrl: image
        ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${image}.jpg`
        : '',
      source: hit.url?.startsWith('https://www.igdb.com/') ? hit.url : 'https://www.igdb.com/',
    };
  }
}
