alter table annual_invoice_usage
  add column if not exists coverage_start date,
  add column if not exists coverage_end date,
  add column if not exists period_source text not null default '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'annual_invoice_usage_coverage_period_check'
  ) then
    alter table annual_invoice_usage
      add constraint annual_invoice_usage_coverage_period_check
      check (
        (coverage_start is null and coverage_end is null)
        or (coverage_start is not null and coverage_end is not null and coverage_start <= coverage_end)
      );
  end if;
end
$$;

create unique index if not exists idx_annual_invoice_usage_client_service_period
  on annual_invoice_usage (billing_client_id, service_id, coverage_start, coverage_end)
  where coverage_start is not null and coverage_end is not null and active = true;

insert into standard_services (service_key, label, aliases, annual_invoice_eligible, sort_order)
values (
  'maintain_corporate_records',
  'Maintain corporate records',
  array[
    'maintain corporate records',
    'maintaining corporate records',
    'maintaining corporate records and shareholders register',
    'maintaining corporate records and shareholders registers'
  ],
  true,
  50
)
on conflict (service_key) do update
set
  label = excluded.label,
  aliases = excluded.aliases,
  annual_invoice_eligible = true,
  active = true,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into annual_invoice_services (service_id, label, default_max_hours, active)
select id, label, 12, true
from standard_services
where service_key = 'maintain_corporate_records'
on conflict (service_id) do update
set
  label = excluded.label,
  default_max_hours = 12,
  active = true,
  updated_at = now();
