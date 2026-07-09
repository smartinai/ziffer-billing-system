import { getDatabasePool } from "./db.js";
import { fetchXeroDocumentStatus } from "./xeroClient.js";

function money(value) {
  return Number(value || 0);
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function days(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function statusLabel(status) {
  const labels = {
    ACCEPTED: "Accepted",
    AUTHORISED: "Authorised",
    DECLINED: "Declined",
    DELETED: "Deleted",
    DRAFT: "Draft",
    INVOICED: "Invoiced",
    mock_open: "Mock open",
    mock_paid: "Mock paid",
    PAID: "Paid",
    prepared: "Prepared",
    pushed: "Sent",
    SENT: "Sent",
    sent: "Sent",
    SUBMITTED: "Submitted",
    VOIDED: "Voided"
  };
  if (labels[status]) return labels[status];
  return String(status || "Unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function documentLabel(documentType) {
  return documentType === "draft_invoice" ? "Draft invoice" : "Draft quote";
}

function mapQuote(row) {
  const amountSentToXero = money(row.xeroSentAmount || row.amount);
  const paidAmount = money(row.xeroPaidAmount);
  const outstandingAmount = row.xeroOutstandingAmount === null || row.xeroOutstandingAmount === undefined
    ? Math.max(amountSentToXero - paidAmount, 0)
    : money(row.xeroOutstandingAmount);
  return {
    amountPaidInXero: paidAmount,
    amountSentToXero,
    billingClientId: row.billingClientId || "",
    clientName: row.clientName || "Unknown client",
    documentLabel: documentLabel(row.documentType),
    documentType: row.documentType || "draft_quote",
    id: row.id,
    initialTeamworkEstimate: money(row.teamworkEstimateAmount),
    outstandingAmount,
    paidAt: row.xeroPaidAt || null,
    paidWithinDays: days(row.paidWithinDays),
    periodEnd: row.periodEnd || "",
    periodStart: row.periodStart || "",
    preparedAt: row.pushedAt,
    quoteDate: row.quoteDate || "",
    quoteNumber: row.quoteNumber || "",
    reference: row.reference || "",
    status: row.status || "",
    statusLabel: statusLabel(row.status),
    teamworkAfterAnnual: money(row.teamworkChargeableAmount || row.xeroSentAmount || row.amount),
    xeroStatusMessage: row.xeroStatusMessage || "",
    xeroStatusSyncedAt: row.xeroStatusSyncedAt || null,
    xeroQuoteId: row.xeroQuoteId || ""
  };
}

function summarize(quotes) {
  const paidQuotes = quotes.filter((quote) => quote.amountPaidInXero > 0 && quote.paidWithinDays !== null);
  const avgPaidWithinDays = paidQuotes.length
    ? paidQuotes.reduce((sum, quote) => sum + quote.paidWithinDays, 0) / paidQuotes.length
    : null;

  return {
    avgPaidWithinDays: avgPaidWithinDays === null ? null : roundMoney(avgPaidWithinDays),
    outstandingAmount: roundMoney(quotes.reduce((sum, quote) => sum + quote.outstandingAmount, 0)),
    totalPaidAmount: roundMoney(quotes.reduce((sum, quote) => sum + quote.amountPaidInXero, 0)),
    totalQuotes: quotes.length,
    totalSentAmount: roundMoney(quotes.reduce((sum, quote) => sum + quote.amountSentToXero, 0)),
    totalTeamworkAfterAnnual: roundMoney(quotes.reduce((sum, quote) => sum + quote.teamworkAfterAnnual, 0)),
    totalTeamworkEstimate: roundMoney(quotes.reduce((sum, quote) => sum + quote.initialTeamworkEstimate, 0))
  };
}

function mapQuoteLine(row, entriesByLine) {
  const entries = entriesByLine.get(String(row.id)) || [];

  return {
    accountCode: row.accountCode || "",
    amount: money(row.amount),
    annualCovered: Boolean(row.annualCovered),
    annualYear: row.annualYear || null,
    comments: row.comments || "",
    description: row.description || "",
    discount: money(row.discount),
    entries,
    id: row.id,
    includeInXero: row.includeInXero !== false,
    isBillable: Boolean(row.isBillable),
    lineOrder: row.lineOrder || 0,
    quantityHours: money(row.quantityHours),
    serviceId: row.serviceId || "",
    sourceTimeEntryIds: row.sourceTimeEntryIds || [],
    taskName: row.taskName || "",
    taxType: row.taxType || "",
    unitAmount: money(row.unitAmount),
    warnings: Array.isArray(row.warnings) ? row.warnings : []
  };
}

async function loadSentQuoteLines(pool, previewId) {
  if (!previewId) return [];

  const linesResult = await pool.query(
    `
      select
        id,
        line_order as "lineOrder",
        service_id as "serviceId",
        source_time_entry_ids as "sourceTimeEntryIds",
        annual_year as "annualYear",
        task_name as "taskName",
        description,
        quantity_hours::float8 as "quantityHours",
        unit_amount::float8 as "unitAmount",
        amount::float8 as amount,
        is_billable as "isBillable",
        account_code as "accountCode",
        tax_type as "taxType",
        discount::float8 as discount,
        annual_covered as "annualCovered",
        include_in_xero as "includeInXero",
        comments,
        warnings
      from quote_lines
      where quote_preview_id = $1
      order by line_order, id
    `,
    [previewId]
  );

  const entriesResult = await pool.query(
    `
      select
        line.id::text as "lineId",
        entry.id,
        entry.logged_on::text as "loggedOn",
        entry.minutes,
        entry.hours::float8 as hours,
        entry.is_billable as "isBillable",
        entry.user_id as "userId",
        entry.project_id as "projectId",
        entry.task_id as "taskId",
        entry.task_name as "taskName",
        entry.description,
        entry.teamwork_invoice_id as "teamworkInvoiceId",
        person.name as "userName",
        person.user_rate::float8 as "userRate",
        source.source_order as "sourceOrder"
      from quote_lines line
      join lateral unnest(line.source_time_entry_ids) with ordinality as source(entry_id, source_order) on true
      join teamwork_time_entries entry on entry.id::text = source.entry_id::text
      left join teamwork_users person on person.id = entry.user_id
      where line.quote_preview_id = $1
      order by line.line_order, line.id, source.source_order
    `,
    [previewId]
  );

  const entriesByLine = new Map();
  for (const entry of entriesResult.rows) {
    const lineEntries = entriesByLine.get(entry.lineId) || [];
    lineEntries.push({
      date: entry.loggedOn || "",
      description: entry.description || "",
      hours: money(entry.hours),
      id: entry.id,
      isBillable: Boolean(entry.isBillable),
      minutes: Number(entry.minutes || 0),
      projectId: entry.projectId || "",
      taskId: entry.taskId || "",
      taskName: entry.taskName || "",
      teamworkInvoiceId: entry.teamworkInvoiceId || "",
      userId: entry.userId || "",
      userName: entry.userName || "",
      userRate: money(entry.userRate)
    });
    entriesByLine.set(entry.lineId, lineEntries);
  }

  return linesResult.rows
    .map((line) => mapQuoteLine(line, entriesByLine))
    .filter((line) => line.isBillable && line.includeInXero !== false && !line.annualCovered);
}

export async function listBillingQuotes() {
  const pool = getDatabasePool();
  if (!pool) {
    const error = new Error("DATABASE_URL is not configured.");
    error.statusCode = 503;
    throw error;
  }

  const result = await pool.query(
    `
      select
        quote.id,
        quote.quote_preview_id as "quotePreviewId",
        coalesce(quote.document_type, 'draft_quote') as "documentType",
        quote.xero_quote_id as "xeroQuoteId",
        quote.quote_number as "quoteNumber",
        quote.status,
        quote.response,
        quote.amount::float8 as amount,
        quote.teamwork_estimate_amount::float8 as "teamworkEstimateAmount",
        quote.teamwork_chargeable_amount::float8 as "teamworkChargeableAmount",
        quote.xero_sent_amount::float8 as "xeroSentAmount",
        quote.xero_paid_amount::float8 as "xeroPaidAmount",
        quote.xero_outstanding_amount::float8 as "xeroOutstandingAmount",
        quote.xero_paid_at as "xeroPaidAt",
        quote.xero_status_message as "xeroStatusMessage",
        quote.xero_status_synced_at as "xeroStatusSyncedAt",
        quote.paid_within_days as "paidWithinDays",
        quote.pushed_at as "pushedAt",
        preview.period_start::text as "periodStart",
        preview.period_end::text as "periodEnd",
        preview.quote_date::text as "quoteDate",
        preview.reference,
        client.id as "billingClientId",
        client.display_name as "clientName"
      from xero_quotes quote
      left join quote_previews preview on preview.id = quote.quote_preview_id
      left join billing_clients client on client.id = preview.billing_client_id
      order by quote.pushed_at desc, quote.quote_number desc
    `
  );

  const quotes = result.rows.map(mapQuote);
  return {
    quotes,
    summary: summarize(quotes)
  };
}

export async function getBillingQuoteDetail(id) {
  const pool = getDatabasePool();
  if (!pool) {
    const error = new Error("DATABASE_URL is not configured.");
    error.statusCode = 503;
    throw error;
  }

  const result = await pool.query(
    `
      select
        quote.id,
        quote.quote_preview_id as "quotePreviewId",
        coalesce(quote.document_type, 'draft_quote') as "documentType",
        quote.xero_quote_id as "xeroQuoteId",
        quote.quote_number as "quoteNumber",
        quote.status,
        quote.response,
        quote.amount::float8 as amount,
        quote.teamwork_estimate_amount::float8 as "teamworkEstimateAmount",
        quote.teamwork_chargeable_amount::float8 as "teamworkChargeableAmount",
        quote.xero_sent_amount::float8 as "xeroSentAmount",
        quote.xero_paid_amount::float8 as "xeroPaidAmount",
        quote.xero_outstanding_amount::float8 as "xeroOutstandingAmount",
        quote.xero_paid_at as "xeroPaidAt",
        quote.xero_status_message as "xeroStatusMessage",
        quote.xero_status_synced_at as "xeroStatusSyncedAt",
        quote.paid_within_days as "paidWithinDays",
        quote.pushed_at as "pushedAt",
        preview.period_start::text as "periodStart",
        preview.period_end::text as "periodEnd",
        preview.quote_date::text as "quoteDate",
        preview.reference,
        client.id as "billingClientId",
        client.display_name as "clientName"
      from xero_quotes quote
      left join quote_previews preview on preview.id = quote.quote_preview_id
      left join billing_clients client on client.id = preview.billing_client_id
      where quote.id = $1
      limit 1
    `,
    [id]
  );

  if (!result.rowCount) {
    const error = new Error("Document not found.");
    error.statusCode = 404;
    throw error;
  }

  const logsResult = await pool.query(
    `
      select
        id,
        direction,
        action,
        status,
        payload,
        response,
        message,
        created_at as "createdAt"
      from xero_sync_logs
      where xero_quote_id = $1
      order by created_at desc
    `,
    [id]
  );

  const logs = logsResult.rows.map((log) => ({
    action: log.action,
    createdAt: log.createdAt,
    direction: log.direction,
    id: log.id,
    message: log.message || "",
    payload: log.payload || {},
    response: log.response || {},
    status: log.status || ""
  }));
  const outbound = logs.find((log) => log.direction === "outbound") || null;
  const inbound = logs.find((log) => log.direction === "inbound") || null;
  const lines = await loadSentQuoteLines(pool, result.rows[0].quotePreviewId);

  return {
    latestResponse: inbound?.response || result.rows[0].response || outbound?.response || {},
    lines,
    logs,
    payload: outbound?.payload || {},
    quote: mapQuote(result.rows[0])
  };
}

function parseXeroDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const text = String(value);
  const dotNetDate = /\/Date\((\d+)/.exec(text);
  if (dotNetDate) return new Date(Number(dotNetDate[1]));

  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function latestPaymentDate(document) {
  const paymentDates = [
    document?.FullyPaidOnDate,
    ...(Array.isArray(document?.Payments) ? document.Payments.map((payment) => payment.Date) : [])
  ]
    .map(parseXeroDate)
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime());

  return paymentDates[0] || null;
}

function paidWithinDays(quoteDate, paidAt) {
  const start = parseXeroDate(quoteDate);
  const end = parseXeroDate(paidAt);
  if (!start || !end) return null;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
}

function xeroPaidAmount(document) {
  const amount = Number(document?.AmountPaid || 0);
  return Number.isFinite(amount) ? roundMoney(amount) : 0;
}

function xeroPaidAt(document, paidAmount) {
  if (paidAmount <= 0) return null;
  return latestPaymentDate(document)?.toISOString() || null;
}

function xeroOutstandingAmount(document, sentAmount, paidAmount) {
  const amountDue = Number(document?.AmountDue);
  if (Number.isFinite(amountDue)) return roundMoney(Math.max(amountDue, 0));
  return roundMoney(Math.max(Number(sentAmount || 0) - Number(paidAmount || 0), 0));
}

async function logStatusSync(pool, { error, quoteId, request, response, status }) {
  await pool.query(
    `
      insert into xero_sync_logs (
        xero_quote_id,
        direction,
        action,
        status,
        payload,
        response,
        message
      )
      values ($1, 'inbound', 'status_sync', $2, $3, $4, $5)
    `,
    [
      quoteId,
      error ? "error" : status,
      JSON.stringify(request || {}),
      JSON.stringify(response || {}),
      error?.message || `Fetched Xero status ${status || "Unknown"}.`
    ]
  );
}

export async function syncXeroDocumentStatuses(input = {}) {
  const pool = getDatabasePool();
  if (!pool) {
    return { connected: false, failed: 0, skipped: 0, synced: 0 };
  }

  const quoteId = input.quoteId || input.id || null;
  const result = await pool.query(
    `
      select
        quote.id,
        coalesce(quote.document_type, 'draft_quote') as "documentType",
        quote.xero_quote_id as "xeroDocumentId",
        quote.quote_number as "quoteNumber",
        quote.xero_sent_amount::float8 as "xeroSentAmount",
        preview.quote_date::text as "quoteDate"
      from xero_quotes quote
      left join quote_previews preview on preview.id = quote.quote_preview_id
      where quote.xero_quote_id <> ''
        and quote.status not in ('mock_open', 'mock_paid', 'prepared')
        and ($1::uuid is null or quote.id = $1::uuid)
      order by quote.xero_status_synced_at nulls first, quote.pushed_at desc
    `,
    [quoteId]
  );

  let failed = 0;
  let skipped = 0;
  let synced = 0;

  for (const row of result.rows) {
    const request = {
      documentId: row.xeroDocumentId,
      documentType: row.documentType,
      quoteNumber: row.quoteNumber
    };

    try {
      const fetched = await fetchXeroDocumentStatus({
        documentId: row.xeroDocumentId,
        documentType: row.documentType
      });

      if (fetched.mode !== "live") {
        skipped += 1;
        continue;
      }

      const document = fetched.document || {};
      const status = fetched.xeroStatus || fetched.status || "Unknown";
      const paidAmount = xeroPaidAmount(document);
      const outstandingAmount = xeroOutstandingAmount(document, row.xeroSentAmount, paidAmount);
      const paidAt = xeroPaidAt(document, paidAmount);
      const paidDays = paidWithinDays(row.quoteDate, paidAt);

      await pool.query(
        `
          update xero_quotes
          set
            status = $2,
            xero_paid_amount = $3,
            xero_paid_at = $4,
            paid_within_days = $5,
            xero_outstanding_amount = $6,
            response = $7,
            xero_status_message = $8,
            xero_status_synced_at = now()
          where id = $1
        `,
        [
          row.id,
          status,
          paidAmount,
          paidAt,
          paidDays,
          outstandingAmount,
          JSON.stringify(fetched.payload || {}),
          `Fetched Xero status ${status}.`
        ]
      );

      await logStatusSync(pool, {
        quoteId: row.id,
        request,
        response: fetched.payload || {},
        status
      });
      synced += 1;
    } catch (error) {
      failed += 1;
      await pool.query(
        `
          update xero_quotes
          set
            xero_status_message = $2,
            xero_status_synced_at = now()
          where id = $1
        `,
        [row.id, error.message || "Xero status sync failed."]
      );
      await logStatusSync(pool, {
        error,
        quoteId: row.id,
        request,
        response: error.response || {},
        status: "error"
      });
    }
  }

  return {
    connected: skipped < result.rows.length,
    failed,
    skipped,
    synced,
    total: result.rows.length
  };
}

let xeroStatusPoller = null;

export function startXeroStatusPoller({ intervalMs = 60 * 60 * 1000 } = {}) {
  if (xeroStatusPoller || !intervalMs || intervalMs < 60 * 1000) return xeroStatusPoller;

  xeroStatusPoller = setInterval(() => {
    syncXeroDocumentStatuses().catch((error) => {
      console.error(`Xero status sync failed: ${error.message}`);
    });
  }, intervalMs);
  xeroStatusPoller.unref?.();
  return xeroStatusPoller;
}
