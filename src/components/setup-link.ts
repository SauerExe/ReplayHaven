/**
 * The setup link from the installer and the server log, `https://host/#setup-key=<access key>`,
 * fills in the access key for the first account. The key travels in the fragment, which browsers
 * never send to the server, and is removed from the address bar as soon as it has been read.
 */
const PARAM = 'setup-key';

/** The key from a location hash and the hash without it (other fragment parameters stay). */
export function splitSetupKey(hash: string): { key: string; rest: string } {
  const raw = hash.replace(/^#/, '');
  if (!raw.split('&').some((part) => part.startsWith(`${PARAM}=`))) return { key: '', rest: hash };
  const params = new URLSearchParams(raw);
  const key = (params.get(PARAM) ?? '').trim().slice(0, 1000);
  params.delete(PARAM);
  const rest = params.toString();
  return { key, rest: rest ? `#${rest}` : '' };
}

let taken: string | undefined;
/** Reads the key once per page load and removes it from the address bar and its history entry. */
export function takeSetupKey() {
  if (taken !== undefined) return taken;
  const { hash } = window.location;
  const { key, rest } = splitSetupKey(hash);
  taken = key;
  if (rest !== hash) {
    const { pathname, search } = window.location;
    window.history.replaceState(window.history.state, '', pathname + search + rest);
  }
  return taken;
}
