# Ziffer Billing System

Local reporting dashboard for stored Teamwork time entries, internal people, projects, billable hours, and calculated EUR amounts.

## Local Setup

1. Install Node.js 22 LTS.
2. Clone the private GitHub repository.
3. Install dependencies:

```bash
npm install
```

4. Copy `.env.example` to `.env`.
5. Fill in the local `.env` values:

```env
TEAMWORK_SITE_NAME=zifferlu.eu
TEAMWORK_API_KEY=replace-with-teamwork-api-key
DATABASE_URL=postgres://ziffer:ziffer_local_password@127.0.0.1:55432/ziffer_billing
DATABASE_SSL=false
SESSION_SECRET=replace-with-a-long-random-secret-before-vps
XERO_TOKEN_ENCRYPTION_KEY=replace-with-a-long-random-secret-before-vps
```

6. Start the local database and apply migrations:

```bash
npm run db:local:start
npm run db:migrate
```

If Docker Desktop is available instead, `docker compose up -d postgres` can be used by changing the `DATABASE_URL` port to `5432`.

To import the current local Teamwork JSON store into PostgreSQL without fetching Teamwork again:

```bash
npm run db:import-teamwork-store
```

7. Build and start the dashboard:

```bash
npm run build
npm start
```

8. Open `http://127.0.0.1:3000/`.

9. Sign in with one of the seeded admin users and click `Sync Teamwork` before a live-data demo on a new computer. The first full sync can take a few minutes.

## Production Secrets

When `NODE_ENV=production`, the server refuses to start unless these are set to long random values:

- `SESSION_SECRET`
- `XERO_TOKEN_ENCRYPTION_KEY`

For HTTPS deployments, cookies are marked secure by default. Keep `COOKIE_SECURE=true` on the VPS.

For VPS deployment, use [docs/VPS_DEPLOYMENT_SECURITY.md](docs/VPS_DEPLOYMENT_SECURITY.md) and copy `production.env.example` to `.env` on the server.

Production monitoring, encrypted off-site backups, restore drills, approved deployments, and rollbacks are documented in [docs/OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md).

## Data Handling

- `.env` is local only and must not be committed.
- `.local-postgres/` is local only and must not be committed.
- Stored Teamwork data lives in `data/teamwork-store.json` and is local only.
- Use the dashboard's `Sync Teamwork` button to refresh stored Teamwork data on each computer. New syncs write to both `data/teamwork-store.json` and PostgreSQL.
- GitHub contains the app code only, not Teamwork credentials or live Teamwork data.

## Checks

```bash
npm run check
npm run db:seed-e2e
npm run test:e2e
```

## Production Safety

Production changes use the GitHub deployment workflow, which creates and validates a local database backup before migrations. Encrypted off-site backups, restore drills, and alert delivery are documented for later activation in [plan.md](plan.md). Do not use the local restore command as a normal application rollback mechanism.
