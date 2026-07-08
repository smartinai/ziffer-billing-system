import { getDatabasePool } from "./db.js";

const aggregateKeys = ["excludingPrepaid", "sentToXero", "paidInXero"];

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

function emptyMetric() {
  return { amount: 0, hours: 0 };
}

function emptyAggregate() {
  return {
    excludingPrepaid: emptyMetric(),
    paidInXero: emptyMetric(),
    sentToXero: emptyMetric()
  };
}

function ensureAggregate(map, key) {
  if (!key) return null;
  if (!map.has(key)) map.set(key, emptyAggregate());
  return map.get(key);
}

function addMetric(target, metricName, hours, amount) {
  if (!target || !aggregateKeys.includes(metricName)) return;
  target[metricName].hours += number(hours);
  target[metricName].amount += number(amount);
}

function addToMaps(maps, { amount, hours, metricName, projectId, userId }) {
  if (!userId || !projectId) return;
  addMetric(ensureAggregate(maps.byUser, userId), metricName, hours, amount);
  addMetric(ensureAggregate(maps.byProject, projectId), metricName, hours, amount);
  addMetric(ensureAggregate(maps.byUserProject, `${userId}:${projectId}`), metricName, hours, amount);
  addMetric(ensureAggregate(maps.byProjectUser, `${projectId}:${userId}`), metricName, hours, amount);
}

function finalizeMetric(metric) {
  return {
    amount: round(metric?.amount || 0),
    hours: round(metric?.hours || 0)
  };
}

function finalizeAggregate(aggregate) {
  return {
    excludingPrepaid: finalizeMetric(aggregate.excludingPrepaid),
    paidInXero: finalizeMetric(aggregate.paidInXero),
    sentToXero: finalizeMetric(aggregate.sentToXero)
  };
}

function mapToObject(map) {
  return Object.fromEntries([...map.entries()].map(([key, aggregate]) => [key, finalizeAggregate(aggregate)]));
}

function emptyAggregateResult() {
  return {
    byProject: {},
    byProjectUser: {},
    byUser: {},
    byUserProject: {}
  };
}

function lineIsAggregateEligible(line) {
  return Boolean(line.isBillable) && line.includeInXero !== false && !line.annualCovered;
}

function lineEntryShares(line) {
  const entries = line.entries || [];
  const sourceHours = entries.reduce((sum, entry) => sum + number(entry.hours), 0);
  const lineHours = number(line.hours);
  const hourScale = sourceHours > 0 && lineHours > 0 ? lineHours / sourceHours : 1;
  const scaledEntries = entries.map((entry) => {
    const hours = number(entry.hours) * hourScale;
    return {
      ...entry,
      grossAmount: hours * number(entry.userRate),
      hours
    };
  });
  const grossAmount = scaledEntries.reduce((sum, entry) => sum + entry.grossAmount, 0);
  const scaledHours = scaledEntries.reduce((sum, entry) => sum + entry.hours, 0);
  const lineAmount = number(line.amount);

  return scaledEntries.map((entry) => {
    const share =
      grossAmount > 0
        ? entry.grossAmount / grossAmount
        : scaledHours > 0
          ? entry.hours / scaledHours
          : scaledEntries.length
            ? 1 / scaledEntries.length
            : 0;

    return {
      ...entry,
      amount: lineAmount * share
    };
  });
}

function groupRowsByLine(rows) {
  const lines = new Map();

  for (const row of rows) {
    const lineId = String(row.lineId || "");
    if (!lineId) continue;

    if (!lines.has(lineId)) {
      lines.set(lineId, {
        amount: number(row.lineAmount),
        annualCovered: Boolean(row.annualCovered),
        entries: [],
        hours: number(row.lineHours),
        id: lineId,
        includeInXero: row.includeInXero !== false,
        isBillable: Boolean(row.isBillable),
        quoteId: String(row.quoteId || ""),
        quotePaidAmount: number(row.quotePaidAmount),
        quoteSentAmount: number(row.quoteSentAmount)
      });
    }

    lines.get(lineId).entries.push({
      hours: number(row.entryHours),
      projectId: row.projectId ? String(row.projectId) : "",
      userId: row.userId ? String(row.userId) : "",
      userRate: number(row.userRate)
    });
  }

  return lines;
}

function quoteEligibleTotals(lines) {
  const totals = new Map();

  for (const line of lines.values()) {
    if (!lineIsAggregateEligible(line)) continue;
    totals.set(line.quoteId, number(totals.get(line.quoteId)) + number(line.amount));
  }

  return totals;
}

function quoteScale(line, quoteTotals) {
  const sentAmount = number(line.quoteSentAmount);
  const eligibleTotal = number(quoteTotals.get(line.quoteId));
  return sentAmount > 0 && eligibleTotal > 0 ? sentAmount / eligibleTotal : 1;
}

function quotePaidScale(line) {
  const sentAmount = number(line.quoteSentAmount);
  if (sentAmount <= 0) return 0;
  return Math.max(0, Math.min(number(line.quotePaidAmount) / sentAmount, 1));
}

export async function listReportingDocumentAggregates(startDate, endDate) {
  const pool = getDatabasePool();
  if (!pool) return emptyAggregateResult();

  const result = await pool.query(
    `
      select
        quote.id::text as "quoteId",
        quote.xero_sent_amount::float8 as "quoteSentAmount",
        quote.xero_paid_amount::float8 as "quotePaidAmount",
        line.id::text as "lineId",
        line.quantity_hours::float8 as "lineHours",
        line.amount::float8 as "lineAmount",
        line.is_billable as "isBillable",
        line.include_in_xero as "includeInXero",
        line.annual_covered as "annualCovered",
        entry.hours::float8 as "entryHours",
        entry.project_id as "projectId",
        entry.user_id as "userId",
        person.user_rate::float8 as "userRate",
        source.source_order as "sourceOrder"
      from xero_quotes quote
      join quote_previews preview on preview.id = quote.quote_preview_id
      join quote_lines line on line.quote_preview_id = preview.id
      join lateral unnest(line.source_time_entry_ids) with ordinality as source(entry_id, source_order) on true
      join teamwork_time_entries entry on entry.id::text = source.entry_id::text
      left join teamwork_users person on person.id = entry.user_id
      left join billing_clients client on client.id = preview.billing_client_id
      where entry.logged_on between $1::date and $2::date
        and quote.xero_quote_id <> ''
        and quote.xero_quote_id not like 'MOCK-%'
        and coalesce(client.status, 'active') <> 'excluded'
      order by quote.id, line.line_order, line.id, source.source_order
    `,
    [startDate, endDate]
  );

  const lines = groupRowsByLine(result.rows);
  const quoteTotals = quoteEligibleTotals(lines);
  const maps = {
    byProject: new Map(),
    byProjectUser: new Map(),
    byUser: new Map(),
    byUserProject: new Map()
  };

  for (const line of lines.values()) {
    if (!lineIsAggregateEligible(line)) continue;

    const sentScale = quoteScale(line, quoteTotals);
    const paidScale = quotePaidScale(line);

    for (const share of lineEntryShares(line)) {
      addToMaps(maps, {
        amount: share.amount,
        hours: share.hours,
        metricName: "excludingPrepaid",
        projectId: share.projectId,
        userId: share.userId
      });
      addToMaps(maps, {
        amount: share.amount * sentScale,
        hours: share.hours,
        metricName: "sentToXero",
        projectId: share.projectId,
        userId: share.userId
      });
      addToMaps(maps, {
        amount: share.amount * sentScale * paidScale,
        hours: share.hours * paidScale,
        metricName: "paidInXero",
        projectId: share.projectId,
        userId: share.userId
      });
    }
  }

  return {
    byProject: mapToObject(maps.byProject),
    byProjectUser: mapToObject(maps.byProjectUser),
    byUser: mapToObject(maps.byUser),
    byUserProject: mapToObject(maps.byUserProject)
  };
}

