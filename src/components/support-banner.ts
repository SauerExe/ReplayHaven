/**
 * The "support ReplayHaven" banner. The server cannot know who donated, so each browser keeps
 * its own answer: "Later" and following the link hide the banner for four days, "I already
 * donated" hides it for good. A new browser waits four days before asking the first time.
 */
export const SUPPORT_URL = 'https://paypal.me/vvashed';
export const SUPPORT_INTERVAL_MS = 4 * 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'replayhaven.support';

export interface SupportState {
  firstSeen: number;
  snoozedUntil?: number;
  donated?: boolean;
}

/** Whether the banner shows now; the first visit only starts the clock. */
export function supportDue(state: SupportState | null, now: number) {
  if (!state || state.donated) return false;
  return now >= Math.max(state.firstSeen + SUPPORT_INTERVAL_MS, state.snoozedUntil ?? 0);
}

export function snoozed(state: SupportState, now: number): SupportState {
  return { ...state, snoozedUntil: now + SUPPORT_INTERVAL_MS };
}

export function readSupport(storage: Pick<Storage, 'getItem'> | undefined): SupportState | null {
  try {
    const value = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null') as SupportState | null;
    return value && Number.isFinite(value.firstSeen) ? value : null;
  } catch {
    return null;
  }
}

export function writeSupport(storage: Pick<Storage, 'setItem'> | undefined, state: SupportState) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode or blocked storage: the answer only lasts for this page.
  }
}
