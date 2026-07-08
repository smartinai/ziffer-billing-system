import dotenv from "dotenv";
import { createQuotePreview, sendQuotePreviewToXero } from "../server/quotePreviewRepository.js";
import { closeDatabase, getDatabasePool } from "../server/db.js";

dotenv.config();

const mockQuotes = [
  {
    clientName: "TDINVEST S.A. SPF",
    paidWithinDays: 9,
    periodEnd: "2026-06-30",
    periodStart: "2026-06-01",
    status: "mock_paid"
  },
  {
    clientName: "KPS Holding S.A.",
    paidWithinDays: 16,
    periodEnd: "2026-05-31",
    periodStart: "2026-05-01",
    status: "mock_paid"
  },
  {
    clientName: "AP Investments S.A. SPF",
    paidWithinDays: null,
    periodEnd: "2026-04-30",
    periodStart: "2026-04-01",
    status: "mock_open"
  }
];

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

async function restoreAnnualUsageForPreview(database, previewId) {
  const eventResult = await database.query(
    `
      select
        annual_invoice_usage_id as "usageId",
        previous_used_hours::float8 as "previousUsedHours"
      from annual_invoice_usage_events
      where action = 'quote_send_to_xero'
        and metadata->>'quotePreviewId' = $1
    `,
    [previewId]
  );

  for (const row of eventResult.rows) {
    await database.query(
      "update annual_invoice_usage set used_hours = $2, updated_at = now() where id = $1",
      [row.usageId, row.previousUsedHours]
    );
  }
}

async function clearMockQuotes(database) {
  const result = await database.query(
    `
      select id, quote_preview_id as "previewId"
      from xero_quotes
      where status in ('mock_paid', 'mock_open')
    `
  );

  for (const quote of result.rows) {
    if (quote.previewId) await restoreAnnualUsageForPreview(database, quote.previewId);
    await database.query(
      "delete from annual_invoice_usage_events where metadata->>'quotePreviewId' = $1",
      [quote.previewId]
    );
    await database.query("delete from xero_sync_logs where xero_quote_id = $1", [quote.id]);
    await database.query("delete from xero_quotes where id = $1", [quote.id]);
    if (quote.previewId) await database.query("delete from quote_previews where id = $1", [quote.previewId]);
  }

  return result.rowCount;
}

async function findBillingClient(database, clientName) {
  const result = await database.query(
    `
      select id
      from billing_clients
      where display_name = $1
        and status = 'active'
        and xero_client_name <> ''
        and xero_contact_id <> ''
        and tax_type <> ''
      limit 1
    `,
    [clientName]
  );

  if (!result.rowCount) {
    throw new Error(`Mapped active billing client not found: ${clientName}`);
  }

  return result.rows[0].id;
}

async function markAsMock(database, { paidWithinDays, preview, status, xeroQuoteLogId }) {
  const paidAmount = status === "mock_paid" ? Number(preview.totals?.amount || 0) : 0;
  const paidAt = status === "mock_paid" ? addDays(preview.quoteDate, paidWithinDays) : null;
  const xeroQuoteId = `MOCK-${preview.quoteNumber}`;

  await database.query(
    `
      update xero_quotes
      set
        status = $2,
        xero_quote_id = $3,
        xero_paid_amount = $4,
        xero_paid_at = $5,
        paid_within_days = $6,
        response = response || $7::jsonb
      where id = $1
    `,
    [
      xeroQuoteLogId,
      status,
      xeroQuoteId,
      paidAmount,
      paidAt,
      paidWithinDays,
      JSON.stringify({
        mockSeed: true,
        note: "Mock quote seeded from real Teamwork data for the Billing > Quotes view."
      })
    ]
  );
}

async function main() {
  const database = getDatabasePool();
  if (!database) throw new Error("DATABASE_URL is required to seed mock quotes.");

  const cleared = await clearMockQuotes(database);
  const seeded = [];

  for (const mockQuote of mockQuotes) {
    const billingClientId = await findBillingClient(database, mockQuote.clientName);
    const payload = await createQuotePreview({
      billingClientId,
      endDate: mockQuote.periodEnd,
      startDate: mockQuote.periodStart
    });
    const sent = await sendQuotePreviewToXero(payload.preview.id);
    await markAsMock(database, {
      paidWithinDays: mockQuote.paidWithinDays,
      preview: payload.preview,
      status: mockQuote.status,
      xeroQuoteLogId: sent.xero.xeroQuoteLogId
    });
    seeded.push({
      amount: sent.xero.amount,
      client: mockQuote.clientName,
      quoteNumber: payload.preview.quoteNumber,
      status: mockQuote.status
    });
  }

  console.log(JSON.stringify({ cleared, seeded }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
