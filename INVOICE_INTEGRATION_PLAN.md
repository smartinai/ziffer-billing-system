# Invoice Integration Plan

Date: 2026-06-30

This plan covers how to start integrating the old Google Apps Script billing workflow into the new Ziffer Billing System app.

The goal is not to copy the spreadsheet workflow one-to-one. The old script is a useful source of billing rules and edge cases, but the new app should make invoices, store invoice data, and use that stored invoice data for reporting.

## Current Implementation Status

Last updated: 2026-07-03

- [x] Invoice workflow direction agreed.
- [x] PostgreSQL chosen as the database from the start.
- [x] Local Docker Compose PostgreSQL setup added.
- [x] Migration runner added.
- [x] Initial database schema added for users, roles, audit events, Teamwork sync data, billing clients, standardized services, annual invoice usage, quote previews, quote lines, and Xero logs.
- [x] Database health endpoint added.
- [x] Current JSON-backed reporting kept working while database-backed invoice work begins.
- [x] Apply migrations against a real local Postgres instance.
- [x] Add a native local PostgreSQL fallback because Docker is not installed on this computer.
- [x] Move Teamwork sync writes into PostgreSQL.
- [x] Sync all Teamwork data from 2026-01-01 through 2026-06-30 into PostgreSQL.
- [x] Store invoice-ready Teamwork fields: task ID, task name, description, tags, source timestamps, and Teamwork invoice ID.
- [x] Seed billing clients from Teamwork projects.
- [x] Add the first PostgreSQL-backed Billing Clients settings screen.
- [x] Seed temporary Xero contacts and tax rates from the current Google Sheet snapshot.
- [x] Build the first Teamwork-backed quote preview workflow without Xero push.
- [x] Add the first Billing > Annual Invoices screen for manual annual hours and used hours by client/service/year.
- [x] Add annual invoice import and annual-covered quote logic.
- [x] Show annual coverage balances in quote previews, including used-before, current-quote usage, and remaining hours.
- [x] Split annual-service boundary entries so the remaining pre-paid balance can partially cover the next entry and only the overflow stays invoiceable.
- [x] Show annual-service overflow that WILL be invoiced separately from pre-paid annual coverage that will NOT be invoiced.
- [x] Add the first Send to Xero approval action that books annual-covered hours, stores a Xero-ready payload, and locks the preview.
- [x] Add the first Billing > Quotes ledger for sent/prepared Xero quote records, including Teamwork estimate, annual-adjusted Teamwork amount, sent amount, paid amount, and paid-within-days fields.
- [x] Connect the live Xero OAuth/API transport so the prepared payload can be created in Xero once OAuth credentials and a tenant connection are configured.
- [x] Add a document-type selector so Send to Xero can create draft invoices by default or draft quotes when selected.
- [x] Fetch and cache live Xero contacts, tax rates, and accounts for Billing > Clients settings.
- [x] Exclude Teamwork time entries already linked to a Teamwork invoice ID from document generation candidates.
- [x] Allow generated document row service remapping to rerun annual/pre-paid coverage from the original Teamwork source entries.

Local database commands:

```bash
# Docker path, useful on machines with Docker Desktop:
docker compose up -d postgres
npm run db:migrate

# Native fallback path, used on this computer:
npm run db:local:start
npm run db:migrate
```

## Current App Baseline

The current app already has:

- Teamwork API sync into local stored data.
- Normalized internal people, projects/clients, and time entries.
- Reporting by period, project/client, and person.
- Calculated total hours, billed hours, billed share, and amounts from person rates.
- Drilldowns from projects to people and from people to projects.
- A local Express API and React frontend.
- A Netlify-safe demo mode with mock data.
- A PostgreSQL database foundation and migration runner.
- A PostgreSQL-backed Billing Clients screen seeded from Teamwork projects.
- Cached Xero contact, tax-rate, and account dropdown data, refreshed from the connected Xero tenant when available.
- A local Send to Xero approval action that prepares and logs a Xero payload, books annual invoice usage, and locks the quote preview.

The current app does not yet have:

- Manual quote lines.
- Full quote line editing for quantity, rate, description, service, account code, tax type, and comments.
- Reporting based on pushed Xero quotes and later Xero invoice/payment state.

## What The Old Apps Script Does

The pasted Apps Script is a spreadsheet-based billing system. The important parts to preserve as business logic are:

- Fetches Teamwork time entries for a billing period.
- Fetches tasks and tags with Teamwork time entries.
- Writes raw time rows into a "Time Data" sheet.
- Builds or updates a "Client List" sheet from Teamwork project IDs.
- Fetches Teamwork users and rates into a "Users" sheet.
- Calculates per-entry totals from minutes, billable flag, and user rate.
- Creates one editable draft quote row per Teamwork time entry for the selected client/project.
- Adds warnings for unbillable time and zero-rate entries.
- Maps task names to Xero inventory item codes through task rules and a price list.
- Groups draft rows by task, comment state, item code, account code, and zero-rate state.
- Builds aggregated quote descriptions with per-description hour totals.
- Checks certain tasks against annual invoice usage rules.
- Skips or includes annual invoice rows depending on remaining annual allowance.
- Updates an external annual invoice usage sheet.
- Connects to Xero through OAuth.
- Finds and stores Xero contact IDs.
- Reads Xero tax rates.
- Builds Xero quote payloads.
- Pushes draft quotes to Xero with an idempotency key.
- Logs quote pushes in a "Xero Quote Log" sheet.

Important wording mismatch: the old workflow mostly creates Xero quotes, even though parts of the sheet header look like Xero invoice import fields. The new app needs a decision on whether it should create invoices directly, create quotes first, or support both.

## Resolved Decisions

Based on Marius's answers:

- Use PostgreSQL from the start.
- Use Docker Compose PostgreSQL for local development because it gives the cleanest path to matching a VPS PostgreSQL setup later.
- The app should create and manage Xero quotes, not Xero invoices directly.
- The app should become the operational source for quote preparation, while Xero remains the accounting system after push.
- Later, the app must listen to Xero changes because CRMs may edit quotes/invoices or payment state in Xero.
- The old manual three-step workflow should not be copied. The app should create the aggregated quote view directly.
- First milestone: aggregated quote preview from Teamwork data, no Xero push yet.
- First production-capable version must push quotes to Xero.
- The app must support manual quote lines in addition to Teamwork time entries.

Decision update on 2026-07-02:

- The app now supports both Xero draft invoices and Xero draft quotes.
- Draft invoice is the default Send to Xero target.
- Draft quote remains available from the Create Quote Send as selector.
- Navigation wording now treats the workflow as document-based: Billing > Create New creates a new document preview, and Billing > Docs lists sent/prepared Xero documents.
- Unbillable Teamwork time should appear with a comment/warning and an option to mark it billable, with automatic reaggregation.
- Zero-rate billable time should warn and allow setting the person's rate globally, then reprocess.
- Teamwork time entries already linked to a Teamwork invoice ID should be excluded from new quote generation.
- Teamwork tags are not needed in the new invoice workflow.
- Item codes and the old Price List concept are no longer needed.
- Task names remain the main classification input, but they map to standardized services instead of inventory item codes.
- Standardized services are:
  - Filing / Correspondence
  - AGM / Publication
  - Annual compliance
  - FS / Financial statement / Annual accounts
  - CIT / Corporate income tax
  - VAT / Value added tax
- Client settings need a screen, not config-file editing.
- Each Teamwork project/client should be mapped to a Xero client/contact, tax rate, discount, and related billing settings.
- Default account code remains `70330001`.
- Annual invoice usage is mandatory in the first invoice version.
- The external annual invoice spreadsheet should be imported and then managed in this app.
- Annual invoice data will be exported from Google Sheets and processed by the backend.
- Imported annual invoice balances should be editable by admins in the app.
- Xero contacts and tax rates should be fetched and cached.
- Xero quote IDs/statuses should be stored for reporting.
- Duplicate Xero pushes should be prevented with a visible warning.
- Quote UI should use a clean table plus drawer, not a spreadsheet clone.
- Users should be able to edit quantities, rates, descriptions, comments, and service mappings.
- Aggregation should happen automatically.
- Users do not need to switch between raw and aggregated views; show the aggregated view directly, but keep raw Teamwork traceability internally.
- Reporting should focus on person, client, and standardized service/product.
- Reporting should compare Teamwork worked value against actually quoted/invoiced value.
- Annual-covered time should be a separate reporting category.
- Only pushed Xero quotes should affect invoice-based reporting.
- Hosted deployment is expected soon.
- `admin/admin` is acceptable for local/demo use for now.
- Teamwork and Xero credentials should be centrally configured and held securely once hosted.
- Admin audit logs must record every user action.
- Existing Google Sheet quote history and existing Xero history do not need importing yet.
- When moving to the VPS, start with an empty production database rather than migrating local development invoice data.
- The six standardized service labels are confirmed, but the system must allow more services later.

## Observed Google Sheets Workbook Structure

Reviewed workbook:

- Spreadsheet: `Developer Copy - Billing System v0.11`
- Spreadsheet ID: `1wQVcdD5MC8Q1ZO-jMIM1gTnDU9cfVKOP5Bh5UkysPSk`
- Locale/timezone: `en_GB`, `Europe/Berlin`

Visible user-facing tabs:

- `Client`
  - Acts as the workflow control panel.
  - Lets the user select a Xero client from `Client List`.
  - Derives Teamwork Project ID, Xero Contact ID, and Tax Rate from `Client List`.
  - Holds Start Date and End Date.
  - Shows Teamwork total hours, Teamwork billable hours, billable utilization, Teamwork amount, Xero Quote amount, and amount difference.
  - Uses formulas to validate whether Teamwork amount and Xero Quote amount match.
- `Client List`
  - Current Teamwork-project-to-Xero-client mapping table.
  - Columns: Teamwork Project ID, Teamwork Project Name, Xero Contact ID, Xero Client Name, TAX Rate, Abbreviation.
  - This maps directly to the future `billing_clients` table and client mapping screen.
- `Xero Quote`
  - Current generated quote working area.
  - Header follows the old Xero import/export style: contact, quote/invoice number, reference, date, due date, comments, description, quantity, unit amount, discount, account code, tax type, currency, branding theme.
  - In the new app this becomes the aggregated quote preview screen plus persisted `quote_drafts` / `quote_lines`.
- `Price List`
  - Old catalogue of Xero item codes, services, fixed/basic rate, EUR price, max time limit, validity, and explicit service labels.
  - Item codes are not part of the new plan, but this tab is still useful as historical context for annual service limits and naming.
- `Xero Quote Log`
  - Current push log.
  - Columns: Logged At, Client, Xero Contact ID, Reference, Quote ID, Quote Number, Status, Line Count, Idempotency Key.
  - This maps to `xero_quotes`, `xero_sync_logs`, and audit events.

Hidden/support tabs:

- `Users`
  - Teamwork people/rate cache.
  - Columns include Include, User ID, name, email, avatar URL, admin/deleted flags, working minutes, unavailable minutes, and hourly rate.
  - The new app should store user rates in PostgreSQL and allow zero-rate fixes to update the person globally.
- `Time Data`
  - Raw Teamwork time-entry cache.
  - Columns include Time Entry ID, Date, Minutes, Billable, User ID, Project ID, Task ID, Task Name, Tags, Description, Invoice ID, Created At, Updated At, Total.
  - This confirms the PostgreSQL Teamwork time-entry table needs task fields, Teamwork invoice ID, timestamps, billable state, and calculated amount.
- `Annual invoices`
  - Flattened annual invoice usage table.
  - Columns include Client, Service Code, Service, Quantity, Unit Price, Invoiced on, Max. hours, Used hours, For Year, Invoice Number, Reference.
  - This is close to the backend import shape we need.
- `Raw Annual Invoices (May 2026)`
  - Raw annual invoice export with similar columns, using Valid until instead of For Year.
  - The backend importer should tolerate both `For Year` and `Valid until` style exports.
- `Copy of Annual invoices`
  - Another annual invoice table variant with the same core shape.
- `Xero Clients`
  - Xero contact export/cache with many standard Xero contact import/export columns, including ContactName, addresses, tax number, discount, due dates, default tax settings, and people/contact emails.
  - The new app should fetch/cache Xero contacts directly, but this tab helps confirm fields users expect.
- `Xero Tax Rates`
  - Xero tax rate cache.
  - Columns: Name, TaxType, Rate, Status.
  - This maps directly to `xero_tax_rates`.
- `Helper`
  - Legacy code/account-code helper.
  - Mostly superseded by standardized services and default account code, but confirms `70330001` as the broad account code.
- `Annual Invoice Log`
  - Current annual usage booking log.
  - Columns: Logged At, Invoice Number, Client, Service, Exported Hours, Previous Used Hours, New Used Hours, Hours Left.
  - The new app should model this as annual usage events/audit rows.
- `Planning`
  - Historic feature checklist for the spreadsheet app.
- `Template`
  - Hidden template tab; currently no visible values in the sampled range.

Migration implication:

- The database schema should not mimic tabs one-to-one, but the app needs equivalents for the `Client` control panel, `Client List` mapping, `Time Data` sync cache, `Users` rates, `Annual invoices` imported usage, `Xero Tax Rates`, and `Xero Quote Log`.
- The new app should replace `Xero Quote` with a persisted aggregated quote preview UI rather than a generated spreadsheet table.
- The import path for annual usage should accept exported spreadsheet files from the current annual invoice tabs and normalize them into PostgreSQL.

## Recommended Direction

Build quote creation as a first-class workflow in the app. The app should use Teamwork data, client billing settings, standard service mapping, and annual invoice usage to generate an aggregated Xero quote preview. After review/editing, the app should push the approved quote to Xero and store the Xero response for reporting.

Recommended high-level workflow:

1. Sync Teamwork data for the selected billing period.
2. Select a billing period and Teamwork project/client.
3. Generate an aggregated quote preview directly.
4. Classify time by standardized services using task names.
5. Apply client settings: Xero contact, tax rate, discount, default account code, and billing preferences.
6. Apply annual invoice usage rules and mark annual-covered time separately.
7. Show warnings/actions for unbillable time, zero-rate users, missing client mapping, missing tax rate, missing service classification, and duplicate push risk.
8. Allow editing in a clean table plus drawer.
9. Automatically reaggregate after edits.
10. Approve and push the selected document type to Xero.
11. Store Xero document IDs, statuses, amounts, line snapshots, and push logs.
12. Later, listen to Xero changes and payment state for reporting.

The first milestone should stop before Xero push: aggregated quote preview, persisted in PostgreSQL, with annual invoice logic included.

## Proposed Architecture

### 1. Domain Modules

Create pure shared modules for billing logic, separate from React and Express route handlers.

Candidate modules:

- `src/shared/billingRules.js`
- `src/shared/quoteDrafts.js`
- `src/shared/quoteAggregation.js`
- `src/shared/serviceMapping.js`
- `src/shared/xeroPayloads.js`
- `src/shared/annualInvoiceUsage.js`

The first migration should move rules into testable JavaScript functions:

- Quote number generation.
- Previous-month reference generation.
- Hours and money rounding.
- Task-to-standard-service matching.
- Aggregated quote line creation from Teamwork entries and manual lines.
- Aggregation by service, task, comment/include state, account code, tax type, discount, and rate state.
- Annual invoice matching decisions.
- Xero quote payload building.

### 2. Data Storage

Decision: use a real database from the start.

Recommended database:

- PostgreSQL locally.
- PostgreSQL on the VPS later.
- Schema migrations committed to Git.
- Optional seed scripts for demo/reference data.

Why PostgreSQL:

- Same database engine locally and in production.
- Strong fit for invoices, line items, audit events, reporting, and external IDs.
- Good migration path to a VPS.
- Safer than growing the current JSON storage once invoice data becomes a source of truth.

Local setup options:

- Preferred: Docker Compose with a local Postgres container.
- Alternative: native PostgreSQL installed on Windows.

VPS migration path:

- Keep database schema changes in versioned migrations.
- On a new VPS, install PostgreSQL, create the database/user, set `DATABASE_URL`, and run migrations.
- If local invoice data needs to move to the VPS, use `pg_dump` locally and restore with `pg_restore` or `psql` on the VPS.
- If local invoice data is disposable, run migrations on the VPS and resync Teamwork/settings there.

Important rule:

- Do not build quote/invoice storage on local JSON first and "convert later". We can keep the current Teamwork JSON store temporarily during the transition, but quote previews, pushed quotes, client settings, annual usage, audit logs, and reporting should start in PostgreSQL.

Recommended Node database layer:

- Use a lightweight SQL migration/query layer such as Knex or Drizzle.
- Avoid hiding invoice/reporting logic inside an ORM too early.
- Keep pure invoice calculation functions separate from database reads/writes.

### 3. Core Data Model

Proposed records:

#### Billing Client

- Teamwork project ID.
- Teamwork project name.
- Display client name.
- Xero contact ID.
- Xero client name.
- Tax rate.
- Discount.
- Account code.
- Abbreviation for quote numbering.
- Default currency.
- Active/inactive status.

#### Standard Service

- Service key.
- Service label.
- Service aliases.
- Task matching rules.
- Account code.
- Tax type.
- Annual invoice eligible flag.

#### Quote Draft

- Draft ID.
- Status: draft, reviewed, approved, pushed, cancelled.
- Billing period start/end.
- Client/project ID.
- Reference.
- Quote number.
- Quote date.
- Quote expiry date.
- Created at / updated at.
- Created from Teamwork sync run ID.
- Warnings.

#### Quote Line

- Draft line ID.
- Source Teamwork time entry IDs.
- Source type: Teamwork time or manual line.
- Standard service.
- Task name.
- Description.
- Person/user ID.
- Quantity hours.
- Unit amount/rate.
- Amount.
- Billable flag.
- Account code.
- Tax type.
- Discount.
- Comments/notes.
- Warning state: unbillable, zero-rate, missing service, missing annual invoice, annual covered.
- Include/exclude from Xero quote.

#### Pushed Quote

- Quote ID.
- Draft ID.
- Client/project ID.
- Status.
- Total hours.
- Total amount.
- Xero quote ID.
- Xero quote number.
- Xero status.
- Pushed at.
- Line snapshot.

#### Quote Event

- Timestamp.
- User.
- Action.
- Before/after summary.
- Error or external API response if relevant.

### 4. Database Tables

Initial PostgreSQL tables should include:

- `teamwork_sync_runs`
- `teamwork_users`
- `teamwork_projects`
- `teamwork_time_entries`
- `billing_clients`
- `standard_services`
- `service_task_rules`
- `quote_drafts`
- `quote_lines`
- `quote_events`
- `xero_connections`
- `xero_contacts`
- `xero_tax_rates`
- `xero_quotes`
- `xero_sync_logs`
- `annual_invoice_services`
- `annual_invoice_usage`
- `users`
- `roles`
- `user_roles`
- `audit_events`

The Teamwork JSON store can be replaced gradually:

1. Add database tables for Teamwork sync data.
2. Write new syncs to PostgreSQL.
3. Read reports from PostgreSQL.
4. Remove dependence on `data/teamwork-store.json`.

### 5. UI Areas To Add

Suggested navigation:

- Reporting
  - Overview
  - People
  - Projects
- Billing
  - Create New
  - Docs
  - Clients
- eCDF
- Performance

Invoice UI should probably start with:

- Quote period selector.
- Client/project selector.
- Create quote preview button.
- Aggregated quote warning summary.
- Aggregated quote line table.
- Line edit drawer/modal.
- Automatic reaggregation after edits.
- Approve/push action later.

Settings UI should eventually include:

- Client billing settings.
- Standard services and task matching rules.
- Tax rates.
- Account codes.
- Annual invoice service rules.
- Xero connection status.

## Phased Implementation Plan

### Phase 0 - Decisions And Inventory

Purpose: lock the non-code setup needed before quote work starts.

Work:

- [x] Use Docker Compose PostgreSQL locally.
- [x] Add a native local PostgreSQL fallback for machines without Docker.
- [x] Keep migrations in Git.
- [x] Start hosted VPS database empty when production is introduced.
- [x] Create a new Xero OAuth app for this app.
- [x] Identify the annual invoice spreadsheet/data export that needs importing.
- [x] Confirm exact standardized service labels and aliases.
- [ ] Decide whether current local Teamwork data can be used for development or whether we need a sanitized fixture.

Output:

- Local database setup path.
- First migration strategy.
- Confirmed service taxonomy.
- Annual invoice import source.

### Phase 1 - Database Foundation

Purpose: build the app on PostgreSQL from the beginning of invoice work.

Work:

- [x] Add PostgreSQL, migration tooling, and `DATABASE_URL`.
- [x] Add Docker Compose for local Postgres.
- [x] Create migration scripts and npm commands.
- [x] Create first schema for users, roles, audit events, Teamwork sync data, billing clients, services, quote drafts, quote lines, Xero sync logs, and annual usage.
- [x] Add a database health check.
- [x] Keep current local login for now, but prepare the user/role tables for hosted deployment.

Implementation notes:

- Added `docker-compose.yml` with a local PostgreSQL 16 service.
- Added `npm run db:local:start`, `npm run db:local:status`, and `npm run db:local:stop` for machines without Docker.
- Added `npm run db:migrate`.
- Added `migrations/001_database_foundation.sql`.
- Added `/api/health/db`.
- The database is optional at server startup for now, so the existing reporting app can still run without Postgres.
- This computer now runs a project-local PostgreSQL database on port `55432`.
- `001_database_foundation.sql` has been applied locally.

### Phase 2 - Move Teamwork Sync Into PostgreSQL

Purpose: make Teamwork data invoice-ready and remove the JSON store as the long-term source.

Work:

- [x] Create tables for Teamwork users, projects, time entries, and sync runs.
- [x] Add schema fields for task ID, task name, tags, Teamwork invoice ID, created at, and updated at.
- [x] Write Teamwork sync output into PostgreSQL.
- [x] Keep `data/teamwork-store.json` only as a temporary fallback while reporting is moved.
- [x] Make sure billable/unbillable state matches the old script.
- [x] Exclude Teamwork time entries already linked to a Teamwork invoice ID from quote generation candidates.
- [x] Keep current reporting behavior unchanged.
- [x] Add tests for enriched normalization.

Implementation notes:

- Added PostgreSQL persistence for Teamwork sync runs, people, projects, and time entries.
- Added `npm run db:import-teamwork-store` for importing an existing local JSON store without calling Teamwork again.
- The dashboard still reads from `data/teamwork-store.json` for now, but each new Teamwork sync also writes the normalized invoice-ready data into PostgreSQL.
- Completed a live full sync for `2026-01-01` through `2026-06-30`: 66 people, 104 projects, 20,210 time entries, 206 pages fetched, no partial API fetch flag.
- Stored task data for 20,072 entries.
- Backfilled 154 Teamwork entries that already have a `projectBillingInvoiceId` into `teamwork_invoice_id`.
- Document generation now excludes Teamwork entries with a stored Teamwork invoice ID at the SQL candidate-query level before aggregation.

Why first:

- The old quote workflow depends on task names, descriptions, Teamwork invoice IDs, and timestamps.
- Current reporting only needs less detail, but invoice generation needs more.

Note:

- Teamwork tags are not needed for the new workflow, but we can store them if they are cheap to fetch and useful for future debugging. They should not drive quote logic.

### Phase 3 - Client, Service, And Annual Settings

Purpose: replace the "Client List", "Price List", and annual invoice spreadsheet with app-owned settings/data.

Work:

- [x] Add PostgreSQL tables for billing clients, standard services, service task rules, and annual invoice usage.
- [x] Seed billing clients from Teamwork projects.
- [x] Temporarily seed Xero contacts and tax rates from the Google Sheet snapshot.
- [x] Fetch and cache Xero contacts, tax rates, and accounts from the live Xero API once Xero OAuth exists.
- [x] Build an initial Billing > Clients screen for mapping Teamwork projects to billing client settings.
- [x] Store schema fields for Xero contact, tax rate, discount, default account code, abbreviation, and active state.
- [x] Store schema fields for service task matching rules for the standardized service list.
- [x] Import annual invoice usage exports into PostgreSQL and make the app the source of truth.
- [ ] Allow admins to edit imported annual usage balances and corrections.
- [x] Add a first manual Annual Invoices grid with 2025 and 2026 year tabs.

Minimal UI:

- A client overview/settings screen is required.
- Service rule editing can start simpler, but should not require editing a code file forever.

Implementation notes:

- Added `GET /api/billing/clients` and `PATCH /api/billing/clients/:id`.
- Added `server/billingClientRepository.js` to seed billing clients from `teamwork_projects`, list them with quote counters, and save editable billing settings.
- Added Billing > Clients with a searchable client table and click-to-edit settings modal.
- Added Reporting > Projects and moved reporting views under Reporting.
- Added Billing > Create Quote and Billing > Quotes placeholders so the navigation shape is ready for the quote workflow.
- Added `GET /api/xero/reference` for cached Xero contact, tax-rate, and account dropdown data.
- Seeded local PostgreSQL from `Developer Copy - Billing System v0.11`: `Xero Clients`, `Client List`, and `Xero Tax Rates`.
- Live Xero reference sync refreshes contacts, tax rates, and accounts from the connected tenant and keeps the Google Sheet snapshot only as a disconnected fallback.
- Reference sync is cache-first with a six-hour default TTL; the Billing > Clients refresh action can force a live Xero refresh.
- Added billing client statuses: active, inactive, and excluded. Excluded clients/projects are filtered out of reporting totals and charts.
- Added inactive and excluded client sections in Billing > Clients so non-billable or out-of-scope projects can be managed without polluting reporting.

### Phase 4 - Aggregated Quote Preview Generator

Purpose: produce the first useful invoice workflow milestone: aggregated quote preview, no Xero push yet.

Work:

- [x] Add a server endpoint to generate an aggregated quote preview for one project/client and period.
- [x] Import all Teamwork data from the beginning of 2026 and let the user pick client and period.
- [x] Create quote source lines from Teamwork time entries.
- [x] Aggregate automatically by standardized service/task/comment/include state/account/tax/discount/rate state.
- [ ] Add manual quote source lines.
- Carry over:
  - Contact/client name.
  - Reference.
  - Quote number.
  - Quote date.
  - Quote expiry date.
  - Description format.
  - Quantity hours.
  - Unit amount/rate.
  - Standardized service.
  - Account code.
  - Tax type.
  - Discount.
  - Unbillable warning.
  - Zero-rate warning.
- [x] Apply annual invoice usage and show annual-covered time as a separate category.
- [ ] Support annual invoice imports with either `For Year` or `Valid until` source columns.
- [x] Persist quote preview and quote lines in PostgreSQL with source Teamwork time entry IDs.
- [x] Keep raw Teamwork traceability internally, but display the aggregated view directly.
- [x] Add tests for service mapping, aggregation, Teamwork invoice exclusion, warning states, and rounding.

UI:

- [x] Build Billing > Create Quote into the first quote preview workflow.
- [x] Let the user pick period and client/project.
- [x] Show aggregated quote lines in a clean table.
- [x] Show warning/action rows for missing Xero client, missing tax rate, unbillable time, and zero-rate users.
- [x] Make quote reference, quote date, and expiry date editable in the preview metadata.
- [x] Split billable and unbillable time into separate task rows, allow unbillable entries to be marked billable, and allow billable task rows/time entries to be marked unbillable with automatic reaggregation.
- [x] Show annual-covered time after annual invoice usage import exists.
- [x] Show used-before, this-quote, and remaining annual invoice balances in the quote preview and covered task rows.

Implementation notes:

- Added `src/shared/quoteDrafts.js` for service matching and aggregated Teamwork quote preview generation.
- Added `server/quotePreviewRepository.js` and `POST /api/billing/quote-previews`.
- Billing > Create Quote now persists `quote_previews` and `quote_lines` from stored PostgreSQL Teamwork time.
- Verified with KPS Holding S.A. for `2026-01-01` to `2026-06-30`: 349 lines, 658.8 hours, 648.6834 billed hours, and EUR 367,840.54.
- Adjusted the quote preview table so top-level rows are task-name totals, with comments blank for now and source Teamwork entries nested underneath.
- Slimmed the Create Quote controls into a compact top card, changed the action to Generate Quote, hid missing-service warning noise, and made reference/date/expiry metadata editable.
- Confirmed against the Google Sheets `Time Data` tab that source rows carry `Task ID` and `Task Name`; quote preview aggregation now groups by Teamwork task identity and displays people/time entries under the task name.
- Confirmed against the Google Sheets `Time Data` tab that unbillable source rows are stored as `Billable = FALSE` with zero totals; the app now keeps those rows separate from billable rows, marks them with `Marked unbillable`, and can reaggregate them when marked billable.
- Manual lines remain one of the next major pieces before Xero push.
- Billing > Annual Invoices now lets admins enter annual hours and used hours for active clients across the annual service set.
- Added `npm run db:import-annual-invoices` to import 2025 and 2026 annual invoice balances from a Google Sheets workbook export into PostgreSQL, using active billing clients only and skipping excluded projects.
- The annual invoice importer now supports the live `Annual Invoices` workbook shape with separate `Invoiced` and `Used` tabs, combining allowance hours and used hours by client/service/year.
- Quote previews now load imported annual invoice balances for the selected client/year, mark matching billable annual-service rows as covered, add annual usage comments, exclude those rows from the quote amount, and count the covered hours separately.
- Quote previews now show a full-width annual coverage balance panel with separate used-before, this-doc, and remaining metric blocks, so reviewers can see previous usage, current document usage, and remaining allowance before approving Send to Xero.
- Quote previews now split the first annual-service entry that crosses the remaining pre-paid balance, add a comment to the invoiceable remainder, and show Annual overflow separately for the annual-service hours that WILL be invoiced.

### Phase 5 - Quote Review, Editing, And Audit

Purpose: replace direct spreadsheet editing.

Work:

- [x] Allow editing generated document row task name, description, quantity, unit amount, account code, tax type, discount, and comments.
- [x] Allow editing standardized service mapping and reaggregate annual/pre-paid coverage after a service change.
- Include/exclude state editing is intentionally deferred; Marius said no manual sent/don't-send-to-Xero selection for now.
- Allow adding manual lines.
- [x] Allow marking unbillable time as billable and automatically reaggregating.
- Allow setting missing person rates and save those rates to the person, not only to the quote.
- Reaggregate automatically after edits.
- Add warning filters.
- Add totals preview.
- Add save/update actions.
- Add audit events for every user action.

Important design choice:

- Spreadsheet comments should become explicit structured flags and notes, not hidden text markers.
- 2026-07-03 update: generated document rows now have a first edit modal from the three-dot menu; row service remapping is included, persists through rebuilds, and reruns annual/pre-paid coverage from source Teamwork entries. Manual lines, rate-setting workflows, and audit events still remain in this phase.

### Phase 6 - Xero Document Push

Purpose: send approved aggregated billing documents to Xero safely.

Work:

- [x] Add a new Xero OAuth app and OAuth routes.
- [x] Store Xero tokens centrally and securely for local development.
- [x] Build Xero quote payloads from approved quote previews, using the real Xero `PUT /Quotes` request shape and accounting fields.
- [x] Build Xero draft invoice payloads from approved quote previews, using the real Xero `PUT /Invoices` request shape and accounting fields.
- [x] Push Xero quotes to the live Xero API with idempotency keys when a Xero tenant is connected.
- [x] Let reviewers choose draft invoice or draft quote at Send to Xero time, with draft invoice as the default.
- [x] Store prepared Xero quote log rows with quote number, status, line count, amount, idempotency key, and payload snapshot.
- [x] Store quote ledger metrics for initial Teamwork estimate, Teamwork amount after annual invoice coverage, Xero sent amount, Xero paid amount, paid date, and paid-within-days.
- [x] Prevent duplicate sends by locking quote previews after Send to Xero.
- [x] Update annual invoice usage after the approved Send to Xero action.
- [x] Log prepared send attempts and quote approval events.
- [x] Log live Xero success responses once the API transport is connected.

Current implementation note:

- Send to Xero now performs the local approval step and can also create the selected draft document in Xero when OAuth credentials and a connected tenant are available. Without a connected Xero tenant, it keeps the safe prepared-payload mode: annual-covered hours are booked, billable quote lines are converted into a Xero-ready request body, unbillable lines are excluded, pre-paid annual rows are carried as zero-amount trace lines, and the preview becomes locked.
- Billing > Docs now reads stored Xero document rows as a first document ledger, including Teamwork estimate before annual coverage, Teamwork amount after annual coverage, sent amount, paid amount, outstanding amount, and paid-within-days. Mock rows were removed, so the local ledger shows real Xero-tracked documents only.

### Phase 7 - Xero Sync Back

Purpose: capture later changes made in Xero.

Work:

- Fetch or listen for Xero quote/invoice/payment changes.
- Store Xero status history.
- Update the quote ledger payment fields when Xero reports a quote/invoice was paid.
- Log changes made outside the app.
- Update reporting with paid status and changed Xero amounts.
- Decide whether webhooks or scheduled polling is the first production approach.

### Phase 8 - Invoice Reporting

Purpose: make pushed quote data part of reporting.

Work:

- Add quote-backed reporting metrics:
  - Pushed/invoiced amount.
  - Excluded/unbillable amount.
  - Zero-rate amount.
  - Annual-covered hours.
  - Write-off / not-invoiced hours.
- Amounts by person, client, standardized service/product, and month.
- Show difference between Teamwork worked value and invoiced value.
- Keep annual-covered time as a separate category.
- Only count pushed Xero quotes in invoice-based reporting.
- Add Xero status/payment filters once Xero sync-back exists.

Implementation notes:

- Added the first Billing > Quotes ledger view from stored `xero_quotes` rows.
- Added seedable mock sent-to-Xero quote rows so the ledger can be reviewed before live Xero OAuth/API transport exists.

### Phase 9 - Hosted VPS, Security, And Users

Purpose: move the local PostgreSQL-backed app to a VPS without redesigning storage.

Work:

- Provision PostgreSQL on the VPS.
- Run the same schema migrations on the VPS.
- Start with an empty production database.
- Set up database backups.
- Set up app process management.
- Set up HTTPS and reverse proxy.
- Add proper user authentication.
- Add role/permission model.
- Add deployment target for the server app.
- Add environment variable setup for Teamwork and Xero.
- Centrally configure Teamwork and Xero credentials.
- Encrypt Xero tokens at rest or use a VPS secret-management pattern.
- Add admin-only user overview.
- Add admin-only audit log view.

Migration options:

- Current decision: local invoice data is development/test data; production VPS starts empty.
- Run migrations on the VPS and resync/import fresh Teamwork, settings, annual usage, Xero contacts, and tax rates.

Best practical path:

1. Build locally against PostgreSQL.
2. Keep migrations in Git.
3. Demo locally until workflow is stable.
4. Create VPS Postgres.
5. Deploy app code.
6. Run migrations.
7. Resync/import fresh data.
8. Turn on scheduled backups.

## What Should Not Be Migrated One-To-One

Avoid carrying these spreadsheet patterns directly into the app:

- Spreadsheet comments as workflow state.
- Hidden column meaning based on position only.
- Manual sheet formatting as a data model.
- Apps Script UI menus.
- Apps Script property storage.
- External spreadsheet updates without an explicit app-level data model.

Instead:

- Use explicit fields for statuses, warnings, and decisions.
- Keep quote line traceability back to Teamwork time entry IDs.
- Keep audit events for review and push actions.
- Keep pure billing functions covered by tests.

## Recommended First Build Slice

I recommend the first implementation slice be:

1. [x] Add local PostgreSQL and migration tooling.
2. [x] Create initial schema for Teamwork sync data, billing clients, standardized services, service rules, annual usage, quote previews, quote lines, Xero logs, and audit events.
3. [x] Add database fields for Teamwork task name, task ID, Teamwork invoice ID, created at, and updated at.
4. [x] Write Teamwork sync data into PostgreSQL.
5. [x] Import all Teamwork data from the beginning of 2026 and let the user pick client and period.
6. [x] Seed billing clients from Teamwork projects.
7. [x] Add the client mapping/settings screen skeleton.
8. [x] Add temporary Xero client and tax-rate dropdowns from the Google Sheet snapshot.
9. [x] Add standardized service mapping functions and tests.
10. [x] Add annual invoice export import into PostgreSQL, including admin-editable balances.
10a. [x] Add manual Annual Invoices entry screen for active clients and annual services.
11. [x] Add aggregated quote preview domain functions and tests.
12. [x] Persist quote previews and aggregated quote lines in PostgreSQL.
13. [x] Build Billing > Create Quote into the quote preview screen.
14. [x] Show aggregated quote lines, warnings, and totals.
15. [x] Show annual-covered category after annual invoice import exists.
16. [x] Allow manual lines in the data model, even if the first UI for adding them is simple.
17. [x] Do not push to live Xero yet.
18. [x] Add Send to Xero approval that prepares a Xero payload, books annual usage, logs the action, and locks the preview.
19. [x] Wire the live Xero OAuth/API transport and replace the prepared-only send mode when a Xero tenant is connected.

The first milestone is complete. Xero credentials, tenant connection, live document sending, live reference sync, and generated-row editing are now in place. The next major steps are manual document lines, fuller Xero sync-back for payment/status changes, and hosted VPS deployment hardening.

## Remaining Follow-Up Questions

No blocking questions before implementation starts.

Later, non-blocking decisions:

- Confirm the exact exported annual invoice file type once the first export is available: `.xlsx`, `.csv`, or `.tsv`.
- Decide whether Xero sync-back should start with scheduled polling or webhooks.
- Decide how the first hosted authentication system should invite/manage users.

## Answered Questions From Marius

Recorded here for traceability.

### Follow-Up Answers

1. Annual invoice import source:

Answer: Marius will export the data from Google Sheets and the backend will process it directly.

2. Confirmed standardized service labels:

Answer: confirmed.

3. Future services:

Answer: more services may be added later.

4. Annual invoice balance editing:

Answer: imported balances should be editable by admins only.

### Workflow Direction

1. Should the new app create Xero invoices directly, Xero quotes first, or both?

Answer: quote only

2. In the first usable version, should we stop at an internal invoice draft, or must it push to Xero?

Answer: push to Xero

3. When you say "invoices will be made here", do you mean the app becomes the source of truth and Xero receives a copy, or Xero remains the source of truth after push?

Answer: both, invoice is created here from teamwork data, its processed and sent to Xero, then at some point not initially we need to listen to xero for changes. sometimes CRMs make changes to invoices in Xero for various reasons and we need to be able to capture all of that

4. Should the old three-step workflow stay conceptually the same: create draft, aggregate, push?

Answer: no, we can skip the draft and make the aggregate straight up,

### Data And Storage

5. PostgreSQL is now the recommended database from the start. Should local development use Docker Compose PostgreSQL or a native PostgreSQL install on Windows?

Answer: no clue, whatever makes it easier to migrate to a VPS later

6. Will more than one person or computer need to create/review invoices at the same time?

Answer: yes, there will be multiple users and we will need admins and a user overview, but when deployed online

7. Should invoice drafts created on one computer be visible on another computer?

Answer: yes, when deployed online all data should be available to all users that have the rights to view it

8. Do we need to migrate existing invoice/quote history from the Google Sheet?

Answer: no, not yet

9. Do we need to import existing Xero quote/invoice history for reporting?

Answer: no not yet

9a. When we move to the VPS, should local invoice data be migrated as real production data, or should the VPS start empty and sync/import fresh data?

Answer: start empty

### Teamwork Data

10. Should invoice drafts be based on Teamwork time entries only, or can users add manual lines too?

Answer: also add manual lines

11. Should unbillable Teamwork time appear in invoice drafts as excluded warning rows, or be hidden by default?

Answer: we should make a comment and an option to mark it as billable with task reaggregation, so when its market billable unbillable the reaggregation should work on its own

12. Should zero-rate billable entries block invoice approval, or only show a warning?

Answer: these should show a warning with an option to add the rate and reprocess the draft, rate should be saved to that person, not only for this invoice

13. Should Teamwork time entries already linked to a Teamwork invoice ID be excluded from new drafts?

Answer: yes

14. Do we still need Teamwork tags in the new invoice workflow?

Answer: no

15. Are task names still the main way to determine services/item codes?

Answer: yes, but we dont use item codes anymore at all, we use a set of standardized services Filing, Correspondence  AGM, Publication  Annual compliance FS, Fi0ncial statement, Annual accounts CIT, Corporate income tax VAT, Value added tax

### Client And Price List Settings

16. Where should the first client settings come from: the current Google Sheet Client List, Teamwork projects, Xero contacts, or manual entry?

Answer: we will need a way to map teamwork projects to xero clients, see answer to question 21

17. Do you want a Settings screen in the app for client mappings, or is editing a config file acceptable for the first version?

Answer: screen is preferable

18. Is the default account code still `70330001`?

Answer: yes

19. Do the task inventory item code rules from the old script still apply?

Answer: no

20. Do we still need the Price List sheet concept, including explicit service names?

Answer: no

21. How should tax rates be chosen: from Xero, from a client setting, or manually per draft?

Answer: there should be a client overview where we can for each teamwork project (client) select a xero client, add a tax rate, a discount, etc

### Annual Invoice Logic

22. Should annual invoice usage be included in the first invoice version?

Answer: yes, mandatory

23. Is the external annual invoice spreadsheet still the source of truth?

Answer: no, it will be imported and managed in this app

24. If annual invoice usage stays, should the app update that Google Sheet, or should we migrate the usage data into the app?

Answer: migrate, see above

25. Are the monitored annual services from the script still correct: FS/financial statements/notes, AGM/publication, annual compliance, filing/correspondence, CIT, annual VAT?

Answer: yes

### Xero

26. Is Xero still the accounting system we should integrate with?

Answer: yes

27. Should we use Xero Quotes, Xero Invoices, or create quotes and later convert them?

Answer: initially quotes. Updated 2026-07-02: support both, with draft invoice as the default Send to Xero target and draft quote as an option.

28. Do you already have Xero OAuth app credentials for this new app, or only for the old Apps Script web app?

Answer: only for the old one, i think we should create a new app for this one

29. Should the app fetch and cache Xero contacts and tax rates?

Answer: yes

30. Should the app write back Xero quote/invoice IDs and statuses for reporting?

Answer: yes

31. Do we need duplicate-push protection exactly like the old Xero Quote Log?

Answer: yes, but we should show a warning when that happens

### Invoice UI

32. Should invoice lines be editable in a spreadsheet-like table, or in a cleaner table plus detail drawer/modal?

Answer: clean table plus drawer

33. Should users be able to edit quantities and rates, or only descriptions/comments/item codes?

Answer: yes edit all

34. Should aggregation be automatic, or should the user click an "Aggregate" button?

Answer: automatic

35. Should users be able to switch between raw time-entry lines and aggregated invoice lines?

Answer: no, we display aggregation directly

36. What should happen after an invoice is approved: lock it, allow edits with audit history, or allow free editing until pushed?

Answer: after it's sent to xero we log it with the amounts, then we listen to xero and log any changes and also when it was paid

### Reporting

37. Which invoice-based reporting views matter most?

Answer: per person, per client and per product (Filing, Correspondence  AGM, Publication  Annual compliance FS, Fi0ncial statement, Annual accounts CIT, Corporate income tax VAT, Value added tax)

38. Should reporting compare Teamwork worked value against actually invoiced value?

Answer: yes

39. Should annual-covered time count as billed, not billed, or a separate category?

Answer: seaprate category

40. Should draft invoices affect reporting, or only finalized/pushed invoices?

Answer: only pushed invoices

### Deployment And Security

41. Will this remain a local app for now, or should invoice work assume a hosted server soon?

Answer: hosted very soon

42. Should `admin/admin` stay for demo/local use, or do we need real users before invoice creation?

Answer: admin admin is fine for now

43. Are Teamwork and Xero credentials allowed to live only on each local computer, or should they be centrally configured?

Answer: centrally, and held very secure

44. Do we need audit logs for who created, edited, approved, or pushed invoices?

Answer: yes, audit logs available to admins that log absolutely every move of every user

### First Milestone

45. For the first invoice milestone, which is more useful:
    - A draft invoice preview from Teamwork data, no editing yet.
    - Editable draft invoice lines, no aggregation yet.
    - Aggregated invoice preview, no Xero yet.
    - Xero push from a manually reviewed draft.

Answer: Aggregated invoice preview, no Xero yet.

46. Which client/project should we use as the first test case?

Answer: import all of them and let me pick

47. Which billing period should we use for the first test case?

Answer: import all teamwork data from the beginning of 2026 and let me pick

48. Can I use the current local Teamwork data as the development fixture, or should we create a sanitized fixture?

Answer: i dont know
