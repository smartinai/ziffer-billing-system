# Ziffer repository guide

This file applies to the entire repository. A more deeply nested `AGENTS.md`, if one is added later, overrides it for that subtree.

## What this application is

Ziffer is an internal billing and reporting application built with:

- React and Vite in `src/`
- Node.js in `server/`
- PostgreSQL 17 with ordered SQL migrations in `migrations/`
- Playwright browser tests in `e2e/`
- Docker Compose, Caddy, and the Infomaniak VPS for production
- Teamwork as the time-entry source and Xero as the accounting destination

Read `README.md`, `CHANGELOG.md`, `VERSIONING.md`, and the relevant file under `docs/` before changing deployment, database, billing, or integration behavior.

## First inspection

Before editing:

1. Run `git status --short`.
2. Treat all existing modifications and untracked files as user-owned.
3. Inspect the smallest relevant code and tests; do not rewrite unrelated areas.
4. Check for a nested `AGENTS.md` in the directory being changed.
5. Never print, copy, or commit secrets from `.env`, VPS files, database dumps, or integration tokens.

Use `rg` and `rg --files` for repository searches.

## Local setup and restart

Install Node.js 22 LTS and dependencies:

```powershell
npm install
npm run db:local:start
npm run db:migrate
```

The normal local app at `http://127.0.0.1:3000/` is served by `server/index.js` from the built `dist/` bundle. Frontend changes will not appear there until `npm run build` finishes.

For a clean local restart:

```powershell
npm run db:local:start
npm run db:migrate
npm run build
npm start
```

Run `npm start` in a dedicated terminal when possible. If port 3000 is already occupied, identify and stop only its owning process before restarting:

```powershell
$listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
$listener | Select-Object LocalAddress, LocalPort, OwningProcess
if ($listener) { Stop-Process -Id $listener.OwningProcess }
npm start
```

Do not broadly kill every Node process; other Codex tasks or applications may be using them.

Useful checks:

```powershell
npm run db:local:status
Invoke-RestMethod http://127.0.0.1:3000/api/health/live
Invoke-RestMethod http://127.0.0.1:3000/api/health/ready
```

For split development with Vite hot reload, use `npm run dev` and open the Vite URL on port 5173. Do not confuse it with the built app on port 3000.

## Development expectations

- Keep frontend components, domain calculations, repositories, and routes focused. Extract reusable behavior instead of expanding already large files.
- Preserve existing public API paths unless a coordinated breaking change was explicitly requested.
- Keep dates, currency, hours, and rounding consistent with the shared formatters and billing calculations.
- Prefer one authoritative calculation/projection path for editor totals, annual/prepaid allocation, Xero preview, and Xero sending.
- Preserve accessibility: keyboard operation, focus visibility, dialog labels, error feedback, and scroll behavior.
- Add or update tests with every behavior change.
- Do not silently alter existing drafts, archived documents, or sent-document snapshots when changing future-generation logic.

## Database rules

- Add schema changes as the next ordered, additive SQL migration in `migrations/`.
- Never edit a migration that may already have run in another environment.
- Keep older application versions compatible with additive migrations; destructive cleanup belongs in a later expand-and-contract release.
- Test migrations locally with `npm run db:migrate`.
- Never mutate the live database, restore a dump, or remove production data unless the user explicitly authorizes that exact operation.
- A deployment must create and validate its pre-deploy backup before applying migrations.
- Database restore is for corruption or data loss, not routine application rollback.

Local Teamwork data can be imported with `npm run db:import-teamwork-store`. Do not commit local data files or database storage.

## Billing and integration invariants

Changes in these areas require extra care:

- Teamwork source entries are evidence. Draft-level overrides must not rewrite their underlying hours or task data unless the feature explicitly calls the Teamwork API.
- Client/project exclusion continues to control reporting inclusion.
- Existing draft locks, editor sessions, optimistic versions, serialized autosave, archive/restore, and read-only sent states must remain intact.
- Annual/prepaid usage must be applied exactly once. Source hours must reconcile to invoiceable, prepaid, and unbillable allocations.
- Draft totals, Xero preview totals, and the actual Xero payload must come from the same server-side projection and rounding rules.
- Xero sending must retain its durable idempotency and reconciliation lifecycle. Never add a second direct-send path.
- Definite Xero rejections may unlock a draft; ambiguous sends must remain protected until reconciled.
- Existing drafts and sent documents retain snapshotted rates. Client-rate changes affect reporting and newly generated drafts only.
- Credentials, OAuth tokens, encryption keys, SMTP details, and backup passwords stay outside Git.

Use mocks in automated tests. Never send automated CI documents to the production Xero tenant.

## Validation

Run the smallest relevant checks while developing, then the appropriate gate before handoff:

```powershell
npm run lint
npm test
npm run build
```

The standard combined gate is:

```powershell
npm run check
```

For browser-sensitive work:

```powershell
npm run db:seed-e2e
npm run test:e2e
```

Use `npm run test:visual` when layout or visual regressions are material. Browser-test important UI changes against the built port-3000 app as well as automated tests. Report any skipped or failing check plainly.

For migrations, verify both a blank database path and a restored-database path when the available CI or operations scripts support it. Billing or Xero changes also require the relevant reconciliation tests and, before production, the approved Xero demo-company workflow where applicable.

## Versioning and changelog

`package.json` is the canonical version source. Follow `VERSIONING.md`:

- Patch: bug fix or internal improvement without a new user capability.
- Minor: backward-compatible feature or meaningful workflow improvement.
- Major: coordinated breaking API, data, deployment, or workflow change.

Add user-facing work under `## [Unreleased]` in `CHANGELOG.md`. Prepare releases only when requested:

```powershell
npm run release:patch
npm run release:minor
npm run release:major
```

These commands edit release files only; they do not commit, tag, push, or deploy.

## Production deployment

Deploy only when explicitly requested. Do not deploy an arbitrary dirty workspace.

The approved path is `.github/workflows/deploy-production.yml` using the protected `production` environment and an exact commit or tag. The workflow runs checks, connects to the VPS, invokes `ops/deploy.sh`, waits for readiness, runs the production Playwright smoke test, and rolls back the application image when smoke testing fails.

Before deployment:

1. Confirm the intended diff and that unrelated local changes are excluded.
2. Update `CHANGELOG.md` and prepare the requested semantic version.
3. Run `npm run check` plus relevant Playwright and migration tests.
4. Commit and push the exact reviewed state.
5. Deploy that commit or tag through the GitHub production workflow.

Do not manually bypass `ops/deploy.sh`. It supplies the deployment lock, validated pre-deploy backup, image tagging, tests, migration preflight, readiness checks, operation recording, and image retention.

Use `.github/workflows/rollback-production.yml` for a normal rollback to a prior compatible image. Do not reverse additive migrations during an application rollback.

After deployment verify:

- `https://app.ziffer.lu/api/health/live`
- `https://app.ziffer.lu/api/health/ready`
- login and the changed workflow
- Operations and Audit Log status
- relevant Teamwork or Xero behavior without creating unintended production documents

Operational details live in `docs/OPERATIONS_RUNBOOK.md` and VPS security requirements in `docs/VPS_DEPLOYMENT_SECURITY.md`.

## Handoff

Finish with a concise, evidence-based handoff:

- outcome and user-visible behavior;
- files changed;
- migrations or configuration required;
- tests/build/browser checks run and their results;
- whether the local app was restarted;
- whether anything was committed, pushed, or deployed;
- remaining risks or user input needed.

Link to changed files with absolute paths when responding in Codex Desktop. Never claim a restart, test, push, migration, or deployment succeeded without verifying it.
