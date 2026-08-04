alter table quote_lines
  add column if not exists original_task_name text,
  add column if not exists task_name_origin text,
  add column if not exists task_name_prompt_version text,
  add column if not exists task_name_updated_by uuid references app_users(id) on delete set null,
  add column if not exists task_name_updated_at timestamptz;

update quote_lines
set original_task_name = coalesce(
  nullif(source_snapshot -> 'entries' -> 0 ->> 'taskName', ''),
  task_name,
  ''
)
where original_task_name is null;

update quote_lines
set task_name_origin = case
  when source_type = 'manual' then 'manual'
  when task_name is distinct from original_task_name then 'manual'
  else 'teamwork'
end
where task_name_origin is null;

update quote_lines
set task_name_prompt_version = ''
where task_name_prompt_version is null;

alter table quote_lines
  alter column original_task_name set default '',
  alter column original_task_name set not null,
  alter column task_name_origin set default 'teamwork',
  alter column task_name_origin set not null,
  alter column task_name_prompt_version set default '',
  alter column task_name_prompt_version set not null;

alter table quote_lines
  drop constraint if exists quote_lines_task_name_origin_check;

alter table quote_lines
  add constraint quote_lines_task_name_origin_check
  check (task_name_origin in ('teamwork', 'manual', 'ai'));
