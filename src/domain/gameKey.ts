/** Vergleichsform für Spielnamen aus Aufnahmeordnern, KI und Steam. */
export function gameKey(name: string) {
  return (
    name
      .toLocaleLowerCase('de')
      .replace(/[®™©]/g, '')
      // „Desktop+“ ist ein eigenes Programm, nicht das NVIDIA-Auffangprofil „Desktop“.
      .replace(/[^\p{L}\p{N}+]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ')
  );
}
