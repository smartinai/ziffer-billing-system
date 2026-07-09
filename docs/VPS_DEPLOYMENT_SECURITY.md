# VPS Deployment Security Checklist

Target domain for the first live test: `app.ziffer.lu`.

Use this checklist before putting real Teamwork/Xero data on the VPS.

## 1. VPS Access

- Use Ubuntu LTS on the VPS.
- Keep SSH key-only access.
- Disable password SSH login after confirming key login works.
- Create a non-root deploy user, for example `ziffer`.
- Give that user sudo access only for setup/maintenance.

Example commands on the VPS:

```bash
sudo adduser ziffer
sudo usermod -aG sudo ziffer
sudo mkdir -p /home/ziffer/.ssh
sudo nano /home/ziffer/.ssh/authorized_keys
sudo chown -R ziffer:ziffer /home/ziffer/.ssh
sudo chmod 700 /home/ziffer/.ssh
sudo chmod 600 /home/ziffer/.ssh/authorized_keys
```

Then edit SSH config:

```bash
sudo nano /etc/ssh/sshd_config
```

Set:

```text
PasswordAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
```

Restart SSH:

```bash
sudo systemctl restart ssh
```

Keep the current SSH session open until a new SSH login as `ziffer` has been tested.

## 2. Firewall

Allow only SSH, HTTP, and HTTPS.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

PostgreSQL should not be exposed to the public internet. The production Docker Compose file keeps it inside Docker networking only.

## 3. Docker Runtime

Install Docker Engine and the Docker Compose plugin from Ubuntu packages or Docker's official apt repository.

The production app container runs as the non-root `node` user. Only `/app/data` is writable for the legacy Teamwork JSON cache. PostgreSQL data lives in the `postgres-data` Docker volume.

## 4. Production Environment File

On the VPS, copy `production.env.example` to `.env` and fill in real values.

Never commit `.env`.

Generate long secrets on the VPS:

```bash
openssl rand -base64 48
```

Required production secrets:

- `POSTGRES_PASSWORD`
- `SESSION_SECRET`
- `XERO_TOKEN_ENCRYPTION_KEY`
- `TEAMWORK_API_KEY`
- `XERO_CLIENT_ID`
- `XERO_CLIENT_SECRET`

For `app.ziffer.lu`, keep:

```env
COOKIE_SECURE=true
XERO_REDIRECT_URI=https://app.ziffer.lu/api/xero/callback
XERO_RETURN_URL=https://app.ziffer.lu/#billing-create-quote
```

## 5. DNS And HTTPS

Create a DNS `A` record:

```text
app.ziffer.lu -> VPS IPv4 address
```

The included Caddy service will request and renew HTTPS certificates automatically once DNS points to the VPS.

After DNS is live, add this redirect URI in the Xero developer app:

```text
https://app.ziffer.lu/api/xero/callback
```

## 6. First Deploy

From the repo folder on the VPS:

```bash
cp production.env.example .env
nano .env
docker compose -f docker-compose.production.yml up -d --build postgres
docker compose -f docker-compose.production.yml run --rm app npm run db:migrate
docker compose -f docker-compose.production.yml up -d --build
docker compose -f docker-compose.production.yml ps
```

Then open:

```text
https://app.ziffer.lu/api/health
https://app.ziffer.lu/
```

## 7. Backups

Before live testing with important data, add a daily PostgreSQL backup.

Create a manual backup:

```bash
npm run db:production:backup
```

Backups are written to `backups/` as PostgreSQL custom-format `.dump` files. The `backups/` folder is ignored by Git.

Restore a backup:

```bash
npm run db:production:restore -- backups/ziffer-ziffer_billing-YYYY-MM-DDTHH-MM-SS-mmmZ.dump --yes
```

Restore is destructive: it cleans existing database objects before loading the backup.

Recommended VPS cron entry for a daily backup at 02:15:

```cron
15 2 * * * cd /home/ziffer/ziffer-billing-system && /usr/bin/npm run db:production:backup >> /home/ziffer/ziffer-billing-system/backups/backup.log 2>&1
```

Store backups somewhere outside the VPS as soon as possible. A VPS-local backup is useful for mistakes, but it does not protect against server loss.

## 8. Current App-Side Protection Already Implemented

- Production refuses placeholder/short `SESSION_SECRET`.
- Production refuses placeholder/short `XERO_TOKEN_ENCRYPTION_KEY`.
- Secure cookies are enabled by default in production.
- Login attempts are rate-limited.
- Authenticated write requests require CSRF tokens.
- Security headers are sent by the Express app.
- Audit logging exists for important write actions.
