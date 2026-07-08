create table if not exists xero_accounts (
  code text primary key,
  id text not null default '',
  name text not null default '',
  type text not null default '',
  status text not null default '',
  tax_type text not null default '',
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists idx_xero_accounts_status_type
  on xero_accounts (status, type, lower(name));
