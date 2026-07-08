# Ziffer Billing System

Local reporting dashboard for stored Teamwork time entries, internal people, projects, billable hours, and calculated EUR amounts.

## Local Setup

1. Install Node.js 18 or newer.
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
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
SESSION_SECRET=replace-with-a-long-random-secret-before-vps
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

9. Sign in with the local admin account and click `Sync Teamwork` before a live-data demo on a new computer. The first full sync can take a few minutes.

## Data Handling

- `.env` is local only and must not be committed.
- `.local-postgres/` is local only and must not be committed.
- Stored Teamwork data lives in `data/teamwork-store.json` and is local only.
- Use the dashboard's `Sync Teamwork` button to refresh stored Teamwork data on each computer. New syncs write to both `data/teamwork-store.json` and PostgreSQL.
- GitHub contains the app code only, not Teamwork credentials or live Teamwork data.

## Checks

```bash
npm test
npm run build
npm run test:visual
```
