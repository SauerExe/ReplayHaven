# Contributing

Thanks for helping with ReplayHaven. Bug reports, small fixes and larger features are all welcome. For anything bigger than a bug fix, open an issue first so we can agree on the approach.

## Setup

```bash
git clone https://github.com/SauerExe/ReplayHaven.git
cd ReplayHaven
npm ci
npm run media:refresh   # optional: demo artwork from Steam, not committed
npm run dev:all
```

Node.js 22.13 or newer is required; `.nvmrc`, CI and the Docker image use 24. The web UI runs on http://localhost:5173 with demo data; the server runs on 127.0.0.1:8787 without an access key.

For the Windows client run `npm run client:dev` on Windows. Ollama and the model are optional; the client works as a plain upload agent when analysis is switched off.

## Before you open a pull request

```bash
npm run check          # typecheck, lint, unit tests
npm run format         # Prettier
npm run test:e2e       # browser tests, if the web UI changed
npm run docker:build   # if the server, Dockerfile or compose.yaml changed
npm run client:build   # if the Windows client changed (Windows only)
npm run readme:images  # if the interface changed visibly, to refresh the README images
```

CI runs the same checks plus a container smoke test and an unpacked client build.

## Ground rules

- **The product brief is [`docs/DESIGN.md`](docs/DESIGN.md).** It describes the interface, its states, texts and quality bar. User-facing changes should follow it; propose changes to the brief in the pull request when the brief itself needs to move.
- **Originals are sacred.** Nothing may rename, move or delete a user's recording on the gaming PC, and removing a clip from the library must keep the original on the server.
- **Be honest in the UI.** No success messages for things that did not happen, no fake progress, no features that only pretend to work without a server.
- **Everything is English**: interface texts (short and concrete), code comments, identifiers, commit messages, the guides in `docs/`, the README and the changelog. The AI pipeline's internal prompts are German, the language all measurements were made in; generated titles are English or German (`agent/translate.ts`), and the stored analysis tags stay German keys that the web interface labels per language.
- **Keep dependencies lean.** Do not add a library for something a few lines of code can do.
- **No secrets, personal addresses or hardware names** in code or docs. Use placeholders and environment variables.

## Style

Prettier and ESLint are configured; `npm run format` and `npm run lint` are the source of truth. Small, focused pull requests with a clear description and test notes are easiest to review.

## Branches

Open pull requests against `develop`, the default branch. `main` holds what was released: `develop` is merged into it by pull request, and releases are tagged there. Both branches are protected: changes arrive only through pull requests whose CI passed, and neither can be force-pushed or deleted.

## Releases

Maintainers release in three steps:

1. On `develop` (by pull request), bump the version in `package.json` and add its section to `CHANGELOG.md` in the same commit.
2. Open a pull request from `develop` to `main` and merge it once CI passes.
3. Tag the merge commit on `main` and push the tag:

   ```bash
   git switch main && git pull
   git tag v1.0.1 && git push origin v1.0.1
   ```

The release workflow checks that the tag is on `main`, builds the installer, pushes the server image to GHCR and publishes the GitHub release. A tag with a hyphen (`v1.1.0-rc.1`) becomes a pre-release: the image gets only its exact version tag, not `:latest`, `:1` or `:1.1`, and the installer's "latest" skips it. "Run workflow" in the Actions tab does a dry run that publishes nothing.

## License of contributions

ReplayHaven is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). By opening a pull request you agree that your contribution is licensed under the same terms and that the maintainer may also offer it under other terms, for example a commercial license.
