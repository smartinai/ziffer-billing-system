# Ziffer Backburner

These production-hardening items are intentionally deferred while feature development continues. They are not required for the current GitHub publication and deployment work.

## Off-site backup and recovery

- Configure an Infomaniak Object Storage bucket for encrypted Restic backups.
- Enable daily off-site retention and weekly repository integrity checks.
- Run and document an isolated PostgreSQL 17 restore drill.
- Perform a supervised quarterly disaster-recovery rehearsal.

## Alert delivery and external monitoring

- Select the email provider used by Ziffer and configure a dedicated SMTP alert mailbox.
- Enable failure and recovery emails for the app, database, backups, Teamwork, Xero, disk usage, deployments, and restore drills.
- Consider an external uptime monitor for complete VPS or network outages.

## Xero release verification

- Configure a dedicated Xero demo company and protected GitHub environment.
- Run real integration checks before production releases that change billing or Xero behavior.
- Verify ambiguous-send reconciliation and duplicate-send protection against the demo tenant.

## Maintainability

- Continue splitting the large frontend and server modules into feature-focused components and services.
- Expand browser coverage for remaining financial edge cases and operational failure states.
- Keep refactoring behavior-preserving and separate from unrelated feature work.
