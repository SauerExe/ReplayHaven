/** Comparison form for game names from recording folders, AI and Steam. */
export function gameKey(name: string) {
  return (
    name
      .toLocaleLowerCase('de')
      .replace(/[®™©]/g, '')
      // "Desktop+" is a separate program, not the NVIDIA catch-all profile "Desktop".
      .replace(/[^\p{L}\p{N}+]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ')
  );
}
