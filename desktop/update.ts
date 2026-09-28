/**
 * Update notice: the client compares its own version with the one its server reports in
 * /api/status and offers the server's installer when the server is newer. It asks no one but the
 * server it already talks to.
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
