alter table teamwork_sync_runs
  add column if not exists trigger text not null default 'manual',
  add column if not exists fetch_start date,
  add column if not exists fetch_end date,
  add column if not exists attempt integer not null default 1,
  add column if not exists error_message text not null default '';

update teamwork_sync_runs
set
  fetch_start = coalesce(fetch_start, coverage_start),
  fetch_end = coalesce(fetch_end, coverage_end),
  trigger = case
    when trigger in ('manual', 'scheduled', 'import') then trigger
    else 'manual'
  end,
  attempt = greatest(attempt, 1)
where fetch_start is null
   or fetch_end is null
   or trigger not in ('manual', 'scheduled', 'import')
   or attempt < 1;

create index if not exists idx_teamwork_sync_runs_latest_success
  on teamwork_sync_runs (finished_at desc)
  where status = 'complete' and partial = false;

create index if not exists idx_teamwork_sync_runs_latest_attempt
  on teamwork_sync_runs (started_at desc);
