insert into app_roles (name, description)
values ('admin', 'Can manage settings, annual usage, audit logs, and users.')
on conflict (name) do update
set description = excluded.description;

with seeded_users(email, display_name, password_hash) as (
  values
    (
      'smartinstudios@protonmail.com',
      'Smartin Studios',
      'scrypt:QEYAAQmw87INhVjzghdVsw:yjBB62Ue-sigL15ojRMQ7_9xLQsS_wSiuPPjQ6n-7MHHASScNDg44Ol2rV3P_w44w7Pv4dOEqDDCLIAv4N-4fw'
    ),
    (
      'irina.godmane@ziffer.lu',
      'Irina Godmane',
      'scrypt:dJRH4JcuMq3Yi2mz8bD4CA:0ygWTAj2Sl-yh_ConCCSPs3-QoQrTQyiUWo2nsi3kSj7zRiIac4vbNbo2YAwD_iv0s8wA6RMA_XkhGCIHGh6pQ'
    ),
    (
      'krista.jansone@ziffer.lu',
      'Krista Jansone',
      'scrypt:DvpMLyc1IHgANr2Rc-CWNA:-V9IHv48lBz6xgckUlAGP-Ic0q7ljnpj7qn6W71b1HiRNF2i7O9AS4FwlcmVGq2e7dUt3EMiqCQA9moSUkibZg'
    )
),
inserted_users as (
  insert into app_users (email, display_name, password_hash, status)
  select email, display_name, password_hash, 'active'
  from seeded_users
  on conflict (email) do nothing
  returning id, email
),
target_users as (
  select id
  from inserted_users
  union
  select app_users.id
  from app_users
  join seeded_users on lower(app_users.email) = lower(seeded_users.email)
  where app_users.status <> 'deleted'
)
insert into app_user_roles (user_id, role_id)
select target_users.id, app_roles.id
from target_users
cross join app_roles
where app_roles.name = 'admin'
on conflict (user_id, role_id) do nothing;
