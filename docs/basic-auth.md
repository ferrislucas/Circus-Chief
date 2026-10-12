# Basic Authentication (`--auth` / `--auth-file`)

Circus Chief serves its HTTP API, WebSocket, and production frontend with no
authentication by default (local-first). Pass `--auth` to gate everything
behind HTTP Basic auth backed by an htpasswd-compatible credential file.

## Setup

```bash
# 1. Create the credential file (prompts for a password; bcrypt, cost 10-12).
#    Use htpasswd (Apache utils), or any tool that emits $2b$/$2y$ hashes.
htpasswd -cB ~/.circuschief/.htpasswd admin   # -c = create, omit to add users
chmod 600 ~/.circuschief/.htpasswd

# 2. Launch with auth enabled (uses the default file above)
circuschief --auth

# Custom path (implies --auth) — e.g. Docker volumes, shared config dirs
circuschief --auth-file /run/secrets/circuschief.htpasswd
```

File format: one `user:bcrypt-hash` line per user. Blank lines and `#`
comments are ignored. Multi-user works (one line each); there are no roles.
Only `$2b$`/`$2y$` hashes are accepted; any malformed line fails startup
rather than half-protecting the server.

Docker example:

```dockerfile
COPY circuschief.htpasswd /run/secrets/circuschief.htpasswd
CMD ["circuschief", "--host", "0.0.0.0", "--auth-file", "/run/secrets/circuschief.htpasswd"]
```

## Behavior

- **Off by default.** The file's presence alone does nothing; if it exists
  but no flag was given, the server logs a warning and serves open.
- **Fail-closed.** Flag given but the file is missing, unreadable, or
  malformed → the server exits 1 before opening the database or listening.
  It never silently serves open when auth was requested.
- **Coverage.** Every REST route, the `/ws` WebSocket upgrade (checked at
  upgrade time), and the production static frontend require credentials.
  Wrong password and unknown user get byte-identical `401`s.
- **Exemption.** `GET /api/server-info` stays open so `scripts/pw.sh` and
  worktree tooling can probe which server instance owns a port without
  knowing its auth state. Everything else is gated.
- **Rotation.** The file is watched: password/user changes apply without a
  restart (HTTP and WebSocket share the same loader). Turning auth on/off
  requires a relaunch. Disable by relaunching without the flag.
- **Frontend.** On a `401` the UI shows a login form. Credentials live in
  memory only (never `localStorage`); a reload re-prompts. The WebSocket
  URL carries the credentials because `new WebSocket()` cannot set headers.
- **Permissions.** `chmod 600` the file; looser permissions log a warning.

## Security notes

- **Pair with TLS beyond localhost.** Basic sends base64 (reversible)
  credentials with every request — visible to network sniffers without
  HTTPS. See `--ssl-cert`/`--self-signed` in the README.
- No rate limiting or lockout in v1: this is a single-user/small-team gate,
  not internet-facing login. Do not expose an authed server directly to the
  internet without a reverse proxy providing TLS (and ideally its own
  throttling).
