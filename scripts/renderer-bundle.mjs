import { build } from 'esbuild';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

/**
 * The client window's code (desktop/renderer/src) as the one classic script index.html loads:
 * the CSP allows only scripts from the window's own folder, no inline code and no eval.
 * Used by scripts/build-client.mjs and, in memory, by scripts/readme-images.mjs.
 */
export function bundleRenderer(options = {}) {
  return build({
    entryPoints: [join(root, 'desktop', 'renderer', 'src', 'main.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    // Electron 44 ships a newer Chromium; this only decides what esbuild may leave as is.
    target: 'chrome130',
    logLevel: 'warning',
    ...options,
  });
}
