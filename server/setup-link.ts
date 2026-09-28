import type { ServerConfig } from './config';

/**
 * The link that opens the first-account setup with the access key filled in. The key sits in the
 * URL fragment: browsers never send it to the server or through a proxy, and the web app removes
 * it from the address bar as soon as it has read it (src/components/setup-link.ts).
 */
export function setupLink(origin: string, token: string) {
  const base = origin.replace(/\/+$/, '');
  return token ? `${base}/#setup-key=${encodeURIComponent(token)}` : base;
}

/**
 * Log lines for a server without any account yet: where to create the first one. Nothing once an
 * account exists. With single sign-on, members of the admin group may also sign in directly.
 */
export function setupNotice(
  config: Pick<ServerConfig, 'publicOrigin' | 'token' | 'passwordLogin' | 'oidc'>,
  hasUsers: boolean,
) {
  if (hasUsers) return [];
  return [
    'No account yet. Create the admin account with this link (it contains the access key):',
    `  ${setupLink(config.publicOrigin, config.token)}`,
    ...(config.oidc?.adminGroup
      ? [
          `Members of ${config.oidc.adminGroup} may instead sign in with ${config.oidc.name} directly.`,
        ]
      : []),
  ];
}
