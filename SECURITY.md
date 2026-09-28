# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private
vulnerability reporting ("Security" tab → "Report a vulnerability") on this repository.
You should get a first response within a week.

## Scope and threat model

ReplayHaven is a personal archive for your home network. This is what protects it today:

- Access requires an account. Creating the first account with a password needs the access key
  (`REPLAYHAVEN_ACCESS_TOKEN`), so nobody else can claim a freshly exposed server. The setup link
  the installer and the server log print carries this key in the URL fragment, which browsers
  never send to the server; treat the log like `.env`. With single sign-on (OIDC), a server without
  accounts only lets members of `REPLAYHAVEN_OIDC_ADMIN_GROUP` in as the first admin; everyone
  else gets the setup link first, so open registration at the provider cannot claim the server.
- Single sign-on creates accounts for unknown identities only with
  `REPLAYHAVEN_OIDC_AUTO_CREATE=true`, and an account an admin prepared is only claimed by the
  exact `preferred_username`, never by a display name or e-mail.
- There are two roles: users can watch the archive; every change to the archive, accounts,
  recording PCs and server settings is for admins.
- Each browser signs in with name and password, single sign-on or a one-time QR code valid for
  five minutes, and gets its own HttpOnly, SameSite=Strict session cookie (30 days, renewed on
  use). Passwords are stored as scrypt hashes (N = 2^17; older hashes are upgraded at the next
  sign-in); session, device, QR and pairing tokens only as SHA-256 hashes. A paired PC's token is
  created when the PC picks it up, so it is never stored in plain text. After 20 failed sign-ins within 15 minutes from one address, sign-in pauses for
  that address only, so nobody can lock out everyone else. Behind a reverse proxy this needs
  `REPLAYHAVEN_TRUST_PROXY`, otherwise all requests share the proxy's address.
- Recording PCs pair in one of two ways, and each gets its own bearer token, stored encrypted
  with the Windows user account:
  - by request: the client shows a six-digit code and an admin approves the matching request in
    the web UI;
  - by link: an admin clicks **Connect this PC**, which creates a one-time ticket (10 minutes)
    and opens `replayhaven://pair?server=…&ticket=…`. The client asks for confirmation and shows
    the server's host before it uses a link that Windows hands over, because any web page can
    open such a link.
- Every browser session and PC can be revoked under **Settings → Devices** and **Settings →
  Recording PCs**. Paired PCs cannot manage accounts or devices.
- The access key only sets the server up: once the first account exists, it is no longer
  accepted anywhere, and the key login of old versions is gone. A setup link in an old log is
  therefore harmless after setup.
- Pairing requests are limited to three open ones per address (twenty in total), so a stranger
  on the network cannot crowd out your own PC.
- Browser requests to the API must come from an origin in `REPLAYHAVEN_PUBLIC_ORIGIN` or from a
  page this server served itself (same host and protocol, for example its LAN address); requests
  from other sites are rejected. Requests without an `Origin` header, such as the client's, need
  a valid session or token.
- There are no public share links yet; "Share" in the UI is a local preview only.
- The server binds to loopback unless an access key of at least 24 characters is set.

Expose the server to the internet only behind HTTPS (reverse proxy) or a VPN. Reports about
bypassing the access key, the pairing flows, path traversal in uploads or downloads, or unsafe
handling of media files are especially welcome.
