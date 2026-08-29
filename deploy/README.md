# City Front Production Deployment

## Prerequisites

- Ubuntu/Debian server with Node.js 20 or newer.
- `game.example.com` replaced by a domain already resolving to the server.
- Only TCP 22, 80 and 443 exposed publicly. The application binds to `127.0.0.1:7460` behind the proxy.
- `/home/chenyifan/apps/city-front` reserved for this application.

## Release

Run from the project directory after a fresh Cocos Creator 3.8.7 Web Desktop build:

```bash
DEPLOY_HOST=175.178.194.44 DEPLOY_USER=chenyifan ./deploy/deploy-release.sh
```

The script creates a timestamped release, installs production dependencies with `npm ci --omit=dev`, verifies `ws`, and atomically updates the `current` symlink. It does not install system packages or restart unrelated services.

## Process manager

Preferred systemd installation:

```bash
sudo cp deploy/systemd/city-front.service /etc/systemd/system/city-front.service
sudo mkdir -p /home/chenyifan/apps/city-front/shared
sudo cp deploy/city-front.env.example /home/chenyifan/apps/city-front/shared/city-front.env
sudo systemctl daemon-reload
sudo systemctl enable --now city-front
sudo systemctl status city-front --no-pager
```

Without sudo, use `ecosystem.config.cjs` with PM2.

## HTTPS and WSS

Caddy is the simplest option because it obtains and renews TLS certificates automatically:

```bash
sudo GAME_DOMAIN=game.example.com caddy run --config /home/chenyifan/apps/city-front/current/deploy/Caddyfile
```

For Nginx, replace every `GAME_DOMAIN` in `deploy/nginx/city-front.conf`, obtain the certificate, run `nginx -t`, then reload. `/rooms` must retain the WebSocket Upgrade headers.

Set the exact public origin in the shared environment file:

```text
ALLOWED_ORIGINS=https://game.example.com
```

## Firewall and health

Example UFW policy:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw deny 7460/tcp
sudo ufw enable
```

Apply the equivalent rules in the cloud security group. Verify after every release:

```bash
curl --fail http://127.0.0.1:7460/healthz
curl --fail https://game.example.com/healthz
journalctl -u city-front -n 100 --no-pager
```

Do not report HTTPS/WSS deployment as complete until the public domain, TLS certificate, two-browser room test and host-migration test all pass.
