create table if not exists xero_items (
  code text primary key,
  id text not null default '',
  name text not null default '',
  description text not null default '',
  sales_unit_price numeric(18, 4),
  sales_account_code text not null default '',
  tax_type text not null default '',
  is_sold boolean not null default true,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists idx_xero_items_name
  on xero_items (lower(name), code);

alter table quote_lines
  add column if not exists item_code text not null default '';

create index if not exists idx_quote_lines_item_code
  on quote_lines (item_code)
  where item_code <> '';
