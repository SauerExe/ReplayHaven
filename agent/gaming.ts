import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

/**
 * Detects whether a game is being played, so the analysis does not occupy the graphics card
 * during play. The measure is the foreground window: if it fills the whole screen, a game is
 * running in fullscreen or a borderless window. Fullscreen browsers and video players do not
 * count; a game in a small window is not detected.
 */

/** One sample: whether the foreground window fills the screen, and whose window it is. */
export interface ForegroundSample {
  fullscreen: boolean;
  /** SHQueryUserNotificationState; 3 means exclusive fullscreen Direct3D. */
  notification: number;
  windowClass: string;
  process: string;
  /** Window title, e.g. "Raft"; for games without a known process name. */
  title?: string;
}

/** Windows shell windows and programs that are not a game when fullscreen. */
const SHELL_CLASSES = new Set([
  'Progman',
  'WorkerW',
  'Shell_TrayWnd',
  'Windows.UI.Core.CoreWindow',
]);
const NOT_GAMES = new Set(
  [
    'explorer',
    'ReplayHaven Client',
    'chrome',
    'msedge',
    'firefox',
    'opera',
    'brave',
    'vivaldi',
    'vlc',
    'mpc-hc64',
    'PotPlayerMini64',
    'Netflix',
    'ApplicationFrameHost',
    'LockApp',
    'ScreenClippingHost',
    'SnippingTool',
  ].map((name) => name.toLowerCase()),
);

/** Whether a sample shows a running game; then its process name, otherwise empty. */
export function gameIn(sample: ForegroundSample) {
  const process = sample.process.trim();
  if (!process || NOT_GAMES.has(process.toLowerCase()) || SHELL_CLASSES.has(sample.windowClass))
    return '';
  return sample.fullscreen || sample.notification === 3 ? process : '';
}

/** One output line of the probe process: fullscreen, notification state, class, process, title. */
export function parseSample(line: string): ForegroundSample | undefined {
  const [full, notification, windowClass = '', process = '', title = ''] = line
    .replace(/\r$/, '')
    .split('\t');
  if (full !== '0' && full !== '1') return undefined;
  return {
    fullscreen: full === '1',
    notification: Number(notification) || 0,
    windowClass,
    process,
    ...(title.trim() ? { title: title.trim() } : {}),
  };
}

/**
 * Process names of known games and the folder the NVIDIA App stores them under, so clips from
 * "Desktop" land with the same game as the rest.
 */
const KNOWN_GAMES: [RegExp, string][] = [
  [/^RainbowSix/i, "Tom Clancy's Rainbow Six Siege"],
  [/^VALORANT/i, 'Valorant'],
  [/^FortniteClient/i, 'Fortnite'],
  [/^(?:cod|BlackOps|bo7)/i, 'Call of Duty  Black Ops 7'],
  [/^ArcRaiders|^PioneerGame/i, 'Arc Raiders'],
  [/^javaw?$|^Minecraft/i, 'Minecraft'],
  [/^cs2$/i, 'Counter-Strike 2'],
];

/** A foreground entry with its time, for the game name of a later clip. */
export interface ForegroundEntry {
  at: number;
  process: string;
  title?: string;
}

/**
 * The game most often in the foreground between `from` and `to`, as a folder name like the
 * NVIDIA App uses; otherwise the window title. Empty if nothing game-like was in front.
 */
export function gameBetween(history: readonly ForegroundEntry[], from: number, to: number) {
  const counts = new Map<string, { count: number; title?: string }>();
  for (const entry of history) {
    if (entry.at < from || entry.at > to) continue;
    const process = entry.process.trim();
    if (
      !process ||
      NOT_GAMES.has(process.toLowerCase()) ||
      /^(?:Code|Discord|Spotify|NVIDIA)/i.test(process)
    )
      continue;
    const seen = counts.get(process) ?? { count: 0 };
    counts.set(process, { count: seen.count + 1, title: entry.title ?? seen.title });
  }
  const [process, best] = [...counts.entries()].sort((a, b) => b[1].count - a[1].count)[0] ?? [];
  // At least two samples (six seconds), so a quick glance at a window does not count.
  if (!process || best!.count < 2) return '';
  return (
    KNOWN_GAMES.find(([pattern]) => pattern.test(process))?.[1] ??
    (best!.title ?? process)
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60)
  );
}

/**
 * The game currently running, with a grace period: a game counts as started immediately, but
 * as ended only after no game has been in the foreground for a minute. A quick Alt+Tab to
 * Discord or a windowed loading screen should not start the analysis mid-game.
 */
export class GameState {
  game = '';
  private lastSeen = 0;
  constructor(private readonly resumeAfterMs = 60_000) {}
  /** Processes a sample; true if the state changed. */
  update(sample: ForegroundSample, now: number) {
    const game = gameIn(sample);
    if (game) {
      this.lastSeen = now;
      if (game === this.game) return false;
      this.game = game;
      return true;
    }
    if (!this.game || now - this.lastSeen < this.resumeAfterMs) return false;
    this.game = '';
    return true;
  }
}

// Win32 via PowerShell, without a native addon: one line every three seconds.
const PROBE = `
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class RhForeground {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO info);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder name, int size);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder text, int size);
  [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);
  public static string Probe() {
    int state; if (SHQueryUserNotificationState(out state) != 0) state = 0;
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return "0\\t" + state + "\\t\\t0";
    RECT r; GetWindowRect(h, out r);
    MONITORINFO m = new MONITORINFO(); m.cbSize = Marshal.SizeOf(m);
    GetMonitorInfo(MonitorFromWindow(h, 2), ref m);
    // A maximised window also fills the screen when the taskbar is hidden.
    bool full = !IsZoomed(h) && r.L <= m.rcMonitor.L && r.T <= m.rcMonitor.T && r.R >= m.rcMonitor.R && r.B >= m.rcMonitor.B;
    StringBuilder name = new StringBuilder(256); GetClassName(h, name, 256);
    uint pid; GetWindowThreadProcessId(h, out pid);
    StringBuilder text = new StringBuilder(256); GetWindowText(h, text, 256);
    string title = text.ToString().Replace('\\t', ' ').Replace('\\r', ' ').Replace('\\n', ' ');
    return (full ? "1" : "0") + "\\t" + state + "\\t" + name + "\\t" + pid + "\\t" + title;
  }
}
'@
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
while ($true) {
  $parts = [RhForeground]::Probe() -split "\`t"
  $name = ''
  try { $name = (Get-Process -Id ([int]$parts[3]) -ErrorAction Stop).ProcessName } catch {}
  [Console]::Out.WriteLine(($parts[0..2] -join "\`t") + "\`t" + $name + "\`t" + $parts[4])
  [Console]::Out.Flush()
  Start-Sleep -Seconds 3
}
`;

/**
 * Watches the foreground until stop() is called and reports every change between "game running"
 * (process name) and "no game" (empty). If the probe process dies, no game is assumed.
 */
export class GameWatch {
  private child?: ChildProcess;
  private readonly state: GameState;
  /** What was in front over the last hours, for the game name of clips processed later. */
  private readonly history: ForegroundEntry[] = [];
  constructor(
    private readonly onChange: (game: string) => void,
    resumeAfterMs?: number,
  ) {
    this.state = new GameState(resumeAfterMs);
  }
  get game() {
    return this.state.game;
  }
  start() {
    if (this.child) return;
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        Buffer.from(PROBE, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    this.child = child;
    createInterface({ input: child.stdout! }).on('line', (line) => {
      const sample = parseSample(line);
      if (!sample) return;
      const now = Date.now();
      this.history.push({
        at: now,
        process: sample.process,
        ...(sample.title ? { title: sample.title } : {}),
      });
      // Eight hours cover a long gaming session during which the analysis waits.
      while (this.history.length && this.history[0].at < now - 8 * 3600_000) this.history.shift();
      if (this.state.update(sample, now)) this.onChange(this.state.game);
    });
    child.on('exit', () => {
      if (this.child !== child) return;
      this.child = undefined;
      if (this.state.game) {
        this.state.game = '';
        this.onChange('');
      }
    });
    child.on('error', () => {});
  }
  /** The game in front during the two minutes before `savedAt` (gameBetween), otherwise empty. */
  gameAt(savedAt: number) {
    return gameBetween(this.history, savedAt - 120_000, savedAt + 5_000);
  }
  stop() {
    const child = this.child;
    this.child = undefined;
    child?.kill();
  }
}

/** The display name of a game for its process ("RainbowSix" → "Tom Clancy's …"). */
export function gameTitle(process: string) {
  return (
    KNOWN_GAMES.find(([pattern]) => pattern.test(process))?.[1].replace(/\s+/g, ' ') ?? process
  );
}
