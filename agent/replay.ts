import { createDecipheriv } from 'node:crypto';
import { open } from 'node:fs/promises';

/**
 * Liest Fortnite-Replays (.replay) so weit, wie es für Clip-Titel nötig ist: Dateikopf,
 * Zeitstempel und die Ereignis-Chunks mit Eliminierungen und Match-Statistik.
 *
 * Den Netzwerkstrom mit Positionen, Namen und Waffenwechseln liest er bewusst nicht: dessen
 * Aufbau ändert sich mit jeder Saison, und er ist mit Oodle komprimiert. Die Ereignis-Chunks
 * sind dagegen seit Jahren gleich gebaut und nur mit dem Schlüssel aus dem Dateikopf
 * verschlüsselt (AES-256-ECB). Aufbau nach der Unreal Engine (LocalFileNetworkReplayStreaming)
 * und den quelloffenen Lesern xNocken/replay-reader und Shiqan/FortniteReplayDecompressor.
 * Geprüft an sechs echten Replays von Saison 11 (2019) bis Kapitel 5 Saison 5 (2024): jede
 * Eliminierung ließ sich bis zum letzten Byte lesen.
 */

const FILE_MAGIC = 0x1ca2e27f;
const HEADER_MAGIC = 0x2cf5a13d;
/** .NET-Ticks (100 ns seit 0001-01-01) am 1970-01-01. */
const EPOCH_TICKS = 621355968000000000n;
/** Ab dieser Netzwerkversion schreibt die Unreal Engine 5 Vektoren als double (Large World Coordinates). */
const LWC_ENGINE_NETWORK_VERSION = 23;
/** Obergrenzen gegen beschädigte Dateien: kein Ereignis und kein Kopf ist auch nur annähernd so groß. */
const MAX_EVENT_BYTES = 1 << 20;
const MAX_STRING_BYTES = 1 << 16;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Beteiligter einer Eliminierung. Spieler tragen ihre Epic-Konto-ID (32 Hex-Zeichen). */
export type ReplayPlayer =
  { kind: 'player'; id: string } | { kind: 'bot'; id: string } | { kind: 'name'; id: string };

export interface Elimination {
  /** Millisekunden seit Beginn der Aufzeichnung. */
  time: number;
  victim: ReplayPlayer;
  killer: ReplayPlayer;
  /** Todesursache laut Spiel (EDeathCause): Waffenart, Sturm, Fallschaden, Ausbluten … */
  cause: number;
  /** Niedergeschlagen statt ausgeschieden. */
  knocked: boolean;
  /** Ort des Opfers in Zentimetern; fehlt, wenn das Replay ihn nicht kennt. */
  victimAt?: Vec3;
  /** Ort des Verursachers; fehlt, wenn er zu weit weg war, um im Replay aufzutauchen. */
  killerAt?: Vec3;
}

/** Statistik des aufnehmenden Spielers, geschrieben, wenn sein Match endet. */
export interface MatchStats {
  time: number;
  accuracy: number;
  assists: number;
  eliminations: number;
  weaponDamage: number;
  otherDamage: number;
  revives: number;
  damageTaken: number;
}

export interface TeamStats {
  time: number;
  placement: number;
  totalPlayers: number;
}

export interface Replay {
  fileVersion: number;
  lengthMs: number;
  /** Die Aufzeichnung läuft noch; Ereignisse und Schlüssel fehlen dann womöglich. */
  live: boolean;
  encrypted: boolean;
  /**
   * Beginn der Aufzeichnung in Ortszeit des Spiel-PCs, ohne Zeitzone: Millisekunden, als wäre
   * die Ortszeit UTC. Das Spiel schreibt hier FDateTime::Now().
   */
  localStart?: number;
  /** Beginn der Aufzeichnung in UTC (Timecode-Ereignis, seit Kapitel 5), Millisekunden seit 1970. */
  utcStart?: number;
  engineNetworkVersion?: number;
  /** Spielversion aus dem Branch, etwa "32.00" aus "++Fortnite+Release-32.00". */
  gameVersion?: string;
  eliminations: Elimination[];
  stats?: MatchStats;
  team?: TeamStats;
  /** Ereignisse, die sich nicht lesen ließen. */
  unreadable: number;
}

export class ReplayError extends Error {}

/** Lesezeiger über einem Puffer, der bei jedem Überlauf einen ReplayError wirft. */
class Cursor {
  offset = 0;
  constructor(readonly data: Buffer) {}
  private take(bytes: number) {
    if (bytes < 0 || this.offset + bytes > this.data.length)
      throw new ReplayError('Replay endet unerwartet.');
    const at = this.offset;
    this.offset += bytes;
    return at;
  }
  get remaining() {
    return this.data.length - this.offset;
  }
  skip(bytes: number) {
    this.take(bytes);
  }
  u8() {
    return this.data.readUInt8(this.take(1));
  }
  u16() {
    return this.data.readUInt16LE(this.take(2));
  }
  u32() {
    return this.data.readUInt32LE(this.take(4));
  }
  i32() {
    return this.data.readInt32LE(this.take(4));
  }
  i64() {
    return this.data.readBigInt64LE(this.take(8));
  }
  f32() {
    return this.data.readFloatLE(this.take(4));
  }
  f64() {
    return this.data.readDoubleLE(this.take(8));
  }
  bytes(length: number) {
    const at = this.take(length);
    return this.data.subarray(at, at + length);
  }
  /** FString: Länge mit Nullzeichen; negativ bedeutet UTF-16. */
  string() {
    const length = this.i32();
    if (length === 0) return '';
    const bytes = length < 0 ? -length * 2 : length;
    if (bytes > MAX_STRING_BYTES) throw new ReplayError('Zeichenkette im Replay ist zu lang.');
    const raw = this.bytes(bytes);
    return (length < 0 ? raw.toString('utf16le') : raw.toString('latin1')).replace(/\0+$/, '');
  }
}

/** Millisekunden seit 1970 aus .NET-Ticks; undefined außerhalb plausibler Jahre. */
function ticksToMs(ticks: bigint) {
  const ms = Number((ticks - EPOCH_TICKS) / 10000n);
  return ms > Date.UTC(2017, 0, 1) && ms < Date.UTC(2100, 0, 1) ? ms : undefined;
}

interface Info {
  fileVersion: number;
  lengthMs: number;
  live: boolean;
  encrypted: boolean;
  key?: Buffer;
  localStart?: number;
  /** Wo die Chunks beginnen. */
  end: number;
}

function readInfo(data: Buffer): Info {
  const c = new Cursor(data);
  if (c.u32() !== FILE_MAGIC) throw new ReplayError('Keine Fortnite-Replay-Datei.');
  const fileVersion = c.u32();
  // Ab Version 7 folgen benutzerdefinierte Versionen: je 16 Byte GUID und 4 Byte Nummer.
  if (fileVersion >= 7) c.skip(Math.max(0, c.i32()) * 20);
  const lengthMs = c.u32();
  c.u32(); // Netzwerkversion
  c.u32(); // Changelist
  c.string(); // Anzeigename, meist "Unsaved Replay"
  const live = c.u32() !== 0;
  const localStart = fileVersion >= 3 ? ticksToMs(c.i64()) : undefined;
  if (fileVersion >= 2) c.u32(); // komprimiert
  let encrypted = false;
  let key: Buffer | undefined;
  if (fileVersion >= 6) {
    encrypted = c.u32() !== 0;
    const length = c.u32();
    if (length > 64) throw new ReplayError('Schlüssel im Replay hat eine unbekannte Länge.');
    key = Buffer.from(c.bytes(length));
  }
  return { fileVersion, lengthMs, live, encrypted, key, localStart, end: c.offset };
}

interface Header {
  engineNetworkVersion: number;
  gameVersion?: string;
}

function readHeader(data: Buffer): Header {
  const c = new Cursor(data);
  if (c.u32() !== HEADER_MAGIC) throw new ReplayError('Replay-Kopf ist beschädigt.');
  const networkVersion = c.u32();
  if (networkVersion >= 19) c.skip(Math.max(0, c.i32()) * 20);
  c.u32(); // Prüfsumme
  const engineNetworkVersion = c.u32();
  c.u32(); // Protokollversion des Spiels
  if (networkVersion >= 12) c.skip(16); // GUID
  let gameVersion: string | undefined;
  if (networkVersion >= 11) {
    c.skip(4 + 2 + 4); // Hauptversion, Patch, Changelist
    gameVersion = /Release-(\d+\.\d+)/.exec(c.string())?.[1];
  }
  return { engineNetworkVersion, gameVersion };
}

/** Eine Transformation: Drehung (Quaternion), Ort, Skalierung — als float oder double. */
function readTransform(number: () => number) {
  const rotation = [number(), number(), number(), number()];
  const at = { x: number(), y: number(), z: number() };
  const scale = [number(), number(), number()];
  return { rotation, at, scale };
}

/**
 * Plausibel ist eine Transformation, wenn ihre Zahlen endlich und klein genug sind. Ein mit der
 * falschen Zahlenbreite gelesener Block liefert Werte wie 1e+38 oder NaN und fällt hier heraus.
 */
function plausible(t: ReturnType<typeof readTransform>) {
  return [...t.rotation, t.at.x, t.at.y, t.at.z, ...t.scale].every(
    (v) => Number.isFinite(v) && Math.abs(v) < 1e8,
  );
}

function readPlayer(c: Cursor, typed: boolean): ReplayPlayer {
  if (!typed) return { kind: 'name', id: c.string() };
  const type = c.u8();
  if (type === 0x03) return { kind: 'bot', id: '' };
  if (type === 0x10) return { kind: 'name', id: c.string() };
  if (type === 0x11) {
    const length = c.u8();
    if (length < 1 || length > 64) throw new ReplayError('Spieler-ID mit unbekannter Länge.');
    return { kind: 'player', id: c.bytes(length).toString('hex') };
  }
  throw new ReplayError(`Unbekannte Spielerart ${type}.`);
}

/**
 * Liest eine Eliminierung. Vorne steht eine Versionsnummer, dann ein unbekanntes Byte und je eine
 * Transformation für Opfer (ab Version 6) und Verursacher, dann beide Beteiligten, die
 * Todesursache und ob das Opfer nur niedergeschlagen wurde.
 *
 * Die Zahlenbreite der Transformationen hängt an der Engine-Version, und einer der quelloffenen
 * Leser überspringt für neuere Versionen einen weiteren Block. Deshalb werden die bekannten
 * Aufbauten der Reihe nach versucht; gilt nur, was genau am Ende des Ereignisses aufgeht.
 */
export function readElimination(data: Buffer, time: number, engineNetworkVersion: number) {
  const version = data.length >= 4 ? data.readInt32LE(0) : -1;
  if (version < 3 || version > 100)
    throw new ReplayError(`Eliminierung in unbekannter Fassung ${version}.`);
  const lwc = engineNetworkVersion >= LWC_ENGINE_NETWORK_VERSION;
  const transforms = version >= 6 ? 2 : 1;
  const layouts = [
    { wide: lwc, extra: 0 },
    { wide: !lwc, extra: 0 },
    { wide: lwc, extra: 1 },
    { wide: !lwc, extra: 1 },
  ];
  let failure: unknown;
  for (const layout of layouts) {
    try {
      const c = new Cursor(data);
      c.skip(4 + 1);
      const number = layout.wide ? () => c.f64() : () => c.f32();
      const read = Array.from({ length: transforms + layout.extra }, () => readTransform(number));
      if (!read.every(plausible)) throw new ReplayError('Unplausible Transformation.');
      const victim = readPlayer(c, version >= 6);
      const killer = readPlayer(c, version >= 6);
      const cause = c.u8();
      const knocked = c.u32();
      if (knocked > 1 || c.remaining !== 0) throw new ReplayError('Eliminierung geht nicht auf.');
      // Ein Ort (0, 0, 0) heißt: unbekannt, nicht Kartenmitte.
      const place = (t?: (typeof read)[number]) =>
        t && (t.at.x || t.at.y || t.at.z) ? t.at : undefined;
      const victimAt = transforms === 2 ? place(read[0]) : undefined;
      const killerAt = place(read[transforms - 1]);
      return {
        time,
        victim,
        killer,
        cause,
        knocked: knocked === 1,
        ...(victimAt ? { victimAt } : {}),
        ...(killerAt ? { killerAt } : {}),
      } satisfies Elimination;
    } catch (error) {
      failure = error;
    }
  }
  throw failure instanceof ReplayError ? failure : new ReplayError('Eliminierung unlesbar.');
}

function decrypt(data: Buffer, key: Buffer | undefined) {
  if (!key) return data;
  const decipher = createDecipheriv('aes-256-ecb', key, null);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/** Zugriff auf die Datei: ganz im Speicher (Tests) oder stückweise von der Platte. */
interface Source {
  size: number;
  read(offset: number, length: number): Promise<Buffer>;
}

async function parse(source: Source): Promise<Replay> {
  // Der Anzeigename ist auf 256 Zeichen aufgefüllt; 4 KiB fassen den Vorspann sicher.
  const info = readInfo(await source.read(0, Math.min(source.size, 4096)));
  const replay: Replay = {
    fileVersion: info.fileVersion,
    lengthMs: info.lengthMs,
    live: info.live,
    encrypted: info.encrypted,
    ...(info.localStart !== undefined ? { localStart: info.localStart } : {}),
    eliminations: [],
    unreadable: 0,
  };
  // Während der Aufnahme fehlen Schlüssel und Ereignisse noch; gelesen wird erst danach.
  if (info.live) return replay;
  const key = info.encrypted ? info.key : undefined;
  if (info.encrypted && key?.length !== 32)
    throw new ReplayError('Replay ist verschlüsselt, der Schlüssel fehlt.');
  let header: Header | undefined;
  const pending: { time: number; group: string; meta: string; data: Buffer }[] = [];
  let offset = info.end;
  while (offset + 8 <= source.size) {
    const head = await source.read(offset, 8);
    const type = head.readUInt32LE(0);
    const size = head.readInt32LE(4);
    const start = offset + 8;
    if (size < 0 || start + size > source.size) break; // abgeschnittene Datei
    if (type === 0 && size <= MAX_EVENT_BYTES) header = readHeader(await source.read(start, size));
    if (type === 3 && size <= MAX_EVENT_BYTES) {
      const c = new Cursor(await source.read(start, size));
      c.string(); // ID
      const group = c.string();
      const meta = c.string();
      const time = c.u32();
      c.u32(); // Ende
      const length = c.i32();
      if (length >= 0 && length <= c.remaining)
        pending.push({ time, group, meta, data: Buffer.from(c.bytes(length)) });
      else replay.unreadable++;
    }
    offset = start + size;
  }
  replay.engineNetworkVersion = header?.engineNetworkVersion;
  if (header?.gameVersion) replay.gameVersion = header.gameVersion;
  for (const event of pending) {
    try {
      const data = decrypt(event.data, key);
      if (event.group === 'playerElim')
        replay.eliminations.push(
          readElimination(data, event.time, header?.engineNetworkVersion ?? 0),
        );
      else if (event.meta === 'AthenaMatchStats') {
        const c = new Cursor(data);
        c.u32();
        replay.stats = {
          time: event.time,
          accuracy: c.f32(),
          assists: c.u32(),
          eliminations: c.u32(),
          weaponDamage: c.u32(),
          otherDamage: c.u32(),
          revives: c.u32(),
          damageTaken: c.u32(),
        };
      } else if (event.meta === 'AthenaMatchTeamStats') {
        const c = new Cursor(data);
        c.u32();
        replay.team = { time: event.time, placement: c.u32(), totalPlayers: c.u32() };
      } else if (event.group === 'Timecode') {
        const c = new Cursor(data);
        c.u32(); // Fassung
        const utc = ticksToMs(c.i64());
        // Der Zeitstempel gehört zum Zeitpunkt des Ereignisses, meist 0.
        if (utc !== undefined) replay.utcStart = utc - event.time;
      }
    } catch {
      replay.unreadable++;
    }
  }
  replay.eliminations.sort((a, b) => a.time - b.time);
  return replay;
}

/** Liest ein Replay aus einem Puffer. */
export function parseReplay(data: Buffer) {
  return parse({
    size: data.length,
    read: async (offset, length) => data.subarray(offset, offset + length),
  });
}

/**
 * Liest ein Replay von der Platte, ohne die ganze Datei zu laden: nur Vorspann, Kopf und die
 * Ereignis-Chunks, zusammen wenige Kilobyte einer Datei von 10 bis 20 MB.
 */
export async function readReplayFile(path: string) {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    return await parse({
      size,
      read: async (offset, length) => {
        const buffer = Buffer.alloc(Math.max(0, Math.min(length, size - offset)));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        return buffer.subarray(0, bytesRead);
      },
    });
  } finally {
    await handle.close();
  }
}
