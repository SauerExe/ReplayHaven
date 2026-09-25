# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private
vulnerability reporting ("Security" tab → "Report a vulnerability") on this repository.
You should get a first response within a week.

## Scope and threat model

ReplayHaven is a personal archive for your home network. Its security model is intentionally
simple:

- Access requires an account. Creating the first account needs the access key
  (`REPLAYHAVEN_ACCESS_TOKEN`), so nobody else can claim a freshly exposed server. Each browser
  signs in with name and password (or a one-time QR code valid for five minutes) and gets its
  own HttpOnly session cookie (30 days, renewed on use). Passwords are stored as scrypt hashes,
  session and device tokens only as SHA-256 hashes. Failed sign-ins are throttled.
- Recording PCs pair by request: the client shows a six-digit code, the owner approves the
  matching request in the web UI, and the PC receives its own bearer token, stored encrypted
  with the Windows user account. Every session and PC can be revoked under Geräte. Paired PCs
  cannot manage accounts or devices.
- The access key keeps working as a bearer token for older clients and scripts.
- API requests must come from `REPLAYHAVEN_PUBLIC_ORIGIN`; other origins are rejected.
- There are no roles or public share links yet; the account can see and manage everything.
  "Share" in the UI is a local preview only.
- The server binds to loopback unless an access key of at least 24 characters is set.

Expose the server to the internet only behind HTTPS (reverse proxy) or a VPN. Reports about
bypassing the access key, path traversal in uploads or downloads, or unsafe handling of media
files are especially welcome.
