create table if not exists xero_send_attempts (
  id uuid primary key default gen_random_uuid(),
  quote_preview_id uuid not null references quote_previews(id) on delete cascade,
  document_type text not null default 'draft_invoice',
  idempotency_key text not null unique,
  expected_version integer not null,
  state text not null default 'pending',
  attempt_count integer not null default 1,
  requested_by uuid references app_users(id) on delete set null,
  xero_document_id text not null default '',
  xero_quote_id text not null default '',
  last_error text not null default '',
  request_summary jsonb not null default '{}'::jsonb,
  response_summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default clock_timestamp(),
  last_attempt_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint xero_send_attempts_document_type_check check (document_type in ('draft_invoice', 'draft_quote')),
  constraint xero_send_attempts_state_check check (state in ('pending', 'sending', 'unknown', 'succeeded', 'failed')),
  constraint xero_send_attempts_count_check check (attempt_count > 0)
);

alter table quote_previews
  add column if not exists send_state text not null default 'idle',
  add column if not exists active_send_attempt_id uuid references xero_send_attempts(id) on delete set null;

alter table quote_previews drop constraint if exists quote_previews_send_state_check;
alter table quote_previews
  add constraint quote_previews_send_state_check check (send_state in ('idle', 'sending', 'unknown', 'succeeded', 'failed'));

create index if not exists idx_xero_send_attempts_preview_latest
  on xero_send_attempts (quote_preview_id, created_at desc);

create index if not exists idx_xero_send_attempts_unresolved
  on xero_send_attempts (last_attempt_at)
  where state in ('pending', 'sending', 'unknown');

create index if not exists idx_quote_previews_active_send_attempt
  on quote_previews (active_send_attempt_id)
  where active_send_attempt_id is not null;
