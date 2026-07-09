alter table xero_quotes
  add column if not exists xero_outstanding_amount numeric(12, 2) not null default 0;

update xero_quotes
set xero_outstanding_amount = greatest(coalesce(xero_sent_amount, amount, 0) - coalesce(xero_paid_amount, 0), 0)
where xero_outstanding_amount = 0
  and coalesce(xero_sent_amount, amount, 0) <> 0;
