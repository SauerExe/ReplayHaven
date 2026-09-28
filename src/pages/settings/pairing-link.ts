/**
 * The link the Windows client registers (replayhaven://). It carries this server's address as the
 * browser sees it and a one-time ticket that stands for the admin's approval.
 */
export function pairingLink(origin: string, ticket: string) {
  return `replayhaven://pair?server=${encodeURIComponent(origin)}&ticket=${encodeURIComponent(ticket)}`;
}
