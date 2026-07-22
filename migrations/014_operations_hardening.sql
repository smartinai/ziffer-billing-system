create table if not exists operation_runs (
  id uuid primary key default gen_random_uuid(),
  operation_type text not null,
  trigger text not null default 'scheduled',
  status text not null default 'running',
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  error_message text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint operation_runs_type_check check (
    operation_type in ('app_health', 'database_health', 'backup', 'restore_drill', 'teamwork_sync', 'xero_status', 'deployment', 'rollback', 'disk')
  ),
  constraint operation_runs_trigger_check check (trigger in ('manual', 'scheduled', 'deploy', 'monitor', 'import')),
  constraint operation_runs_status_check check (status in ('running', 'complete', 'failed', 'warning'))
);

create table if not exists alert_incidents (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null,
  component text not null,
  severity text not null default 'warning',
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  occurrence_count integer not null default 1,
  notification_sent_at timestamptz,
  reminder_sent_at timestamptz,
  resolved_at timestamptz,
  recovery_notification_sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint alert_incidents_severity_check check (severity in ('warning', 'critical')),
  constraint alert_incidents_occurrence_count_check check (occurrence_count > 0)
);

create index if not exists idx_operation_runs_latest_by_type
  on operation_runs (operation_type, started_at desc);

create index if not exists idx_operation_runs_latest_success
  on operation_runs (operation_type, finished_at desc)
  where status = 'complete';

create unique index if not exists idx_alert_incidents_open_dedupe
  on alert_incidents (dedupe_key)
  where resolved_at is null;

create index if not exists idx_alert_incidents_open_last_seen
  on alert_incidents (last_seen_at desc)
  where resolved_at is null;
