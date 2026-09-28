/**
 * Pairing by link (server: Accounts.pairingTicket): the web interface opens
 * replayhaven://pair?server=…&ticket=…, and the ticket stands for the admin's approval.
 */
export const PAIRING_SCHEME = 'replayhaven';

/** Server address and ticket from a pairing link; throws for anything else. */
export function parsePairingLink(link: string) {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error('This is not a ReplayHaven pairing link.');
  }
  const ticket = url.searchParams.get('ticket') ?? '';
  if (
    url.protocol !== `${PAIRING_SCHEME}:` ||
    url.hostname !== 'pair' ||
    !/^rht_[\w-]{20,200}$/.test(ticket)
  )
    throw new Error('This is not a ReplayHaven pairing link.');
  const server = new URL(url.searchParams.get('server') ?? '');
  if (!['http:', 'https:'].includes(server.protocol) || server.username || server.password)
    throw new Error('The pairing link names no valid server address.');
  return { server: server.origin, ticket };
}

/** The pairing link among the arguments Windows starts the client with, if any. */
export const linkIn = (argv: readonly string[]) =>
  argv.find((a) => a.startsWith(`${PAIRING_SCHEME}://`));
