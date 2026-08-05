# Changelog

All notable user-facing changes to Ziffer are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.11.0] - 2026-08-05

### Added

- Draft and archived-document lists now show when each draft was created, while active drafts show the date and time of the latest edit beneath the last editor.
- Draft task rates can be applied to every underlying time entry, then refined per entry while the task rate automatically recalculates as an hours-weighted average.

### Fixed

- Draft task hours, rates, discounts, wording, comments, item codes, accounting fields, and manual rows now survive later billability and standardized-service changes.
- Existing drafts remain isolated from newly synchronized Teamwork entries, and removed task rows no longer return during a draft rebuild.
- Stale browser responses can no longer repaint newer draft state; version conflicts now stop editing and offer an explicit reload of the latest draft.
- Manually assigned annual services now require an explicit year, always honor that selection over task-title dates, and classify years without prepaid allowance as fully invoiceable overflow.
- Closing and reopening the AI task-name review now restores generated suggestions, manual wording changes, and selections instead of generating everything again.

## [0.10.0] - 2026-08-04

- Allow invoice wording to be entered manually when AI cannot suggest a replacement task name.

### Added

- Draft editors can generate AI-assisted, client-facing task names in bulk or from an individual task, review and edit every suggestion, and apply only selected changes.
- Original Teamwork task names and AI provenance remain visible and durable after edits, while accepted wording flows through the existing Xero preview and send projection.

### Changed

- The AI task-name review uses a compact comparison queue with bulk selection, changed-only filtering, lighter rows, and a clearer selected-name count.
- AI task-name suggestions are prepared in sequential 15-task batches, appear as each batch finishes, and preserve completed results when a later batch needs to be retried.

## [0.9.0] - 2026-08-03

- Added a Teamwork sync progress modal with elapsed time, completion feedback, and retryable errors.

### Fixed

- Xero send audit events now record the actual sent amount, document number, and client from the completed Xero send result.

### Changed

- Annual Invoices now lists only active Teamwork projects linked to a Xero contact.
- Annual prepaid allowances can now be reconciled from the approved matrix while used hours are recalculated from Teamwork through June 2026, leaving July usage to the normal invoice workflow.

## [0.8.0] - 2026-08-03

### Added

- People and Projects reporting now shows an hours-based percentage beneath every monetary and hours metric, using Total Teamwork hours as the row baseline.
- Reporting table headers now include accessible explanations of each metric and its calculation.
- Reporting now loads entry-level allocations from successfully sent Xero invoices and keeps confirmed billed and prepaid results separate from Teamwork estimates.
- People and Projects reporting now displays the effective blend of confirmed Xero allocations and remaining Teamwork estimates, marking only confirmed and partly confirmed values to keep the tables uncluttered.
- Reporting metric tooltips use concise definitions that are easier to scan.
- Multiple unsent drafts may share the same suggested document number; Xero remains authoritative when sending.

## [0.7.0] - 2026-07-29

### Added

- Draft task rows now show the original generated hours, rate, and discount beneath any edited value.

### Changed

- Original task-line values are preserved in the durable source snapshot so override indicators survive navigation and refresh.
- Existing drafts establish their original-value baseline safely when a task row is next edited.

## [0.6.0] - 2026-07-29

### Added

- New invoice drafts now suggest the next client-specific Xero invoice number using the `[abbreviation]-[year]-[sequence]` format, starting at `01`.

### Changed

- Xero invoice-number suggestions recognize both compact (`STS-202605`) and separated (`TDI-2026-05`) client formats, normalize legacy spacing and one-digit sequences, and ignore unrelated clients, years, annual-fee numbers, quotes and non-sequence suffixes.
- When Xero cannot be checked, draft creation continues with the existing fallback number and shows a review warning.

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
