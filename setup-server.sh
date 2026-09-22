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
printf '\nReplayHaven · Archiv-Server einrichten\n\n'
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  printf 'Bitte zuerst Docker Engine und das Compose-Plugin installieren:\nhttps://docs.docker.com/engine/install/\nDanach diesen Befehl erneut ausführen: bash setup-server.sh\n'
  exit 1
fi
if [[ "$mode" == "build" && ! -f Dockerfile ]]; then
  printf 'Kein Quellcode in diesem Verzeichnis. Für das veröffentlichte Image: bash setup-server.sh --pull\n'
  exit 1
fi
if [[ ! -f .env && -f .server.env ]]; then
  mv .server.env .env
  printf 'Vorhandene Einrichtung aus .server.env übernommen.\n'
fi
if [[ ! -f .env ]]; then
  if ! command -v openssl >/dev/null 2>&1; then
    printf 'OpenSSL fehlt. Einmalig installieren: sudo apt-get install openssl\n'
    exit 1
  fi
  detected="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  suggested="http://${detected:-localhost}:8787"
  read -r -p "Serveradresse für den Browser [${suggested}]: " vault_origin
  vault_origin="${vault_origin:-$suggested}"
  if [[ ! "$vault_origin" =~ ^https?://[a-zA-Z0-9.:_-]+$ ]]; then
    printf 'Ungültige Serveradresse. Erwartet: http://host-oder-ip:8787\n'
    exit 1
  fi
  umask 077
  {
    printf 'REPLAYHAVEN_ACCESS_TOKEN=%s\n' "$(openssl rand -hex 24)"
    printf 'REPLAYHAVEN_PUBLIC_ORIGIN=%s\n' "$vault_origin"
  } > .env
  printf '\nEinrichtung gespeichert. Dein Zugangsschlüssel für Browser und Windows-Client:\n'
  sed -n 's/^REPLAYHAVEN_ACCESS_TOKEN=//p' .env
  printf '\nBewahre ihn auf. Du findest ihn später in .env.\n'
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
printf '\nReplayHaven läuft: %s\nIm Browser unter Einstellungen → KI & Server den Zugangsschlüssel eingeben.\nDen Windows-Client findest du danach unter Geräte.\n' "$origin"
