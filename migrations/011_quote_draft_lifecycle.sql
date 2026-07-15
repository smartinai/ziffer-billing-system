alter table quote_previews
  add column if not exists document_type text not null default 'draft_invoice',
  add column if not exists version bigint not null default 1,
  add column if not exists last_edited_by uuid references app_users(id) on delete set null,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references app_users(id) on delete set null,
  add column if not exists editing_by uuid references app_users(id) on delete set null,
  add column if not exists editing_session_id uuid,
  add column if not exists editing_expires_at timestamptz;

alter table quote_lines
  add column if not exists source_snapshot jsonb not null default '{}'::jsonb;

update quote_previews preview
set created_by = (
  select audit.user_id
  from audit_events audit
  where audit.entity_type = 'quote_preview'
    and audit.entity_id = preview.id::text
    and audit.action = 'document_preview_create'
    and audit.user_id is not null
  order by audit.created_at, audit.id
  limit 1
)
where preview.created_by is null
  and exists (
    select 1
    from audit_events audit
    where audit.entity_type = 'quote_preview'
      and audit.entity_id = preview.id::text
      and audit.action = 'document_preview_create'
      and audit.user_id is not null
  );

update quote_previews
set last_edited_by = created_by
where last_edited_by is null
  and created_by is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quote_previews_document_type_check'
      and conrelid = 'quote_previews'::regclass
  ) then
    alter table quote_previews
      add constraint quote_previews_document_type_check
      check (document_type in ('draft_invoice', 'draft_quote'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'quote_previews_version_check'
      and conrelid = 'quote_previews'::regclass
  ) then
    alter table quote_previews
      add constraint quote_previews_version_check
      check (version > 0);
  end if;
end
$$;

create index if not exists idx_quote_previews_created_by on quote_previews (created_by);
create index if not exists idx_quote_previews_last_edited_by on quote_previews (last_edited_by);
create index if not exists idx_quote_previews_archived_by on quote_previews (archived_by);
create index if not exists idx_quote_previews_editing_by on quote_previews (editing_by);

create index if not exists idx_quote_previews_active_drafts
  on quote_previews (updated_at desc, id)
  where status = 'preview' and archived_at is null;

create index if not exists idx_quote_previews_archived_drafts
  on quote_previews (archived_at desc, id)
  where status = 'preview' and archived_at is not null;
