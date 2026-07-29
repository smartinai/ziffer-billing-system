# Changelog

All notable user-facing changes to Ziffer are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.5.0] - 2026-07-29

### Added

- Added the Maintain corporate records annual service with automatic task-title period recognition and a shared 12-hour allowance per client and period.
- Added explicit annual coverage periods for exact dates, month ranges, calendar years, and rolling `until Month Year` task titles.

### Changed

- Corporate-record time outside its task period or above the 12-hour allowance remains invoiceable.
- Annual Invoices shows compact corporate-record period and usage details without a remaining-hours metric.

### Fixed

- Unparseable corporate-record periods now remain invoiceable and produce a visible draft warning instead of being silently treated as prepaid.

## [0.4.0] - 2026-07-29

### Added

- Added a per-client Maria role setting: Director (€300/hour) or Standard (€750/hour).
- Applied Maria's client-specific rate consistently to Teamwork reporting and newly generated billing drafts while preserving existing document snapshots.

## [0.3.4] - 2026-07-23

### Fixed

- Unified Audit Log users and login summaries around app display names instead of mixed display names and email addresses.

## [0.3.3] - 2026-07-23

### Changed

- Standardized displayed dates across the app as `21 Jun '26`, with timestamps shown as `21 Jun '26, 14:55`.

## [0.3.2] - 2026-07-23

### Changed

- Simplified the Operations dashboard with deduplicated component health, compact incident states, and clearer operational history.

## [0.3.1] - 2026-07-23

### Fixed

- Rebalanced Audit Log columns and added safe wrapping so users, actions, entities, and summaries no longer overlap.

## [0.3.0] - 2026-07-23

### Added

- Added best-effort Teamwork write-back when task or time-entry billability is changed in a draft.

### Changed

- Draft billability changes now save immediately while Teamwork synchronization continues in the background.

### Fixed

- Failed Teamwork billability updates now create a dedicated Audit Log error without undoing or blocking the local draft change.

## [0.2.0] - 2026-07-23

### Added

- Added semantic application versioning, release preparation commands, runtime version reporting, and a visible version label.
- Added searchable Xero item-code assignment for draft task lines, including preview and outbound Xero payload support.

### Changed

- Improved expired draft-lock recovery so returning users can resume saving and navigate without becoming trapped.
- Added item codes to the Xero document preview.

### Fixed

- Corrected Xero preview row alignment after introducing the Item column.

## [0.1.0] - 2026-07-15

### Added

- Initial production release with PostgreSQL-backed Teamwork reporting, billing clients, durable invoice drafts, annual prepaid calculations, audit history, Xero invoice and quote sending, and scheduled synchronization.
