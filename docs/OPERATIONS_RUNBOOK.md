# Ziffer Production Operations Runbook

## Service and ownership

- Production URL: `https://app.ziffer.lu`
- VPS application directory: `/opt/ziffer-billing-v2`
- Local database backups: `/opt/ziffer-backups/daily`
- Operations state: `/var/lib/ziffer-monitor`
- Logs: `/opt/ziffer-billing-v2/logs`
- Production secrets remain on the VPS. Never copy `.env`, `/etc/ziffer-backup.env`, `/etc/msmtprc`, Xero tokens, or Restic credentials into GitHub or support messages.

The app, PostgreSQL 17, and Caddy run through `docker-compose.production.yml`. A complete VPS or provider outage is not externally monitored by current product decision.

Encrypted off-site backups, restore drills, and alert delivery are currently deferred in [plan.md](../plan.md). Approved deployments still create a checksum-validated local backup before running migration preflight.

## Initial host activation

1. Install `restic`, `msmtp`, `flock`, `curl`, Docker, and the Docker Compose plugin.
2. Create the restricted Infomaniak Object Storage bucket and credentials.
3. Copy `ops/ziffer-backup.env.example` to `/etc/ziffer-backup.env`, replace placeholders, then set owner `root:root` and mode `600`.
4. Store a long random Restic password in `/etc/ziffer-restic-password`, owned by `root:root` with mode `600`, then initialize the repository once with `restic init` using the root-only environment file.
5. Copy `ops/msmtprc.example` to `/etc/msmtprc`, replace placeholders, then set owner `root:root` and mode `600`.
6. Add the dedicated Infomaniak mailbox values (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`) to the root-owned production `.env`; these power Admin Operations test emails while `/etc/msmtprc` remains the host-down fallback.
7. Ensure all scripts in `ops/` are executable.
8. Run one backup and one restore drill manually before installing cron.
9. Send a test alert from the Admin Operations page.

After SMTP and the cached administrator list are ready, run `ops/simulate-alert-cycle.sh` once for each of `app`, `backup`, `teamwork`, `xero`, `disk`, and `deployment`. Each cycle must produce one failure email, one recovery email, one deduplicated incident, and a completed simulation run without interrupting production.

Recommended root cron:

```cron
CRON_TZ=Europe/Amsterdam
*/5 * * * * /opt/ziffer-billing-v2/ops/monitor-production.sh
*/5 * * * * /opt/ziffer-billing-v2/ops/reconcile-xero-sends.sh
0 0 * * * /opt/ziffer-billing-v2/ops/sync-teamwork-daily.sh
15 2 * * * /opt/ziffer-billing-v2/ops/backup-daily.sh
30 3 * * 0 /opt/ziffer-billing-v2/ops/restore-drill.sh
```

## Daily backup

`ops/backup-daily.sh` acquires a lock, creates a PostgreSQL custom archive, validates its catalog, writes a SHA-256 checksum, uploads both files into the encrypted Restic repository, and records the result. Local dumps older than 14 days are removed. Off-site retention is 14 daily, 8 weekly, and 12 monthly snapshots.

Do not treat a dump as successful unless local validation, checksum creation, and the encrypted off-site upload all completed. The monitor alerts when the last validated dump is older than 26 hours.

## Isolated restore drill

`ops/restore-drill.sh` restores the latest off-site snapshot into a temporary PostgreSQL 17 container with networking disabled. It verifies the checksum, applies pending migrations, validates users and financial relationships, records duration, and destroys the container.

The drill must never use the production database name, production volume, or production network. A passing drill must complete within two hours. Review `logs/restore-drill.log` and the Operations page after each run.

Once per quarter, supervise the drill and record:

- newest restored backup timestamp;
- achieved data-loss window;
- restore start and completion time;
- validation results;
- operator and follow-up actions.

## Full disaster recovery

1. Preserve the failed VPS and logs when safe; do not overwrite its database volume.
2. Provision PostgreSQL 17 and the approved Ziffer application image on a clean host.
3. Configure production secrets from the password manager.
4. Restore the newest checksum-valid Restic snapshot into a new empty database using `pg_restore --no-owner --no-privileges`.
5. Run `npm run db:migrate` using the approved app image.
6. Run the same integrity checks as the isolated restore drill.
7. Start the app and verify `/api/health/live` and `/api/health/ready` before changing DNS.
8. Verify login, reporting coverage, active drafts, annual usage, Xero connection state, and latest Xero document identifiers.
9. Record the incident, achieved recovery point, recovery duration, and any unrecovered changes.

## Deployment and rollback

Production deployments start only from the approval-protected GitHub workflow. The host script locks deployments, creates a fresh validated backup, builds an immutable commit-tagged image, runs tests and migrations, starts the candidate, and waits for readiness.

Use application rollback for bad code. It switches to a retained image and does not reverse additive migrations. Database restore is only for corruption or data loss. Migrations must use expand-and-contract releases so the previous application image remains compatible.

Before enabling normal releases, intentionally fail a non-production candidate readiness check and prove that the previous image returns healthy.

## Incident response

- Acknowledge the email and inspect Admin Operations first.
- Inspect the named component log without copying secrets or raw Xero payloads.
- Correct the cause; do not manually mark the incident resolved.
- The monitor sends recovery after two healthy app/database checks or the next successful component check.
- Open incidents receive at most one reminder per day.
