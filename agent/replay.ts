import { createDecipheriv } from 'node:crypto';
import { open } from 'node:fs/promises';

/**
 * Reads Fortnite replays (.replay) as far as clip titles need: file header, timestamps and the
 * event chunks with eliminations and match stats.
 *
 * It deliberately does not read the network stream with positions, names and weapon switches:
 * its layout changes every season, and it is Oodle-compressed. The event chunks, by contrast,
 * have had the same layout for years and are only encrypted with the key from the file header
 * (AES-256-ECB). Layout based on the Unreal Engine (LocalFileNetworkReplayStreaming) and the
 * open-source readers xNocken/replay-reader and Shiqan/FortniteReplayDecompressor.
 * Checked against six real replays from Season 11 (2019) to Chapter 5 Season 5 (2024): every
 * elimination could be read down to the last byte.
 */

const FILE_MAGIC = 0x1ca2e27f;
const HEADER_MAGIC = 0x2cf5a13d;
/** .NET ticks (100 ns since 0001-01-01) at 1970-01-01. */
const EPOCH_TICKS = 621355968000000000n;
/** From this network version on, UE5 writes vectors as double (Large World Coordinates). */
const LWC_ENGINE_NETWORK_VERSION = 23;
/** Limits against corrupted files: no event and no header comes anywhere near this size. */
const MAX_EVENT_BYTES = 1 << 20;
const MAX_STRING_BYTES = 1 << 16;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A participant in an elimination. Players carry their Epic account ID (32 hex characters). */
export type ReplayPlayer =
  { kind: 'player'; id: string } | { kind: 'bot'; id: string } | { kind: 'name'; id: string };

export interface Elimination {
  /** Milliseconds since the start of the recording. */
  time: number;
  victim: ReplayPlayer;
  killer: ReplayPlayer;
  /** Cause of death per the game (EDeathCause): weapon type, storm, fall damage, bleed-out … */
  cause: number;
  /** Knocked down instead of eliminated. */
  knocked: boolean;
  /** Victim position in centimeters; missing if the replay does not know it. */
  victimAt?: Vec3;
  /** Killer position; missing if they were too far away to appear in the replay. */
  killerAt?: Vec3;
}

/** Stats of the recording player, written when their match ends. */
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
  /** The recording is still running; events and key may be missing then. */
  live: boolean;
  encrypted: boolean;
  /**
   * Start of the recording in the gaming PC's local time, without time zone: milliseconds as if
   * local time were UTC. The game writes FDateTime::Now() here.
   */
  localStart?: number;
  /** Start of the recording in UTC (Timecode event, since Chapter 5), milliseconds since 1970. */
  utcStart?: number;
  engineNetworkVersion?: number;
  /** Game version from the branch, for example "32.00" from "++Fortnite+Release-32.00". */
  gameVersion?: string;
  eliminations: Elimination[];
  stats?: MatchStats;
  team?: TeamStats;
  /** Events that could not be read. */
  unreadable: number;
}

export class ReplayError extends Error {}

/** Read cursor over a buffer that throws a ReplayError on every overrun. */
class Cursor {
  offset = 0;
  constructor(readonly data: Buffer) {}
  private take(bytes: number) {
    if (bytes < 0 || this.offset + bytes > this.data.length)
      throw new ReplayError('Replay ends unexpectedly.');
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
  /** FString: length including the null terminator; negative means UTF-16. */
  string() {
    const length = this.i32();
    if (length === 0) return '';
    const bytes = length < 0 ? -length * 2 : length;
    if (bytes > MAX_STRING_BYTES) throw new ReplayError('String in replay is too long.');
    const raw = this.bytes(bytes);
    return (length < 0 ? raw.toString('utf16le') : raw.toString('latin1')).replace(/\0+$/, '');
  }
}

/** Milliseconds since 1970 from .NET ticks; undefined outside plausible years. */
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
  /** Where the chunks begin. */
  end: number;
}

function readInfo(data: Buffer): Info {
  const c = new Cursor(data);
  if (c.u32() !== FILE_MAGIC) throw new ReplayError('Not a Fortnite replay file.');
  const fileVersion = c.u32();
  // From version 7 on, custom versions follow: 16 bytes GUID and 4 bytes number each.
  if (fileVersion >= 7) c.skip(Math.max(0, c.i32()) * 20);
  const lengthMs = c.u32();
  c.u32(); // network version
  c.u32(); // changelist
  c.string(); // display name, usually "Unsaved Replay"
  const live = c.u32() !== 0;
  const localStart = fileVersion >= 3 ? ticksToMs(c.i64()) : undefined;
  if (fileVersion >= 2) c.u32(); // compressed
  let encrypted = false;
  let key: Buffer | undefined;
  if (fileVersion >= 6) {
    encrypted = c.u32() !== 0;
    const length = c.u32();
    if (length > 64) throw new ReplayError('Replay key has an unknown length.');
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
  if (c.u32() !== HEADER_MAGIC) throw new ReplayError('Replay header is corrupted.');
  const networkVersion = c.u32();
  if (networkVersion >= 19) c.skip(Math.max(0, c.i32()) * 20);
  c.u32(); // checksum
  const engineNetworkVersion = c.u32();
  c.u32(); // game protocol version
  if (networkVersion >= 12) c.skip(16); // GUID
  let gameVersion: string | undefined;
  if (networkVersion >= 11) {
    c.skip(4 + 2 + 4); // major version, patch, changelist
    gameVersion = /Release-(\d+\.\d+)/.exec(c.string())?.[1];
  }
  return { engineNetworkVersion, gameVersion };
}

/** A transform: rotation (quaternion), position, scale — as float or double. */
function readTransform(number: () => number) {
  const rotation = [number(), number(), number(), number()];
  const at = { x: number(), y: number(), z: number() };
  const scale = [number(), number(), number()];
  return { rotation, at, scale };
}

/**
 * A transform is plausible if its numbers are finite and small enough. A block read with the
 * wrong number width yields values like 1e+38 or NaN and is filtered out here.
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
    if (length < 1 || length > 64) throw new ReplayError('Player ID has an unknown length.');
    return { kind: 'player', id: c.bytes(length).toString('hex') };
  }
  throw new ReplayError(`Unknown player type ${type}.`);
}

/**
 * Reads an elimination. It starts with a version number, then an unknown byte and one transform
 * each for the victim (from version 6) and the killer, then both participants, the cause of
 * death and whether the victim was only knocked down.
 *
 * The number width of the transforms depends on the engine version: float up to Chapter 2,
 * double from Large World Coordinates on. Both widths are tried, the one matching the version
 * first; only a read that ends exactly at the end of the event counts. Checked against real
 * replays from 6.01 to 32.00. That an open-source reader skips another 80 bytes from engine
 * version 34 on only compensates for float instead of double there; there is no extra block.
 */
export function readElimination(data: Buffer, time: number, engineNetworkVersion: number) {
  const version = data.length >= 4 ? data.readInt32LE(0) : -1;
  if (version < 3 || version > 100)
    throw new ReplayError(`Elimination in unknown format ${version}.`);
  const lwc = engineNetworkVersion >= LWC_ENGINE_NETWORK_VERSION;
  const transforms = version >= 6 ? 2 : 1;
  let failure: unknown;
  for (const wide of [lwc, !lwc]) {
    try {
      const c = new Cursor(data);
      c.skip(4 + 1);
      const number = wide ? () => c.f64() : () => c.f32();
      const read = Array.from({ length: transforms }, () => readTransform(number));
      if (!read.every(plausible)) throw new ReplayError('Implausible transform.');
      const victim = readPlayer(c, version >= 6);
      const killer = readPlayer(c, version >= 6);
      const cause = c.u8();
      const knocked = c.u32();
      if (knocked > 1 || c.remaining !== 0) throw new ReplayError('Elimination does not add up.');
      // A position of (0, 0, 0) means unknown, not the center of the map.
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
  throw failure instanceof ReplayError ? failure : new ReplayError('Elimination unreadable.');
}

function decrypt(data: Buffer, key: Buffer | undefined) {
  if (!key) return data;
  const decipher = createDecipheriv('aes-256-ecb', key, null);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/** Access to the file: fully in memory (tests) or piece by piece from disk. */
interface Source {
  size: number;
  read(offset: number, length: number): Promise<Buffer>;
}

async function parse(source: Source): Promise<Replay> {
  // The display name is padded to 256 characters; 4 KiB safely holds the preamble.
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
  // While recording, key and events are still missing; they are only read afterwards.
  if (info.live) return replay;
  const key = info.encrypted ? info.key : undefined;
  if (info.encrypted && key?.length !== 32)
    throw new ReplayError('Replay is encrypted and the key is missing.');
  let header: Header | undefined;
  const pending: { time: number; group: string; meta: string; data: Buffer }[] = [];
  let offset = info.end;
  while (offset + 8 <= source.size) {
    const head = await source.read(offset, 8);
    const type = head.readUInt32LE(0);
    const size = head.readInt32LE(4);
    const start = offset + 8;
    if (size < 0 || start + size > source.size) break; // truncated file
    if (type === 0 && size <= MAX_EVENT_BYTES) header = readHeader(await source.read(start, size));
    if (type === 3 && size <= MAX_EVENT_BYTES) {
      const c = new Cursor(await source.read(start, size));
      c.string(); // ID
      const group = c.string();
      const meta = c.string();
      const time = c.u32();
      c.u32(); // end
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
        c.u32(); // format version
        const utc = ticksToMs(c.i64());
        // The timestamp belongs to the time of the event, usually 0.
        if (utc !== undefined) replay.utcStart = utc - event.time;
      }
    } catch {
      replay.unreadable++;
    }
  }
  replay.eliminations.sort((a, b) => a.time - b.time);
  return replay;
}

/** Reads a replay from a buffer. */
export function parseReplay(data: Buffer) {
  return parse({
    size: data.length,
    read: async (offset, length) => data.subarray(offset, offset + length),
  });
}

/**
 * Reads a replay from disk without loading the whole file: only the preamble, the header and the
 * event chunks, together a few kilobytes of a 10 to 20 MB file.
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
