create extension if not exists pgcrypto;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  display_name text not null,
  password_hash text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists app_user_roles (
  user_id uuid not null references app_users(id) on delete cascade,
  role_id uuid not null references app_roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete set null,
  action text not null,
  entity_type text not null default '',
  entity_id text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists teamwork_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  coverage_start date,
  coverage_end date,
  status text not null default 'running',
  pages_fetched integer not null default 0,
  partial boolean not null default false,
  warnings jsonb not null default '[]'::jsonb,
  source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists teamwork_users (
  id text primary key,
  sync_run_id uuid references teamwork_sync_runs(id) on delete set null,
  name text not null,
  email text not null default '',
  avatar_url text not null default '',
  company_id text not null default '',
  user_rate numeric(12, 2) not null default 0,
  user_cost numeric(12, 2) not null default 0,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists teamwork_projects (
  id text primary key,
  sync_run_id uuid references teamwork_sync_runs(id) on delete set null,
  name text not null,
  company_id text not null default '',
  company_name text not null default '',
  status text not null default 'active',
  is_billable boolean not null default true,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists teamwork_time_entries (
  id text primary key,
  sync_run_id uuid references teamwork_sync_runs(id) on delete set null,
  logged_on date not null,
  minutes integer not null default 0,
  hours numeric(12, 4) not null default 0,
  is_billable boolean not null default false,
  user_id text references teamwork_users(id) on delete set null,
  project_id text references teamwork_projects(id) on delete set null,
  task_id text not null default '',
  task_name text not null default '',
  description text not null default '',
  tags jsonb not null default '[]'::jsonb,
  teamwork_invoice_id text not null default '',
  created_at_source timestamptz,
  updated_at_source timestamptz,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists billing_clients (
  id uuid primary key default gen_random_uuid(),
  teamwork_project_id text unique references teamwork_projects(id) on delete set null,
  display_name text not null,
  xero_contact_id text not null default '',
  xero_client_name text not null default '',
  tax_rate_name text not null default '',
  tax_type text not null default '',
  discount numeric(8, 4) not null default 0,
  account_code text not null default '70330001',
  abbreviation text not null default '',
  currency text not null default 'EUR',
  active boolean not null default true,
  status text not null default 'active',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists standard_services (
  id uuid primary key default gen_random_uuid(),
  service_key text not null unique,
  label text not null,
  aliases text[] not null default '{}',
  annual_invoice_eligible boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists service_task_rules (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references standard_services(id) on delete cascade,
  pattern text not null,
  pattern_type text not null default 'contains',
  priority integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_id, pattern, pattern_type)
);

create table if not exists annual_invoice_services (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null unique references standard_services(id) on delete cascade,
  label text not null,
  default_max_hours numeric(12, 2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists annual_invoice_usage (
  id uuid primary key default gen_random_uuid(),
  billing_client_id uuid references billing_clients(id) on delete set null,
  service_id uuid references standard_services(id) on delete set null,
  source_client_name text not null default '',
  source_service_code text not null default '',
  source_service_name text not null,
  quantity numeric(12, 2) not null default 0,
  unit_price numeric(12, 2) not null default 0,
  invoiced_on date,
  max_hours numeric(12, 2),
  used_hours numeric(12, 2) not null default 0,
  for_year integer,
  valid_until date,
  invoice_number text not null default '',
  reference text not null default '',
  active boolean not null default true,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists annual_invoice_usage_events (
  id uuid primary key default gen_random_uuid(),
  annual_invoice_usage_id uuid references annual_invoice_usage(id) on delete set null,
  user_id uuid references app_users(id) on delete set null,
  action text not null,
  previous_used_hours numeric(12, 2),
  next_used_hours numeric(12, 2),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists quote_previews (
  id uuid primary key default gen_random_uuid(),
  billing_client_id uuid references billing_clients(id) on delete set null,
  teamwork_project_id text references teamwork_projects(id) on delete set null,
  sync_run_id uuid references teamwork_sync_runs(id) on delete set null,
  period_start date not null,
  period_end date not null,
  reference text not null default '',
  quote_number text not null default '',
  quote_date date,
  expiry_date date,
  status text not null default 'preview',
  warnings jsonb not null default '[]'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_preview_id uuid not null references quote_previews(id) on delete cascade,
  line_order integer not null default 0,
  service_id uuid references standard_services(id) on delete set null,
  source_type text not null default 'teamwork',
  source_time_entry_ids text[] not null default '{}',
  task_name text not null default '',
  description text not null,
  quantity_hours numeric(12, 4) not null default 0,
  unit_amount numeric(12, 2) not null default 0,
  amount numeric(12, 2) not null default 0,
  is_billable boolean not null default true,
  account_code text not null default '70330001',
  tax_type text not null default '',
  discount numeric(8, 4) not null default 0,
  annual_covered boolean not null default false,
  include_in_xero boolean not null default true,
  comments text not null default '',
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists quote_events (
  id uuid primary key default gen_random_uuid(),
  quote_preview_id uuid references quote_previews(id) on delete cascade,
  user_id uuid references app_users(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists xero_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default '',
  tenant_name text not null default '',
  status text not null default 'disconnected',
  scopes text[] not null default '{}',
  token_encrypted text,
  refresh_token_encrypted text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists xero_contacts (
  id text primary key,
  name text not null,
  email text not null default '',
  tax_number text not null default '',
  discount numeric(8, 4) not null default 0,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists xero_tax_rates (
  tax_type text primary key,
  name text not null,
  rate numeric(8, 4) not null default 0,
  status text not null default '',
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists xero_quotes (
  id uuid primary key default gen_random_uuid(),
  quote_preview_id uuid references quote_previews(id) on delete set null,
  xero_quote_id text not null default '',
  quote_number text not null default '',
  status text not null default '',
  line_count integer not null default 0,
  amount numeric(12, 2) not null default 0,
  idempotency_key text not null unique,
  response jsonb not null default '{}'::jsonb,
  pushed_by uuid references app_users(id) on delete set null,
  pushed_at timestamptz not null default now()
);

create table if not exists xero_sync_logs (
  id uuid primary key default gen_random_uuid(),
  xero_quote_id uuid references xero_quotes(id) on delete set null,
  direction text not null,
  action text not null,
  status text not null,
  payload jsonb not null default '{}'::jsonb,
  response jsonb not null default '{}'::jsonb,
  message text not null default '',
  created_at timestamptz not null default now()
);

insert into app_roles (name, description)
values
  ('admin', 'Can manage settings, annual usage, audit logs, and users.'),
  ('billing_user', 'Can prepare and review billing data.')
on conflict (name) do update set description = excluded.description;

insert into standard_services (service_key, label, aliases, annual_invoice_eligible, sort_order)
values
  ('filing_correspondence', 'Filing / Correspondence', array['filing', 'correspondence'], true, 10),
  ('agm_publication', 'AGM / Publication', array['agm', 'publication'], true, 20),
  ('annual_compliance', 'Annual compliance', array['annual compliance'], true, 30),
  ('financial_statements', 'FS / Financial statement / Annual accounts', array['fs', 'financial statement', 'financial statements', 'annual accounts'], true, 40),
  ('corporate_income_tax', 'CIT / Corporate income tax', array['cit', 'corporate income tax'], true, 50),
  ('value_added_tax', 'VAT / Value added tax', array['vat', 'value added tax'], true, 60)
on conflict (service_key) do update
set
  label = excluded.label,
  aliases = excluded.aliases,
  annual_invoice_eligible = excluded.annual_invoice_eligible,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into annual_invoice_services (service_id, label)
select id, label
from standard_services
where annual_invoice_eligible = true
on conflict (service_id) do update
set
  label = excluded.label,
  updated_at = now();

create index if not exists idx_audit_events_created_at on audit_events (created_at desc);
create index if not exists idx_teamwork_time_entries_logged_on on teamwork_time_entries (logged_on);
create index if not exists idx_teamwork_time_entries_project_date on teamwork_time_entries (project_id, logged_on);
create index if not exists idx_teamwork_time_entries_user_date on teamwork_time_entries (user_id, logged_on);
create index if not exists idx_teamwork_time_entries_invoice_id on teamwork_time_entries (teamwork_invoice_id);
create index if not exists idx_billing_clients_teamwork_project on billing_clients (teamwork_project_id);
create index if not exists idx_annual_invoice_usage_client_service_year on annual_invoice_usage (billing_client_id, service_id, for_year);
create index if not exists idx_quote_previews_project_period on quote_previews (teamwork_project_id, period_start, period_end);
create index if not exists idx_quote_lines_preview on quote_lines (quote_preview_id, line_order);
create index if not exists idx_xero_quotes_quote_preview on xero_quotes (quote_preview_id);
create index if not exists idx_xero_sync_logs_created_at on xero_sync_logs (created_at desc);
