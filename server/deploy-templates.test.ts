import { expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

// The Portainer and Coolify templates are read by third-party tools; a renamed variable would
// break them silently, so they are checked against the files they depend on.
const read = (path: string) => readFileSync(path, 'utf8');

it('keeps the Portainer template in line with compose.yaml', () => {
  // One template, as the Lissy93/portainer-templates collection pulls it in.
  const stack = JSON.parse(read('portainer-template.json')) as {
    repository: { stackfile: string };
    env: { name: string }[];
  };
  expect(existsSync(stack.repository.stackfile)).toBe(true);
  const compose = read(stack.repository.stackfile);
  for (const { name } of stack.env) expect(compose, name).toContain(`\${${name}`);
});

it('only sets variables in the Coolify compose file that the server reads', () => {
  const config = read('server/config.ts');
  const names = [...read('docker-compose.coolify.yml').matchAll(/- (REPLAYHAVEN_\w+)=/g)].map(
    (m) => m[1],
  );
  expect(names).toContain('REPLAYHAVEN_ACCESS_TOKEN');
  for (const name of names) expect(config, name).toContain(name);
});
