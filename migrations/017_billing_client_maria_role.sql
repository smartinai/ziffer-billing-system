alter table billing_clients
  add column if not exists maria_role text not null default 'standard';

update billing_clients
set maria_role = 'standard'
where maria_role is null
   or maria_role not in ('director', 'standard');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'billing_clients_maria_role_check'
  ) then
    alter table billing_clients
      add constraint billing_clients_maria_role_check
      check (maria_role in ('director', 'standard'));
  end if;
end
$$;
