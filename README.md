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
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
SESSION_SECRET=replace-with-a-long-random-secret-before-vps
```

6. Build and start the dashboard:

```bash
npm run build
npm start
```

7. Open `http://127.0.0.1:3000/`.

8. Sign in with the local admin account and click `Sync Teamwork` before a live-data demo on a new computer. The first full sync can take a few minutes.

## Data Handling

- `.env` is local only and must not be committed.
- Stored Teamwork data lives in `data/teamwork-store.json` and is local only.
- Use the dashboard's `Sync Teamwork` button to refresh stored Teamwork data on each computer.
- GitHub contains the app code only, not Teamwork credentials or live Teamwork data.

## Checks

```bash
npm test
npm run build
npm run test:visual
```
