# Deployment (production, single VPS)

Status: Phase 1. Backups, monitoring and a hardened WireGuard guide are scheduled for
Phase 8 (see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)).

## Topology

```
phone / laptop ──WireGuard──▶ VPS
                               ├─ TLS terminator (host Caddy/nginx, or nginx with certs)  :443 on the wg0 address
                               └─ docker compose (compose.prod.yaml)
                                    web (nginx, :8080 bound to WEB_BIND_ADDRESS) ──▶ backend ──▶ db (internal network)
```

* Only `web` publishes a port, bound to `WEB_BIND_ADDRESS` (default `127.0.0.1`).
* The `data` network is `internal: true`: PostgreSQL has no route to or from the internet.
* Session cookies are `Secure`, so the UI must be served over **HTTPS** (browsers only
  exempt `localhost`).

## First deployment

1. Install Docker Engine + Compose v2 on the VPS and set up WireGuard (any standard guide;
   peers: your devices). Note the server's WireGuard address, e.g. `10.8.0.1`.
2. Copy the repository to the server, then create `.env` from `.env.example`:
   * strong `POSTGRES_PASSWORD`, fresh `ENCRYPTION_KEYS` (never reuse development keys)
   * `ALLOWED_ORIGINS=https://pos.your-private-domain` (exact origin users will open)
   * `WEB_BIND_ADDRESS=127.0.0.1` when a host TLS proxy forwards to it, or the WireGuard
     address if TLS is handled differently.
   * `chmod 600 .env`
3. Put a TLS-terminating proxy in front of `web`, for example host-level Caddy with a
   certificate for a private name (DNS-01 challenge or an internal CA):

   ```
   pos.your-private-domain {
       bind 10.8.0.1
       reverse_proxy 127.0.0.1:8080
   }
   ```

4. Start: `docker compose -f compose.prod.yaml up -d --build`
   (order: db → migrate → backend → web; migrations run once in the `migrate` container).
5. Create the owner: `docker compose -f compose.prod.yaml exec backend python -m app.cli create-user --email ... --display-name ... --business-workspace "..."`
6. Sign in over the VPN and enroll TOTP immediately.

## Updates

```bash
git pull
docker compose -f compose.prod.yaml up -d --build   # migrate runs before the new backend starts
docker image prune -f
```

Take a database dump before updates that include migrations:

```bash
docker compose -f compose.prod.yaml exec -T db pg_dump -U personal_os -Fc personal_os > backup-$(date +%F).dump
```

Automated, encrypted, restore-verified backups are a Phase 8 deliverable.

## Operations

| Task | Command |
|---|---|
| Status | `docker compose -f compose.prod.yaml ps` |
| Logs (JSON, rotated 5×10 MB per container) | `docker compose -f compose.prod.yaml logs -f backend` |
| Readiness | `curl -s https://pos.your-private-domain/api/v1/system/health` |
| Reset a user's MFA | `docker compose -f compose.prod.yaml exec backend python -m app.cli reset-mfa --email ...` |
| Rotate encryption key | prepend new key to `ENCRYPTION_KEYS`, restart; re-encryption job comes in Phase 2 |

## Resource limits (compose.prod.yaml)

db 512 MB, backend 384 MB, web 64 MB. Containers drop all Linux capabilities (except
Postgres, which needs them to switch users), run as non-root, use read-only root
filesystems where possible and `no-new-privileges`.

## Future: Home Assistant node

A Raspberry Pi or mini PC running Home Assistant joins the same WireGuard network as a
peer. Personal OS will reach its local API over the tunnel (Phase 7); no Home Assistant
port is exposed to the internet.
