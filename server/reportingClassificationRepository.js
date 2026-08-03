import { getDatabasePool } from "./db.js";
import { config } from "./config.js";

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function loadReportingClassificationContext(startDate, endDate) {
  const pool = getDatabasePool();
  if (!pool) {
    return { annualUsage: [], billingClients: [], confirmedAllocations: [], services: [], writeOffs: [] };
  }

  const [clientsResult, servicesResult, usageResult, confirmedResult, writeOffResult] = await Promise.all([
    pool.query(`
      select
        id,
        teamwork_project_id as "teamworkProjectId",
        display_name as "displayName",
        xero_client_name as "xeroClientName",
        xero_contact_id as "xeroContactId",
        account_code as "accountCode",
        currency,
        discount::float8 as discount,
        tax_type as "taxType",
        tax_rate_name as "taxRateName",
        maria_role as "mariaRole",
        status
      from billing_clients
      where teamwork_project_id is not null
        and teamwork_project_id <> ''
    `),
    pool.query(`
      select
        id,
        service_key as "serviceKey",
        label,
        aliases,
        annual_invoice_eligible as "annualInvoiceEligible",
        sort_order as "sortOrder"
      from standard_services
      where active = true
      order by sort_order, lower(label)
    `),
    pool.query(`
      select
        id as "usageId",
        billing_client_id as "billingClientId",
        service_id as "serviceId",
        max_hours::float8 as "annualHours",
        for_year as year,
        coverage_start::text as "coverageStart",
        coverage_end::text as "coverageEnd",
        period_source as "periodSource"
      from annual_invoice_usage
      where active = true
        and max_hours is not null
    `),
    pool.query(
      `
        with confirmed_documents as (
          select distinct on (document.quote_preview_id)
            document.id,
            document.quote_preview_id
          from xero_quotes document
          where document.document_type = 'draft_invoice'
            and document.xero_quote_id <> ''
            and upper(coalesce(document.status, '')) not in ('DELETED', 'VOIDED')
          order by document.quote_preview_id, document.pushed_at desc, document.id desc
        ),
        line_entries as (
          select
            line.id as line_id,
            entry.id as entry_id,
            entry.user_id,
            entry.project_id,
            line.annual_covered,
            line.include_in_xero,
            line.quantity_hours::numeric as line_hours,
            line.amount::numeric as line_amount,
            greatest(
              coalesce(nullif(snapshot.item ->> 'hours', '')::numeric, entry.hours::numeric, 0),
              0
            ) as snapshot_hours,
            greatest(
              coalesce(nullif(snapshot.item ->> 'userRate', '')::numeric, person.user_rate::numeric, 0),
              0
            ) as snapshot_rate
          from confirmed_documents document
          join quote_lines line on line.quote_preview_id = document.quote_preview_id
          join lateral unnest(line.source_time_entry_ids) source(entry_id) on true
          join teamwork_time_entries entry on entry.id = source.entry_id
          left join teamwork_users person on person.id = entry.user_id
          left join lateral (
            select item
            from jsonb_array_elements(coalesce(line.source_snapshot -> 'entries', '[]'::jsonb)) item
            where item ->> 'id' = source.entry_id
            order by case
              when coalesce((item ->> 'annualCovered')::boolean, false) = line.annual_covered then 0
              else 1
            end
            limit 1
          ) snapshot on true
          where line.is_billable = true
            and (line.include_in_xero = true or line.annual_covered = true)
            and entry.logged_on between $1::date and $2::date
        ),
        weighted_entries as (
          select
            line_entries.*,
            sum(snapshot_hours) over (partition by line_id) as line_snapshot_hours,
            sum(snapshot_hours * snapshot_rate) over (partition by line_id) as line_snapshot_amount,
            count(*) over (partition by line_id) as line_entry_count
          from line_entries
        )
        select
          entry_id as "entryId",
          user_id as "userId",
          project_id as "projectId",
          case when annual_covered then 'prepaid' else 'xero_billed' end as type,
          round(
            line_hours * case
              when line_snapshot_hours > 0 then snapshot_hours / line_snapshot_hours
              else 1::numeric / greatest(line_entry_count, 1)
            end,
            4
          )::float8 as hours,
          round(
            case
              when annual_covered then
                line_hours * case
                  when line_snapshot_hours > 0 then snapshot_hours / line_snapshot_hours
                  else 1::numeric / greatest(line_entry_count, 1)
                end * snapshot_rate
              else line_amount * case
                when line_snapshot_amount > 0 then (snapshot_hours * snapshot_rate) / line_snapshot_amount
                when line_snapshot_hours > 0 then snapshot_hours / line_snapshot_hours
                else 1::numeric / greatest(line_entry_count, 1)
              end
            end,
            2
          )::float8 as amount
        from weighted_entries
      `,
      [startDate, endDate]
    ),
    pool.query(
      `
        select
          allocation.teamwork_time_entry_id as "entryId",
          allocation.user_id as "userId",
          allocation.project_id as "projectId",
          allocation.allocated_hours::float8 as hours,
          allocation.allocated_amount::float8 as amount
        from reporting_time_allocations allocation
        join teamwork_time_entries entry on entry.id = allocation.teamwork_time_entry_id
        left join billing_clients client on client.teamwork_project_id = allocation.project_id
        where allocation.allocation_type = 'write_off'
          and entry.logged_on between $1::date and $2::date
          and coalesce(client.status, 'active') <> 'excluded'
      `,
      [startDate, endDate]
    )
  ]);

  return {
    annualUsage: usageResult.rows.map((row) => ({
      ...row,
      annualHours: row.annualHours === null ? null : number(row.annualHours),
      usedHours: 0,
      year: Number(row.year || 0)
    })),
    billingClients: clientsResult.rows,
    confirmedAllocations: confirmedResult.rows.map((row) => ({
      ...row,
      amount: number(row.amount),
      hours: number(row.hours)
    })),
    services: servicesResult.rows,
    writeOffs: writeOffResult.rows.map((row) => ({
      ...row,
      amount: number(row.amount),
      hours: number(row.hours)
    }))
  };
}

export async function recordInvoiceWriteOffAllocations(database, {
  actorUserId,
  previewId,
  xeroQuoteId
}) {
  const result = await database.query(
    `
      with preview_scope as (
        select billing_client_id, teamwork_project_id, period_start, period_end
        from quote_previews
        where id = $1
      ),
      source_entries as (
        select
          entry.id,
          entry.user_id,
          entry.project_id,
          entry.hours::numeric as source_hours,
          case
            when entry.user_id = $4 and client.maria_role = 'director' then 300
            when entry.user_id = $4 and client.maria_role = 'standard' then 750
            else coalesce(person.user_rate, 0)
          end::numeric as user_rate
        from teamwork_time_entries entry
        join preview_scope scope
          on scope.teamwork_project_id = entry.project_id
         and entry.logged_on between scope.period_start and scope.period_end
        left join teamwork_users person on person.id = entry.user_id
        left join billing_clients client on client.id = scope.billing_client_id
        where entry.is_billable = true
      ),
      line_source as (
        select
          line.id as line_id,
          line.include_in_xero,
          line.annual_covered,
          line.quantity_hours::numeric as line_hours,
          source.entry_id,
          greatest(coalesce((snapshot.item ->> 'hours')::numeric, entry.hours::numeric, 0), 0) as snapshot_hours
        from quote_lines line
        join lateral unnest(line.source_time_entry_ids) source(entry_id) on true
        left join teamwork_time_entries entry on entry.id = source.entry_id
        left join lateral (
          select item
          from jsonb_array_elements(coalesce(line.source_snapshot -> 'entries', '[]'::jsonb)) item
          where item ->> 'id' = source.entry_id
          order by case when coalesce((item ->> 'annualCovered')::boolean, false) = line.annual_covered then 0 else 1 end
          limit 1
        ) snapshot on true
        where line.quote_preview_id = $1
          and line.is_billable = true
      ),
      line_totals as (
        select line_id, greatest(sum(snapshot_hours), 0) as snapshot_total
        from line_source
        group by line_id
      ),
      represented as (
        select
          source.entry_id,
          sum(
            case
              when source.include_in_xero = true or source.annual_covered = true
              then source.snapshot_hours
                * least(1, case when totals.snapshot_total > 0 then source.line_hours / totals.snapshot_total else 0 end)
              else 0
            end
          ) as represented_hours
        from line_source source
        join line_totals totals on totals.line_id = source.line_id
        group by source.entry_id
      ),
      candidates as (
        select
          entry.id,
          entry.user_id,
          entry.project_id,
          entry.source_hours,
          entry.user_rate,
          greatest(entry.source_hours - coalesce(represented.represented_hours, 0), 0) as write_off_hours
        from source_entries entry
        left join represented on represented.entry_id = entry.id
      )
      insert into reporting_time_allocations (
        teamwork_time_entry_id,
        quote_preview_id,
        xero_quote_id,
        user_id,
        project_id,
        allocation_type,
        allocated_hours,
        allocated_amount,
        source_hours,
        created_by,
        metadata
      )
      select
        candidate.id,
        $1,
        $2,
        candidate.user_id,
        candidate.project_id,
        'write_off',
        candidate.write_off_hours,
        round(candidate.write_off_hours * candidate.user_rate, 2),
        candidate.source_hours,
        $3,
        jsonb_build_object('source', 'successful_xero_invoice')
      from candidates candidate
      where candidate.write_off_hours > 0
      on conflict (quote_preview_id, teamwork_time_entry_id, allocation_type)
      do update set
        xero_quote_id = excluded.xero_quote_id,
        allocated_hours = excluded.allocated_hours,
        allocated_amount = excluded.allocated_amount,
        source_hours = excluded.source_hours,
        created_by = excluded.created_by,
        metadata = excluded.metadata,
        updated_at = now()
      returning teamwork_time_entry_id
    `,
    [previewId, xeroQuoteId, actorUserId, config.mariaTeamworkUserId || ""]
  );

  return result.rowCount;
}
