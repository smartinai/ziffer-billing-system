create table if not exists reporting_time_allocations (
  id uuid primary key default gen_random_uuid(),
  teamwork_time_entry_id text not null references teamwork_time_entries(id) on delete cascade,
  quote_preview_id uuid not null references quote_previews(id) on delete cascade,
  xero_quote_id uuid references xero_quotes(id) on delete set null,
  user_id text references teamwork_users(id) on delete set null,
  project_id text references teamwork_projects(id) on delete set null,
  allocation_type text not null,
  allocated_hours numeric(12, 4) not null default 0,
  allocated_amount numeric(14, 2) not null default 0,
  source_hours numeric(12, 4) not null default 0,
  created_by uuid references app_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporting_time_allocations_type_check
    check (allocation_type in ('write_off')),
  constraint reporting_time_allocations_hours_check
    check (allocated_hours >= 0 and source_hours >= 0),
  constraint reporting_time_allocations_unique
    unique (quote_preview_id, teamwork_time_entry_id, allocation_type)
);

create index if not exists idx_reporting_allocations_entry
  on reporting_time_allocations (teamwork_time_entry_id);

create index if not exists idx_reporting_allocations_user_created
  on reporting_time_allocations (user_id, created_at);

create index if not exists idx_reporting_allocations_project_created
  on reporting_time_allocations (project_id, created_at);

create index if not exists idx_reporting_allocations_preview
  on reporting_time_allocations (quote_preview_id);
