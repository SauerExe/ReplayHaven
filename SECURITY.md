# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private
vulnerability reporting ("Security" tab → "Report a vulnerability") on this repository.
You should get a first response within a week.

## Scope and threat model

ReplayHaven is a personal archive for your home network. Its security model is intentionally
simple:

- One shared access key (`REPLAYHAVEN_ACCESS_TOKEN`) protects the whole archive. The browser
  gets a signed, HttpOnly cookie; the Windows client sends the key as a bearer token and
  stores it encrypted with the Windows user account.
- API requests must come from `REPLAYHAVEN_PUBLIC_ORIGIN`; other origins are rejected.
- There are no user accounts, roles or public share links yet. "Share" in the UI is a local
  preview only.
- The server binds to loopback unless an access key of at least 24 characters is set.

Expose the server to the internet only behind HTTPS (reverse proxy) or a VPN. Reports about
bypassing the access key, path traversal in uploads or downloads, or unsafe handling of media
files are especially welcome.
