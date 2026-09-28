/**
 * Update notice: the client compares its own version with the one its server reports in
 * /api/status and, when the server is newer, opens that version's page among the project's
 * releases (releasePage below). For the check it asks no one but the server it already talks to.
 */
function parts(version: string) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return match ? match.slice(1).map(Number) : undefined;
}

/** Whether `candidate` is a newer release than `current`; unknown versions never are. */
export function isNewer(candidate: string | undefined, current: string) {
  const next = candidate ? parts(candidate) : undefined;
  const now = parts(current);
  if (!next || !now) return false;
  for (let i = 0; i < 3; i++) if (next[i] !== now[i]) return next[i] > now[i];
  return false;
}

/** The project's releases; the client offers updates only from here, never from the server. */
export const RELEASES = 'https://github.com/SauerExe/ReplayHaven/releases';

/**
 * The release page of an update. The client opens this page instead of an installer the server
 * points to: a server that was taken over could otherwise hand every paired PC a program of its
 * choice. On GitHub the release lists SHA256SUMS.txt and the build attestation next to the file.
 */
export function releasePage(version: string) {
  const match = /^v?(\d+\.\d+\.\d+)$/.exec(version.trim());
  return match ? `${RELEASES}/tag/v${match[1]}` : `${RELEASES}/latest`;
}
