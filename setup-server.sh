#!/usr/bin/env bash
# ReplayHaven archive server: one-shot setup for Docker hosts.
#
#   bash setup-server.sh          # build the image from this checkout and start it
#   bash setup-server.sh --pull   # use the published image instead of building
#
# Re-running the script keeps your existing .env (access key and public address).
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
mode="build"
if [[ "${1:-}" == "--pull" ]]; then mode="pull"; fi
printf '\nReplayHaven · archive server setup\n\n'
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  printf 'Install Docker Engine and the Compose plugin first:\nhttps://docs.docker.com/engine/install/\nThen run this command again: bash setup-server.sh\n'
  exit 1
fi
if [[ "$mode" == "build" && ! -f Dockerfile ]]; then
  printf 'No source code in this directory. For the published image: bash setup-server.sh --pull\n'
  exit 1
fi
if [[ ! -f .env && -f .server.env ]]; then
  mv .server.env .env
  printf 'Took over the existing setup from .server.env.\n'
fi
if [[ ! -f .env ]]; then
  if ! command -v openssl >/dev/null 2>&1; then
    printf 'OpenSSL is missing. Install it once: sudo apt-get install openssl\n'
    exit 1
  fi
  detected="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  suggested="http://${detected:-localhost}:8787"
  read -r -p "Server address for the browser [${suggested}]: " vault_origin
  vault_origin="${vault_origin:-$suggested}"
  if [[ ! "$vault_origin" =~ ^https?://[a-zA-Z0-9.:_-]+$ ]]; then
    printf 'Invalid server address. Expected: http://host-or-ip:8787\n'
    exit 1
  fi
  umask 077
  {
    printf 'REPLAYHAVEN_ACCESS_TOKEN=%s\n' "$(openssl rand -hex 24)"
    printf 'REPLAYHAVEN_PUBLIC_ORIGIN=%s\n' "$vault_origin"
  } > .env
  printf '\nSetup saved. Your access key, needed once to create the first account:\n'
  sed -n 's/^REPLAYHAVEN_ACCESS_TOKEN=//p' .env
  printf '\nKeep it safe. You will find it in .env later.\n'
fi
mkdir -p release
if [[ "$mode" == "build" ]]; then
  docker build -t replayhaven:local .
  if ! grep -q '^REPLAYHAVEN_IMAGE=' .env; then printf 'REPLAYHAVEN_IMAGE=replayhaven:local\n' >> .env; fi
else
  sed -i '/^REPLAYHAVEN_IMAGE=replayhaven:local$/d' .env
  docker compose pull
fi
docker compose up -d
origin="$(sed -n 's/^REPLAYHAVEN_PUBLIC_ORIGIN=//p' .env)"
printf '\nReplayHaven is running: %s\nOpen it in the browser and create your account with the access key.\nThe Windows client is under Settings → Recording PCs.\n' "$origin"
