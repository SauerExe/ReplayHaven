# Contributing

Thanks for helping with ReplayHaven. Bug reports, small fixes and larger features are all welcome. For anything bigger than a bug fix, open an issue first so we can agree on the approach.

## Setup

```bash
git clone https://github.com/OWNER/replayhaven.git
cd replayhaven
npm ci
npm run dev:all
```

Node.js 24 or newer is required (`.nvmrc`). The web UI runs on http://localhost:5173 with demo data; the server runs on 127.0.0.1:8787 without an access key.

For the Windows client run `npm run client:dev` on Windows. Ollama and the model are optional; the client works as a plain upload agent when analysis is switched off.

## Before you open a pull request

```bash
npm run check          # typecheck, lint, unit tests
npm run format         # Prettier
npm run test:e2e       # browser tests, if the web UI changed
npm run docker:build   # if the server, Dockerfile or compose.yaml changed
npm run client:build   # if the Windows client changed (Windows only)
```

CI runs the same checks plus a container smoke test and an unpacked client build.

## Ground rules

- **The product brief is `agent.md`.** It describes the interface, its states, texts and quality bar. User-facing changes should follow it; propose changes to the brief in the pull request when the brief itself needs to move.
- **Originals are sacred.** Nothing may rename, move or delete a user's recording on the gaming PC, and removing a clip from the library must keep the original on the server.
- **Be honest in the UI.** No success messages for things that did not happen, no fake progress, no features that only pretend to work without a server.
- **Interface texts are German**, short and concrete. Code, comments, commit messages and documentation for developers are English.
- **Keep dependencies lean.** Do not add a library for something a few lines of code can do.
- **No secrets, personal addresses or hardware names** in code or docs. Use placeholders and environment variables.

## Style

Prettier and ESLint are configured; `npm run format` and `npm run lint` are the source of truth. Small, focused pull requests with a clear description and test notes are easiest to review.

## Releases

Maintainers release by tagging: `git tag v1.2.0 && git push origin v1.2.0`. The release workflow builds the installer, pushes the server image to GHCR and publishes the GitHub release. Update `CHANGELOG.md` in the same commit as the version bump in `package.json`.
