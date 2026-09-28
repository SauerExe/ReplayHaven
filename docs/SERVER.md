# Running the server

Node.js 24, Fastify, SQLite and FFmpeg in one container. The process runs as an unprivileged user behind `tini`. The AI setting defaults to `none`: the Windows client delivers the analysis results, so the server needs neither a GPU nor a model.

## Install

On a host with Docker Engine and the Compose plugin:

```bash
curl -fsSL https://github.com/SauerExe/ReplayHaven/releases/latest/download/install.sh | bash
```

The installer creates `./replayhaven` (or `$REPLAYHAVEN_DIR`), downloads `compose.yaml` and `env.example` from the release and checks them against its `SHA256SUMS.txt`, writes `.env` with a new access key and the address you confirm, runs `docker compose pull` and `docker compose up -d`, waits for the server and prints a setup link. It does not install Docker. Without a terminal (for example from a provisioning script) it takes the suggested defaults. Options go in front of `bash` as environment variables: `REPLAYHAVEN_VERSION=1.1.0` pins a release, `REPLAYHAVEN_PUBLIC_ORIGIN` skips the address question, `REPLAYHAVEN_HOST_PORT` changes the port. Running it again updates: it keeps `.env`, replaces `compose.yaml` (a changed one is kept as `compose.yaml.bak`), pulls the new image and restarts.

The setup link looks like `http://192.168.1.10:8787/#setup-key=<access key>`. The key sits in the URL fragment, which browsers do not send to the server or through a proxy; the sign-in page fills it in and removes it from the address bar. The link only works while the server has no account; after that the server refuses a second setup. Until then the server also prints the link to its log (`docker compose logs replayhaven`), built from the first `REPLAYHAVEN_PUBLIC_ORIGIN`, which helps in Coolify, Unraid and other panels. That log line contains the access key, so treat the logs like `.env`.

By hand instead: download `compose.yaml` and `env.example` from the [latest release](https://github.com/SauerExe/ReplayHaven/releases/latest), save `env.example` as `.env`, set `REPLAYHAVEN_ACCESS_TOKEN` (`openssl rand -hex 24`) and `REPLAYHAVEN_PUBLIC_ORIGIN`, then run `docker compose up -d`. From a source checkout, `bash setup-server.sh` builds the image and starts it (`--pull` uses the published image instead).

## Files in the server directory

| File              | Purpose                                                                           |
| ----------------- | --------------------------------------------------------------------------------- |
| `compose.yaml`    | Starts the image `ghcr.io/sauerexe/replayhaven` with a data volume and port 8787  |
| `.env`            | Your settings: access key, browser address, optionally image and AI provider      |
| `.env.example`    | Template listing every variable                                                   |
| `setup-server.sh` | Source checkouts: creates `.env`, builds the image and starts the server          |
| `release/`        | Optional: `ReplayHaven-Client-Setup.exe` for downloading straight from the server |

Compose reads `.env` automatically. Every variable in it also reaches the container.

## Day-to-day operation

```bash
# First start, or after changing .env
docker compose up -d

# Update an installer setup: run the installer again in the parent directory
# (the compose.yaml of a release is pinned to that release's image)
curl -fsSL https://github.com/SauerExe/ReplayHaven/releases/latest/download/install.sh | bash

# Update with the compose.yaml from the repository, which follows major version 1 (image tag :1)
docker compose pull && docker compose up -d

# Update from source (run git pull first)
bash setup-server.sh

# Forgot your password? List the accounts and set a new random password for one
docker exec -it replayhaven node server-bundle/admin.mjs users
docker exec -it replayhaven node server-bundle/admin.mjs reset-password <name>

# Removed clips keep their files until you purge them (first without --yes to see the size)
docker exec -it replayhaven node server-bundle/admin.mjs purge-removed
docker exec -it replayhaven node server-bundle/admin.mjs purge-removed --yes

# Status and logs
docker compose ps
docker compose logs --tail=100 -f

# Restart or stop without deleting data
docker compose restart
docker compose stop
```

`REPLAYHAVEN_PUBLIC_ORIGIN` must match the address browsers actually use, including scheme and port. Requests from other origins are rejected with 403.

## Network and access

Port 8787 is meant for your home network. To reach the server from outside, use a VPN or an HTTPS reverse proxy; [Deploy behind Coolify/Traefik](#deploy-behind-coolifytraefik) covers the proxy settings (public origin, trusted proxy, 2 GB uploads, 30-minute requests).

Only signed-in users get in. On first visit you create an account; for this one step the server asks for the access key from `.env` (the setup link fills it in), so nobody else can create the first account on a server that is already reachable. After that every device signs in with name and password or by QR code and gets its own session (HttpOnly cookie, 30 days, extended while in use). Recording PCs pair by sending a request that an admin approves under **Settings → Recording PCs**; from then on they send their own credential as a bearer token. Any session can be revoked under **Settings → Devices** (browsers and phones) or **Settings → Recording PCs** (PCs). Once the first account exists, the access key opens nothing any more; scripts pair like a PC (`npm run agent -- --pair`). Roles and single sign-on are described in [Users and roles](#users-and-roles) and [Sign in with Authelia (OIDC)](#sign-in-with-authelia-oidc). There are no public share links yet. Failed sign-ins are throttled per address after 20 attempts within 15 minutes (behind a proxy, set `REPLAYHAVEN_TRUST_PROXY` so the real address counts). The database only stores scrypt hashes of passwords and SHA-256 hashes of credentials.

## Users and roles

Every account has one of two roles:

| Role    | Can do                                                                                                                                                                                 |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`  | Watch the archive (clips, games, thumbnails, video, downloads, status), manage its own password, sessions and QR logins, link or unlink its own single sign-on                         |
| `admin` | Everything above, plus upload from the browser, edit/delete/re-analyse clips, analysis settings, game info refresh, approve or deny PC pairing, manage users and other users' sessions |

The first account on a server is always an admin. Accounts created before roles existed are migrated automatically: the first one becomes admin. Admins manage accounts under **Settings → Users** (`/settings/users`): create an account (name, password, role), change the role, disable/enable, reset the password (signs that user's browsers out), sign a user out everywhere, or delete an account. You cannot disable or delete yourself, and the server never lets the last active admin be demoted, disabled or deleted.

A paired recording PC keeps its rights to upload, report its heartbeat and deliver client analysis results; it belongs to the admin who approved it and stops working when that account is disabled or deleted. The access key (`REPLAYHAVEN_ACCESS_TOKEN` as bearer token) acts as admin only while no account exists, that is, to set the server up. Forbidden requests are answered with `403` and an English error message.

## Portainer

In Portainer open **Stacks → Add stack → Repository**, enter `https://github.com/SauerExe/ReplayHaven` with the compose path `compose.yaml`, and add the environment variables `REPLAYHAVEN_ACCESS_TOKEN` (`openssl rand -hex 24`) and `REPLAYHAVEN_PUBLIC_ORIGIN` (the address you open in the browser, for example `http://192.168.1.20:8787`). After the first start, the container log shows the setup link for the first account.

`portainer-template.json` describes the same stack as an app template for template collections such as [Lissy93/portainer-templates](https://github.com/Lissy93/portainer-templates).

## Deploy behind Coolify/Traefik

**Quickest way:** in Coolify create a resource from this repository with the build pack **Docker Compose** and the compose file `docker-compose.coolify.yml`. Coolify generates the domain and the access key (shown under **Environment Variables**), routes HTTPS to port 8787 and keeps the archive volume; the server log prints the setup link. Step 4 below (upload timeout) still applies. This file has not been verified on every Coolify version; if it does not deploy, use the manual way.

**By hand:** ReplayHaven runs well as a Docker Compose resource in [Coolify](https://coolify.io), with Coolify's Traefik terminating HTTPS:

1. Create a new resource from this repository (or paste `compose.yaml`) and remove the `ports:` section (outside Coolify: `ports: !reset []` in `compose.override.yaml`), so the plain-HTTP port is not published; Traefik reaches the container over the Docker network.
2. Give the `replayhaven` service the domain `https://clips.example.com:8787`. The `:8787` only tells Coolify which container port to route to; people still open `https://clips.example.com`.
3. Set the environment variables in Coolify:

   ```env
   REPLAYHAVEN_ACCESS_TOKEN=<openssl rand -hex 24>
   REPLAYHAVEN_PUBLIC_ORIGIN=https://clips.example.com
   REPLAYHAVEN_TRUST_PROXY=true
   ```

   `REPLAYHAVEN_PUBLIC_ORIGIN` may list further origins separated by commas (for example a LAN address `http://192.168.1.10:8787`); the first entry is canonical and is used for the single sign-on redirect URI and QR login links. When it starts with `https://`, session cookies are marked `Secure`. `REPLAYHAVEN_TRUST_PROXY=true` makes the server take protocol and client address from Traefik's `X-Forwarded-*` headers; only use `true` when the container port is not reachable directly, otherwise list the proxy addresses (for example `10.0.0.0/8`).

4. Large uploads: the server accepts clips up to 2 GB and requests up to 30 minutes. Traefik v3 cuts request bodies after 60 seconds by default (`respondingTimeouts.readTimeout`), which breaks big uploads on slow lines. In Coolify open **Servers → Proxy** and add to the Traefik command:

   ```yaml
   - '--entrypoints.https.transport.respondingTimeouts.readTimeout=30m'
   ```

   Traefik does not limit the body size unless a buffering middleware is configured. The server keeps idle connections open for 120 s, longer than Traefik's 90 s idle timeout, so Traefik never reuses a connection that is just being closed.

5. Keep the `archive` volume (Coolify shows it under **Storages**) in your backups.

The same applies to Caddy or nginx: forward to port 8787, allow 2 GB bodies and 30-minute requests (for nginx `client_max_body_size 2g; proxy_read_timeout 1800s; proxy_request_buffering off;`) and set `REPLAYHAVEN_TRUST_PROXY`.

## Playback over the internet

Recordings from the NVIDIA App are often H.264 at 1080p120 and around 50 Mbit/s, too much to stream over a typical upload line. With `REPLAYHAVEN_PLAYBACK=web` (default) the server therefore creates a web rendition for every clip above 12 Mbit/s, above 60 fps or wider than 1920 px: H.264 High profile, at most 1920 px wide, at most 60 fps, CRF 23 capped at 8 Mbit/s, AAC 160 kbit/s (all audio tracks mixed), keyframes every two seconds and `+faststart`. FFmpeg runs with two threads and a lowered CPU priority.

- A heavy upload first gets a quick remux (no re-encoding) so it can be watched immediately; the rendition follows in the background.
- Lighter clips are only remuxed when needed (index at the end of the file, another container, several audio tracks); otherwise the original is played as it is.
- Existing clips are converted by a background backfill, one clip at a time and only while no upload is being processed. Progress is shown in `GET /api/status` under `playback` (`pending`, `current`, `done`); after a restart it simply continues. A clip whose rendition fails is skipped and keeps its previous playback file.
- Downloads always deliver the untouched original. Range requests work as before; video and thumbnails may only be cached by the browser (`Cache-Control: private`), and the video URL changes whenever a new rendition replaces the old one.

`REPLAYHAVEN_PLAYBACK=original` keeps the previous behaviour: originals are played directly whenever a browser can.

## Sign in with Authelia (OIDC)

ReplayHaven supports single sign-on through any OpenID Connect provider (Authelia, Authentik, Keycloak, Pocket ID …) with the authorization code flow and PKCE. The login screen then shows **Sign in with &lt;name&gt;**.

| Variable                         | Meaning                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REPLAYHAVEN_OIDC_ISSUER`        | Issuer URL exactly as in the provider's `/.well-known/openid-configuration`, e.g. `https://auth.example.com`                                                                                                                                                                                                                                                           |
| `REPLAYHAVEN_OIDC_CLIENT_ID`     | Client ID registered at the provider                                                                                                                                                                                                                                                                                                                                   |
| `REPLAYHAVEN_OIDC_CLIENT_SECRET` | Client secret in plain text (sent with `client_secret_basic`); leave empty for a public client                                                                                                                                                                                                                                                                         |
| `REPLAYHAVEN_OIDC_NAME`          | Button label, default `Single sign-on`                                                                                                                                                                                                                                                                                                                                 |
| `REPLAYHAVEN_OIDC_SCOPES`        | Default `openid profile email groups`                                                                                                                                                                                                                                                                                                                                  |
| `REPLAYHAVEN_OIDC_ADMIN_GROUP`   | Members of this group (claim `groups`) become admins when they sign in. Leaving the group does not demote anyone; change the role by hand                                                                                                                                                                                                                              |
| `REPLAYHAVEN_OIDC_AUTO_CREATE`   | Default `false` since 1.1.3: only accounts an admin created or linked get in. `true`: the first sign-in of an unknown person creates an account with role `user` (`admin` when in the admin group; on a server without accounts only admin-group members get in, everyone else uses the setup link first). Turn it on only when your provider decides who may register |
| `REPLAYHAVEN_PASSWORD_LOGIN`     | Default `true`. `false` hides and refuses name + password sign-in; only honoured while OIDC is configured                                                                                                                                                                                                                                                              |

The redirect URI is `<first REPLAYHAVEN_PUBLIC_ORIGIN>/api/auth/oidc/callback`, for example `https://clips.example.com/api/auth/oidc/callback`. State, nonce and PKCE verifier travel in a signed, HttpOnly cookie that is valid for 10 minutes. Identities are linked to accounts by issuer and subject (`sub`), so renaming someone at the provider does not create a new account. After a successful sign-in the normal session cookie is set; failures return to the login screen with a readable message.

Example for Authelia 4.38 or newer (`configuration.yml`):

```yaml
identity_providers:
  oidc:
    # hmac_secret and jwks as described in the Authelia documentation.
    clients:
      - client_id: 'replayhaven'
        client_name: 'ReplayHaven'
        # Generate with: authelia crypto hash generate pbkdf2 --variant sha512 --random --random.length 72
        # Put the printed hash here and the plain random password into REPLAYHAVEN_OIDC_CLIENT_SECRET.
        client_secret: '$pbkdf2-sha512$310000$REPLACE_WITH_YOUR_HASH'
        public: false
        authorization_policy: 'two_factor'
        require_pkce: true
        pkce_challenge_method: 'S256'
        redirect_uris:
          - 'https://clips.example.com/api/auth/oidc/callback'
        scopes:
          - 'openid'
          - 'profile'
          - 'email'
          - 'groups'
        response_types:
          - 'code'
        grant_types:
          - 'authorization_code'
        token_endpoint_auth_method: 'client_secret_basic'
```

And for ReplayHaven:

```env
REPLAYHAVEN_OIDC_ISSUER=https://auth.example.com
REPLAYHAVEN_OIDC_CLIENT_ID=replayhaven
REPLAYHAVEN_OIDC_CLIENT_SECRET=<the random password printed by authelia crypto hash generate>
REPLAYHAVEN_OIDC_NAME=Authelia
REPLAYHAVEN_OIDC_ADMIN_GROUP=replayhaven-admins
```

Authelia returns groups and profile claims from the UserInfo endpoint; ReplayHaven reads both the ID token and UserInfo. Use `authorization_policy` or Authelia access control rules to decide who may sign in at all.

**Existing local account.** Sign in with your password, open **Settings → Account** and choose **Link**. After the round trip through the provider, your OIDC identity belongs to that account and you can sign in either way. **Unlink** is refused while the account has no password, so nobody locks themselves out.

**Without auto-create** (the default) only known identities get in. An admin prepares an account under **Users** with the person's provider user name and no password; their first OIDC sign-in with exactly that `preferred_username` (same upper and lower case) claims it. The display name or e-mail never claims an account: users can often change those themselves. Only accounts without a password and without a linked identity can be claimed this way.

**Password sign-in off** (`REPLAYHAVEN_PASSWORD_LOGIN=false`): the login screen only shows the single sign-on button. On a fresh server, create the first admin with the setup link from the server log (the setup form stays available until then) and link single sign-on under **Settings → Account**, or let a member of `REPLAYHAVEN_OIDC_ADMIN_GROUP` sign in directly. Paired PCs and QR logins keep working.

## Data and backup

The named Compose volume `archive` contains:

```text
vault.sqlite                   Metadata, settings, devices
clips/<UUID>/original.<ext>    Untouched recording
clips/<UUID>/thumbnail.jpg     Thumbnail
clips/<UUID>/playback.mp4      Optional playback copy
incoming/                      Uploads in progress
covers/                        Game covers from Steam, stored locally
```

For a consistent backup, stop the container, back up the **entire volume**, then start it again:

```bash
docker compose stop
docker run --rm -v replayhaven_archive:/data -v "$PWD":/backup alpine tar -czf /backup/replayhaven-backup.tar.gz -C /data .
docker compose start
```

Keep `.env` somewhere safe as well. `docker compose down` keeps the volume; `down -v` deletes it and is not a normal update step. Library entries you remove keep their originals, and uploading the same content again restores the entry; `admin.mjs purge-removed` deletes them for good (see above).

**Before an update**, take a backup as above: updates only move the database forward, so going back to an older release needs the backup from before. **To restore**, stop the server, unpack the archive into the empty volume and start again:

```bash
docker compose stop
docker run --rm -v replayhaven_archive:/data -v "$PWD":/backup alpine sh -c 'rm -rf /data/* && tar -xzf /backup/replayhaven-backup.tar.gz -C /data'
docker compose start
```

**Changes of your own go into `compose.override.yaml`**, next to `compose.yaml`; Docker Compose merges it automatically, and the installer replaces `compose.yaml` with every update (it refuses to when `compose.yaml` itself was edited). For example, to keep the data in a folder instead of the named volume, or to publish the port only on this machine:

```yaml
# compose.override.yaml
services:
  replayhaven:
    volumes:
      - ./data:/app/vault-data # give the folder UID 1000: chown -R 1000:1000 data
    ports: !override
      - '127.0.0.1:8787:8787'
```

## Windows client download

The download button under **Settings → Recording PCs** points to, in this order:

1. `release/ReplayHaven-Client-Setup.exe`, if the file sits next to `compose.yaml` (mounted read-only).
2. `REPLAYHAVEN_CLIENT_DOWNLOAD_URL`. Published images already contain the matching GitHub release address.

If neither is available, there is no download button.

## Processing

Light H.264 clips in MP4 are played directly; heavy ones get a web rendition (see [Playback over the internet](#playback-over-the-internet)). Other formats get an additional H.264 playback copy made with FFmpeg on the CPU, so HEVC/AV1 clips take extra time and space. A queue limits how much the server processes at once; jobs that were running are picked up again after a restart.

## Automatic game info

For recognised games the server fetches the official name, a short description, genre, release date and cover from Steam. The description is in English by default; with `REPLAYHAVEN_CONTENT_LANGUAGE=de` the server requests the German Steam text instead (`l=german`), and games without one get no description. Descriptions already stored are kept until the next scheduled refresh. No API key is needed. The feature is on by default; `REPLAYHAVEN_GAME_METADATA=0` in `.env` turns off new lookups. After changing it, recreate the container with `docker compose up -d`.

A lookup starts after uploads that carry a game name, after the client or server AI has recognised the game, and after you change a game name by hand. On server start, existing clips are caught up. Only Steam names that match exactly after normalisation are accepted: punctuation, trademark signs and capitalisation may differ, but a merely similar title is not enough. Games that Steam does not list, and short names that differ from the Steam name, keep their current name without made-up metadata.

**IGDB as a second source (optional).** Games that Steam does not list (Valorant, Fortnite, Minecraft and others) can be found through Twitch's [IGDB](https://api-docs.igdb.com/), free for non-commercial use. Create an application at https://dev.twitch.tv/console/apps (redirect URL `http://localhost`, category "Application Integration"), then put the client ID and a new client secret into `.env` as `REPLAYHAVEN_IGDB_CLIENT_ID` and `REPLAYHAVEN_IGDB_CLIENT_SECRET` and recreate the container with `docker compose up -d`. Afterwards **Settings → Game info** can look up all games again. The same rule as for Steam applies: exact name matches only, portrait covers. Descriptions from IGDB are in English.

Requests run one after another in the background. The metadata lives in SQLite and the covers in `covers/`; the browser loads the images from your own server. If there is no portrait cover, the server tries the Steam header image. Info that is already stored is kept when a lookup fails.

An hourly pass checks which lookups are due: network errors and incomplete covers after one hour at the earliest, games without a match after 14 days, complete entries after 30 days. **Settings → Game info** shows the status and match counts. **Update now** starts a lookup for every game in the visible archive right away; removed clips are ignored.

Only the game name (for the search) and the Steam app ID that was found (for details and images) are sent; no clips or analysis results.

## Without Docker

```bash
npm ci
npm run build && npm run server:bundle
REPLAYHAVEN_HOST=0.0.0.0 REPLAYHAVEN_ACCESS_TOKEN=<at-least-24-characters> REPLAYHAVEN_PUBLIC_ORIGIN=http://<host>:8787 \
REPLAYHAVEN_DATA_DIR=/var/lib/replayhaven node server-bundle/index.mjs
```

Set FFmpeg and FFprobe with `REPLAYHAVEN_FFMPEG` and `REPLAYHAVEN_FFPROBE`; without them the server uses the npm packages `ffmpeg-static` and `@ffprobe-installer/ffprobe`.

## Other settings

These apply whether or not you use server-side AI. Add them to `.env` and recreate the container (`docker compose up -d`):

| Variable                       | Meaning                                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `REPLAYHAVEN_CONTENT_LANGUAGE` | `en` (default) or `de`: language of Steam game descriptions and of titles the server-side AI writes                           |
| `REPLAYHAVEN_SUPPORT_BANNER`   | `true` (default) or `false`: whether admins see the tip request in the web library, at most every four days                   |
| `REPLAYHAVEN_LOG_LEVEL`        | `error`, `warn`, `info` (default: server errors and failed sign-ins), `debug` or `silent`; requests themselves are not logged |

## Optional server AI

**Not needed** when you use the Windows client. These interfaces are prepared but have not been tested against a real provider. Add to `.env`:

| Variable                   | Meaning                                                                |
| -------------------------- | ---------------------------------------------------------------------- |
| `REPLAYHAVEN_AI_PROVIDER`  | `none` (default), `local` or `gemini`                                  |
| `REPLAYHAVEN_AI_MODEL`     | Exact model identifier                                                 |
| `REPLAYHAVEN_LOCAL_AI_URL` | Reachable vision chat completions API, e.g. `http://modelhost:8000/v1` |
| `REPLAYHAVEN_LOCAL_AI_KEY` | Optional API key                                                       |
| `GEMINI_API_KEY`           | Key for Gemini analysis, used only when explicitly enabled             |

`local` sends sample frames to a model server you run yourself. `gemini` uploads a downscaled copy of the video to Google and may incur costs. Audio is off at first. Server analysis can then be controlled in the web UI. Uploads that announce a client result keep using the client path.
