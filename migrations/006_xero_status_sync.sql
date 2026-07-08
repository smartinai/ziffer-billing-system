alter table xero_quotes
  add column if not exists xero_status_synced_at timestamptz,
  add column if not exists xero_status_message text not null default '';

create index if not exists idx_xero_quotes_live_status_sync
  on xero_quotes (xero_status_synced_at, pushed_at)
  where xero_quote_id <> '';

update xero_quotes
set
  status = 'DRAFT',
  xero_status_message = case
    when xero_status_message = '' then 'Initial Xero status set to Draft; hourly sync will refresh it from Xero.'
    else xero_status_message
  end
where xero_quote_id <> ''
  and status in ('sent', 'pushed');
