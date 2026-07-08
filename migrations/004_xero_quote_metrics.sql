alter table xero_quotes
  add column if not exists teamwork_estimate_amount numeric(12, 2) not null default 0,
  add column if not exists teamwork_chargeable_amount numeric(12, 2) not null default 0,
  add column if not exists xero_sent_amount numeric(12, 2) not null default 0,
  add column if not exists xero_paid_amount numeric(12, 2) not null default 0,
  add column if not exists xero_paid_at timestamptz,
  add column if not exists paid_within_days integer;

update xero_quotes
set
  teamwork_chargeable_amount = case when teamwork_chargeable_amount = 0 then amount else teamwork_chargeable_amount end,
  xero_sent_amount = case when xero_sent_amount = 0 then amount else xero_sent_amount end
where amount <> 0;

create index if not exists idx_xero_quotes_pushed_at on xero_quotes (pushed_at desc);
