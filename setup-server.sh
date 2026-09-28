#!/usr/bin/env bash
# ReplayHaven archive server: setup from a source checkout.
#
#   bash setup-server.sh          # build the image from this checkout and start it
#   bash setup-server.sh --pull   # use the published image instead of building
#
# Without a checkout, use the installer instead:
#   curl -fsSL https://github.com/SauerExe/ReplayHaven/releases/latest/download/install.sh | bash
#
# Re-running the script keeps your existing .env (access key and public address).
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
# Shared helpers (Docker check, .env creation, setup link); REPLAYHAVEN_INSTALL_LIB skips its main.
if [[ ! -f install.sh ]]; then
  printf 'install.sh is missing. Run this script from a full ReplayHaven checkout.\n'
  exit 1
fi
# shellcheck source=install.sh
REPLAYHAVEN_INSTALL_LIB=1 source ./install.sh
mode="build"
if [[ "${1:-}" == "--pull" ]]; then mode="pull"; fi
printf '\nReplayHaven · archive server setup\n\n'
require_docker
if [[ "$mode" == "build" && ! -f Dockerfile ]]; then
  printf 'No source code in this directory. For the published image: bash setup-server.sh --pull\n'
  exit 1
fi
if [[ ! -f .env && -f .server.env ]]; then
  mv .server.env .env
  printf 'Took over the existing setup from .server.env.\n'
fi
if [[ ! -f .env ]]; then create_env .env.example; fi
mkdir -p release
if [[ "$mode" == "build" ]]; then
  docker build -t replayhaven:local .
  if ! grep -q '^REPLAYHAVEN_IMAGE=' .env; then printf 'REPLAYHAVEN_IMAGE=replayhaven:local\n' >> .env; fi
else
  grep -v '^REPLAYHAVEN_IMAGE=replayhaven:local$' .env > .env.tmp || true
  cat .env.tmp > .env && rm -f .env.tmp
  docker compose pull
fi
docker compose up -d
report_ready
