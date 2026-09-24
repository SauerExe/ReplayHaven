import type { AudioTrack } from '../server/media';

/**
 * Tonspuren einer Aufnahme. Mit „Mikrofon als separate Spur“ schreibt die NVIDIA App Spielton
 * und Mikrofon getrennt. Welche Spur das Mikrofon ist, sagt die Datei nicht verlässlich: Die
 * Spuren tragen oft keinen Titel, und Nutzer berichten von einer zusätzlichen stummen Spur.
 * Deshalb entscheiden der Reihe nach Titel, Pegel und Reihenfolge; bleibt es offen, gibt es
 * keine Mikrofonspur statt einer geratenen.
 */

/** Unterhalb dieser Spitze gilt eine Spur als stumm (dBFS). */
export const SILENT_DB = -70;
const MIC_TITLE = /\b(?:mic|mikro|microphone|mikrofon|voice|stimme|commentary|kommentar)/i;
const GAME_TITLE = /\b(?:game|spiel|system|desktop|application|anwendung)/i;

export interface MicChoice {
  /** Nummer unter den Tonspuren (-map 0:a:N); fehlt, wenn es keine eigene Mikrofonspur gibt. */
  track?: number;
  basis: string;
}

/**
 * Wählt die Mikrofonspur. `levels` enthält die Spitzenpegel je Spur, falls gemessen; stumme
 * Spuren zählen dann nicht mit.
 */
export function micTrack(
  tracks: readonly AudioTrack[],
  levels?: ReadonlyMap<number, { max: number }>,
): MicChoice {
  if (tracks.length < 2) return { basis: 'nur eine Tonspur: Spielton und Mikrofon gemischt' };
  const titled = tracks.filter((t) => MIC_TITLE.test(t.title) && !GAME_TITLE.test(t.title));
  if (titled.length === 1) return { track: titled[0].index, basis: `Titel "${titled[0].title}"` };
  const audible = levels
    ? tracks.filter((t) => (levels.get(t.index)?.max ?? -Infinity) > SILENT_DB)
    : [...tracks];
  if (audible.length < 2)
    return {
      basis: audible.length
        ? 'nur eine Spur mit Ton: Das Mikrofon war stumm oder ist eingemischt'
        : 'alle Spuren stumm',
    };
  if (audible.length === 2)
    return {
      track: audible[1].index,
      basis: `Reihenfolge: Spielton zuerst, Mikrofon danach (Spur ${audible[0].index + 1} und ${audible[1].index + 1})`,
    };
  return { basis: `${audible.length} Spuren mit Ton, keine als Mikrofon gekennzeichnet` };
}
