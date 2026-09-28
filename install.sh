#!/usr/bin/env bash
# ReplayHaven archive server: installer and updater for Docker hosts.
#
#   curl -fsSL https://github.com/SauerExe/ReplayHaven/releases/latest/download/install.sh | bash
#
# Creates ./replayhaven with compose.yaml and .env from the latest release, starts the server and
# prints a one-time setup link for the first account. Running it again updates to the latest
# release and keeps .env. Optional environment variables:
#
#   REPLAYHAVEN_DIR            install directory (default: ./replayhaven)
#   REPLAYHAVEN_VERSION        release to install, e.g. 1.1.0 (default: latest)
#   REPLAYHAVEN_PUBLIC_ORIGIN  address people open in the browser (default: detected LAN address)
#   REPLAYHAVEN_HOST_PORT      host port (default: 8787)
#
# setup-server.sh (source checkouts) reuses the functions below: it sources this file with
# REPLAYHAVEN_INSTALL_LIB=1, which skips main.
set -euo pipefail

RH_REPO="SauerExe/ReplayHaven"

say() { printf '%s\n' "$*"; }
fail() {
  printf '\nError: %s\n' "$*" >&2
  exit 1
}

# Answers come from the terminal even when this script is piped into bash. Without a terminal
# (CI, provisioning) every question takes its default.
ask() {
  local prompt="$1" default="$2" answer=""
  if (: </dev/tty) 2>/dev/null; then
    printf '%s [%s]: ' "$prompt" "$default" >/dev/tty
    IFS= read -r answer </dev/tty || answer=""
  fi
  printf '%s' "${answer:-$default}"
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    say 'ReplayHaven runs in Docker. Install Docker Engine and the Compose plugin first:'
    say '  https://docs.docker.com/engine/install/'
    say 'Then run this command again.'
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    say 'Docker is installed, but this user cannot reach it (or the Docker service is not running).'
    say 'Start Docker, or run the command again with sudo in front of bash.'
    exit 1
  fi
}

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 2 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    fail 'Neither curl nor wget is installed.'
  fi
}

fetch_text() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 3 "$1" 2>/dev/null
  else
    wget -q -T 3 -O - "$1" 2>/dev/null
  fi
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    openssl dgst -sha256 -r "$1" | awk '{print $1}'
  fi
}

# Checks each file against the release's SHA256SUMS.txt (catches broken or partial downloads).
verify_sums() {
  local dir="$1" file expected
  shift
  for file in "$@"; do
    expected="$(awk -v f="$file" '$2 == f || $2 == "*" f { print $1 }' "$dir/SHA256SUMS.txt")"
    [[ -n "$expected" ]] || fail "SHA256SUMS.txt has no entry for $file."
    [[ "$(sha256_of "$dir/$file")" == "$expected" ]] || fail "Checksum mismatch for $file."
  done
}

random_key() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
  else
    head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

detect_ip() {
  local ip=""
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')" || true
  if [[ -z "$ip" ]] && command -v ip >/dev/null 2>&1; then
    ip="$(ip -4 route get 1.1.1.1 2>/dev/null |
      awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }')" || true
  fi
  if [[ -z "$ip" && "$(uname -s)" == Darwin ]]; then
    ip="$(ipconfig getifaddr en0 2>/dev/null)" || true
  fi
  [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || ip="localhost"
  printf '%s' "$ip"
}

# The value of NAME in ./.env (last assignment wins, surrounding quotes removed).
env_value() {
  [[ -f .env ]] || return 0
  sed -n "s/^$1=//p" .env | tail -n 1 | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

# Writes ./.env with a new access key, the browser address and the host port. With a template
# (env.example) every documented option stays in the file, commented out.
create_env() {
  local template="$1" port="${REPLAYHAVEN_HOST_PORT:-8787}" origin key
  origin="${REPLAYHAVEN_PUBLIC_ORIGIN:-}"
  if [[ -z "$origin" ]]; then
    origin="$(ask 'Address you will open ReplayHaven at' "http://$(detect_ip):${port}")"
  fi
  origin="${origin%/}"
  if [[ ! "$origin" =~ ^https?://[A-Za-z0-9.:_-]+$ ]]; then
    fail "Invalid address \"$origin\". Expected something like http://192.168.1.10:$port"
  fi
  key="$(random_key)"
  [[ ${#key} -ge 24 ]] || fail 'Could not generate an access key.'
  (
    umask 077
    if [[ -n "$template" && -f "$template" ]]; then
      awk -v key="$key" -v origin="$origin" -v port="$port" '
        /^REPLAYHAVEN_ACCESS_TOKEN=/ { print "REPLAYHAVEN_ACCESS_TOKEN=" key; k = 1; next }
        /^REPLAYHAVEN_PUBLIC_ORIGIN=/ { print "REPLAYHAVEN_PUBLIC_ORIGIN=" origin; o = 1; next }
        /^REPLAYHAVEN_HOST_PORT=/ { print "REPLAYHAVEN_HOST_PORT=" port; p = 1; next }
        { print }
        END {
          if (!k) print "REPLAYHAVEN_ACCESS_TOKEN=" key
          if (!o) print "REPLAYHAVEN_PUBLIC_ORIGIN=" origin
          if (!p) print "REPLAYHAVEN_HOST_PORT=" port
        }
      ' "$template" >.env.tmp
    else
      printf 'REPLAYHAVEN_ACCESS_TOKEN=%s\nREPLAYHAVEN_PUBLIC_ORIGIN=%s\nREPLAYHAVEN_HOST_PORT=%s\n' \
        "$key" "$origin" "$port" >.env.tmp
    fi
    mv .env.tmp .env
  )
  grep -q "^REPLAYHAVEN_ACCESS_TOKEN=$key\$" .env || fail 'Could not write .env.'
  say "Created .env (access key and address $origin)."
}

# Waits for the server, then prints where to open it: the setup link while no account exists.
report_ready() {
  local port origin key state="" tries=0
  port="$(env_value REPLAYHAVEN_HOST_PORT)"
  port="${port:-8787}"
  origin="$(env_value REPLAYHAVEN_PUBLIC_ORIGIN)"
  origin="${origin%%,*}"
  origin="${origin:-http://localhost:$port}"
  key="$(env_value REPLAYHAVEN_ACCESS_TOKEN)"
  printf 'Waiting for the server'
  while [[ $tries -lt 60 ]]; do
    state="$(fetch_text "http://127.0.0.1:$port/api/auth/state")" && break
    state=""
    tries=$((tries + 1))
    printf '.'
    sleep 2
  done
  printf '\n\n'
  if [[ -z "$state" ]]; then
    say "The server did not answer on port $port yet. Check it with: docker compose logs replayhaven"
    say "Then open $origin"
  elif [[ "$state" == *'"setupRequired":true'* ]]; then
    say 'ReplayHaven is running. Open this link to create your admin account:'
    say ''
    if [[ -n "$key" ]]; then say "  $origin/#setup-key=$key"; else say "  $origin"; fi
    say ''
    say 'The link contains the access key from .env: only share it with yourself.'
  else
    say "ReplayHaven is running: $origin"
  fi
  say 'Pair your gaming PC under Settings → Recording PCs.'
}

main() {
  local version="${REPLAYHAVEN_VERSION:-latest}" dir="${REPLAYHAVEN_DIR:-$PWD/replayhaven}"
  local base tmp file
  if [[ "$version" == latest ]]; then
    base="https://github.com/$RH_REPO/releases/latest/download"
  else
    base="https://github.com/$RH_REPO/releases/download/v${version#v}"
  fi
  # For mirrors and tests: a directory URL that holds the release assets.
  base="${REPLAYHAVEN_RELEASE_URL:-$base}"

  say ''
  say 'ReplayHaven · server installer'
  say ''
  require_docker
  mkdir -p "$dir"
  cd "$dir"
  say "Directory: $PWD"

  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064 # expand now: tmp is local to main
  trap "rm -rf '$tmp'" EXIT
  say "Downloading the release files ($version) …"
  for file in SHA256SUMS.txt compose.yaml env.example; do
    download "$base/$file" "$tmp/$file" || fail "Could not download $base/$file"
  done
  verify_sums "$tmp" compose.yaml env.example
  if [[ -f compose.yaml ]] && ! cmp -s compose.yaml "$tmp/compose.yaml"; then
    cp compose.yaml compose.yaml.bak
    say 'Replaced compose.yaml (your previous one is in compose.yaml.bak).'
  fi
  cp "$tmp/compose.yaml" compose.yaml
  cp "$tmp/env.example" env.example
  mkdir -p release

  if [[ -f .env ]]; then
    say 'Keeping your existing .env (access key and address).'
  else
    create_env env.example
  fi

  say 'Pulling and starting the server …'
  docker compose pull </dev/null
  docker compose up -d </dev/null
  report_ready
}

if [[ "${REPLAYHAVEN_INSTALL_LIB:-0}" != 1 ]]; then
  main "$@"
fi
