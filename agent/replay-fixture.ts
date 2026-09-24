import { createCipheriv, randomBytes } from 'node:crypto';

/**
 * Synthetische Fortnite-Replays für Tests, gebaut wie echte Dateien (agent/replay.ts): Vorspann,
 * Kopf-Chunk, Daten- und Checkpoint-Chunks als Füllung, verschlüsselte Ereignis-Chunks. Echte
 * Replays gehören nicht ins Repository — sie enthalten Konto-IDs fremder Spieler.
 */

export interface FixtureElim {
  time: number;
  /** Epic-Konto-ID (32 Hex-Zeichen), "bot" oder { name } für benannte Bots. */
  victim: string | { name: string };
  killer: string | { name: string };
  cause: number;
  knocked?: boolean;
  /** Orte in Zentimetern; fehlt einer, schreibt die Datei (0, 0, 0) wie das Spiel. */
  victimAt?: [number, number, number];
  killerAt?: [number, number, number];
}

export interface FixtureOptions {
  lengthMs?: number;
  live?: boolean;
  encrypted?: boolean;
  /** Ortszeit des Aufnahmebeginns ohne Zeitzone, als wäre sie UTC: Date.UTC(…). */
  localStart?: number;
  /** Aufnahmebeginn in UTC; schreibt ein Timecode-Ereignis wie ab Kapitel 5. */
  utcStart?: number;
  /** Ab 23 schreibt das Spiel Vektoren als double. */
  engineNetworkVersion?: number;
  gameVersion?: string;
  elims?: FixtureElim[];
  stats?: { time: number; eliminations: number };
  team?: { time: number; placement: number; totalPlayers: number };
}

const EPOCH_TICKS = 621355968000000000n;

class Writer {
  private parts: Buffer[] = [];
  u8(value: number) {
    this.parts.push(Buffer.from([value]));
    return this;
  }
  u16(value: number) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(value);
    this.parts.push(b);
    return this;
  }
  u32(value: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(value);
    this.parts.push(b);
    return this;
  }
  i32(value: number) {
    const b = Buffer.alloc(4);
    b.writeInt32LE(value);
    this.parts.push(b);
    return this;
  }
  i64(value: bigint) {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(value);
    this.parts.push(b);
    return this;
  }
  number(value: number, wide: boolean) {
    const b = Buffer.alloc(wide ? 8 : 4);
    if (wide) b.writeDoubleLE(value);
    else b.writeFloatLE(value);
    this.parts.push(b);
    return this;
  }
  bytes(value: Buffer) {
    this.parts.push(value);
    return this;
  }
  string(value: string) {
    const text = Buffer.from(`${value}\0`, 'latin1');
    return this.i32(text.length).bytes(text);
  }
  build() {
    return Buffer.concat(this.parts);
  }
}

const ticks = (ms: number) => BigInt(ms) * 10000n + EPOCH_TICKS;

function player(w: Writer, who: string | { name: string }) {
  if (who === 'bot') w.u8(0x03);
  else if (typeof who === 'object') w.u8(0x10).string(who.name);
  else w.u8(0x11).u8(16).bytes(Buffer.from(who, 'hex'));
}

function elimination(e: FixtureElim, wide: boolean) {
  const w = new Writer().i32(9).u8(4);
  for (const at of [e.victimAt, e.killerAt]) {
    for (const v of [0, 0, 0, 1]) w.number(v, wide);
    for (const v of at ?? [0, 0, 0]) w.number(v, wide);
    for (const v of [1, 1, 1]) w.number(v, wide);
  }
  player(w, e.victim);
  player(w, e.killer);
  return w
    .u8(e.cause)
    .u32(e.knocked ? 1 : 0)
    .build();
}

/** Baut eine Replay-Datei. Ohne Angaben: verschlüsselt, Engine-Version 36, 20 Minuten. */
export function buildReplay(options: FixtureOptions = {}) {
  const encrypted = options.encrypted ?? true;
  const key = randomBytes(32);
  const env = options.engineNetworkVersion ?? 36;
  const wide = env >= 23;
  const out = new Writer()
    .u32(0x1ca2e27f)
    .u32(7)
    .i32(0)
    .u32(options.lengthMs ?? 1200000)
    .u32(2)
    .u32(12345678)
    .string('Unsaved Replay')
    .u32(options.live ? 1 : 0)
    .i64(ticks(options.localStart ?? Date.UTC(2026, 8, 24, 20, 0, 0)))
    .u32(1)
    .u32(encrypted ? 1 : 0)
    .u32(encrypted ? 32 : 0)
    .bytes(encrypted ? key : Buffer.alloc(0));
  const chunk = (type: number, data: Buffer) => out.u32(type).i32(data.length).bytes(data);
  const header = new Writer()
    .u32(0x2cf5a13d)
    .u32(19)
    .i32(0)
    .u32(0xdeadbeef)
    .u32(env)
    .u32(0)
    .bytes(Buffer.alloc(16, 7))
    .u32(0)
    .u16(0)
    .u32(12345678)
    .string(`++Fortnite+Release-${options.gameVersion ?? '38.10'}`)
    .bytes(Buffer.alloc(12))
    .i32(1)
    .string('/Game/Athena/Maps/Athena_Terrain')
    .u32(0)
    .u32(171)
    .i32(1)
    .string('SubGame=Athena')
    .build();
  chunk(0, header);
  chunk(1, randomBytes(512));
  const seal = (data: Buffer) => {
    if (!encrypted) return data;
    const cipher = createCipheriv('aes-256-ecb', key, null);
    return Buffer.concat([cipher.update(data), cipher.final()]);
  };
  const event = (group: string, meta: string, time: number, data: Buffer) => {
    const sealed = seal(data);
    chunk(
      3,
      new Writer()
        .string(`event-${group}-${time}`)
        .string(group)
        .string(meta)
        .u32(time)
        .u32(time)
        .i32(sealed.length)
        .bytes(sealed)
        .build(),
    );
  };
  if (options.utcStart !== undefined)
    event(
      'Timecode',
      'TimecodeVersionedMeta',
      0,
      new Writer().u32(9).i64(ticks(options.utcStart)).build(),
    );
  for (const e of options.elims ?? [])
    event('playerElim', 'versionedEvent', e.time, elimination(e, wide));
  chunk(2, randomBytes(256));
  if (options.stats)
    event(
      'AthenaReplayBrowserEvents',
      'AthenaMatchStats',
      options.stats.time,
      new Writer()
        .u32(0)
        .number(0.4, false)
        .u32(1)
        .u32(options.stats.eliminations)
        .u32(900)
        .u32(100)
        .u32(0)
        .u32(250)
        .u32(0)
        .u32(0)
        .u32(0)
        .u32(0)
        .build(),
    );
  if (options.team)
    event(
      'AthenaReplayBrowserEvents',
      'AthenaMatchTeamStats',
      options.team.time,
      new Writer().u32(0).u32(options.team.placement).u32(options.team.totalPlayers).build(),
    );
  return out.build();
}

/** Eine Epic-Konto-ID aus einer kurzen Kennung, etwa id('a1') = "a1a1a1…". */
export function id(tag: string) {
  return tag.repeat(Math.ceil(32 / tag.length)).slice(0, 32);
}
