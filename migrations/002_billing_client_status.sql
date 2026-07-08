alter table billing_clients
  add column if not exists status text not null default 'active';

update billing_clients
set status = case when active then 'active' else 'inactive' end
where status is null or status = '' or status = 'active';

update billing_clients
set active = status = 'active';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'billing_clients_status_check'
  ) then
    alter table billing_clients
      add constraint billing_clients_status_check
      check (status in ('active', 'inactive', 'excluded'));
  end if;
end $$;
