/**
 * Game info from Steam, with IGDB as fallback: name, short description and cover for a game name.
 *
 * The Steam endpoints are public and need no key; IGDB needs its own Twitch application. Only the
 * game name is sent, never anything about the recording or the user.
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
 * NVIDIA names recordings without a detected game after its catch-all profiles. There is no game
 * to look up for those, and the search returns misleading hits for them.
 */
const NOT_GAMES = new Set(['desktop', 'base profile', 'nvidia share', 'game bar', 'steam']);

/**
 * Picks only an **exact** match from the search hits. Deliberately strict: for "Call of Duty
 * Black Ops 7" the search returns the unreleased "Black Ops III", and for "Minecraft" it returns
 * "Minecraft Dungeons". A wrong cover in the archive is worse than none.
 */
export function pickExact<T extends { appid: string | number; name: string }>(
  query: string,
  candidates: T[],
): T | undefined {
  const wanted = gameKey(query);
  return candidates.find((c) => gameKey(c.name) === wanted);
}

export type ContentLanguage = 'en' | 'de';
const STEAM_LANGUAGE: Record<ContentLanguage, string> = { en: 'english', de: 'german' };

async function json(url: string, signal?: AbortSignal, language: ContentLanguage = 'de') {
  const response = await fetch(url, {
    headers: { 'accept-language': language },
    signal: signal ?? AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Steam responded with HTTP ${response.status}.`);
  return response.json();
}

/**
 * Looks up a game and returns its info, or undefined if there is no exact match.
 * Steam first (no key needed); if Steam does not know the game, IGDB, when set up.
 */
export async function lookupGame(
  name: string,
  signal?: AbortSignal,
  igdb?: Igdb,
  /** Language of the Steam description; IGDB only has English. */
  language: ContentLanguage = 'de',
): Promise<GameInfo | undefined> {
  const key = gameKey(name);
  if (!key || NOT_GAMES.has(key)) return undefined;
  return (
    (await lookupSteam(name, key, signal, language)) ?? (await igdb?.lookup(name, key, signal))
  );
}

async function lookupSteam(
  name: string,
  key: string,
  signal?: AbortSignal,
  language: ContentLanguage = 'de',
): Promise<GameInfo | undefined> {
  const results = (await json(`${SEARCH}/${encodeURIComponent(name)}`, signal, language)) as {
    appid: string;
    name: string;
  }[];
  const hit = pickExact(name, Array.isArray(results) ? results : []);
  if (!hit) return undefined;
  const appId = Number(hit.appid);
  if (!Number.isSafeInteger(appId) || appId <= 0) return undefined;
  const details = (await json(
    `${DETAILS}?appids=${appId}&l=${STEAM_LANGUAGE[language]}`,
    signal,
    language,
  )) as Record<string, { success?: boolean; data?: Record<string, unknown> }>;
  // Steam redirects renamed games to a new ID and then answers under that one: a request for
  // 359550 (Rainbow Six Siege) returned an entry under 5290420 on 2026-09-24.
  const entries = Object.values(details ?? {});
  const entry = details?.[String(appId)] ?? (entries.length === 1 ? entries[0] : undefined);
  const data = entry?.success ? entry.data : undefined;
  if (!data) throw new Error('Steam is not returning game details right now.');
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
    // The library portrait image fits the tiles; header_image is the fallback.
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
 * IGDB (Twitch) as a second source for games that are not on Steam, such as Valorant or
 * Fortnite. Needs its own Twitch application (client ID and secret); the access token is fetched
 * via client credentials and reused until shortly before it expires. Free for non-commercial
 * use. Only the game name is sent.
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
    if (!response.ok) throw new Error(`Twitch rejected the IGDB login (HTTP ${response.status}).`);
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('Twitch returned no IGDB token.');
    // One minute of headroom so a token does not expire in the middle of a request.
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
    if (!response.ok) throw new Error(`IGDB responded with HTTP ${response.status}.`);
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
    // Entries with the same name exist: for "Fortnite" the main game and the Chinese version
    // (a port with a parent game, 2026-09-24). The main game without a parent wins, then the
    // better-known one; one without a cover only if none has one.
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
      // Portrait like the library tiles; the smaller size is the fallback.
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
