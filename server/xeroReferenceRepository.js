import { getDatabasePool, query } from "./db.js";
import { config } from "./config.js";
import { fetchXeroReferenceData } from "./xeroClient.js";

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function contactRow(row) {
  const id = row.id || "";
  return {
    discount: toNumber(row.discount),
    email: row.email || "",
    id,
    name: row.name || "",
    taxNumber: row.tax_number || "",
    xeroContactId: id.startsWith("sheet:") ? "" : id
  };
}

function taxRateRow(row) {
  return {
    name: row.name || "",
    rate: toNumber(row.rate),
    status: row.status || "",
    taxType: row.tax_type || ""
  };
}

function accountRow(row) {
  return {
    code: row.code || "",
    id: row.id || "",
    name: row.name || "",
    status: row.status || "",
    taxType: row.tax_type || "",
    type: row.type || ""
  };
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function toLiveContact(contact) {
  const id = firstText(contact.ContactID, contact.contactID, contact.id);
  const name = firstText(
    contact.ContactName,
    contact.Name,
    [contact.FirstName, contact.LastName].filter(Boolean).join(" "),
    contact.EmailAddress,
    id
  );
  if (!id || !name) return null;

  return {
    discount: toNumber(contact.Discount),
    email: firstText(contact.EmailAddress),
    id,
    name,
    raw: contact || {},
    taxNumber: firstText(contact.TaxNumber)
  };
}

function toLiveTaxRate(taxRate) {
  const taxType = firstText(taxRate.TaxType, taxRate.taxType);
  const name = firstText(taxRate.Name, taxRate.name, taxType);
  if (!taxType || !name) return null;

  return {
    name,
    rate: toNumber(taxRate.EffectiveRate, toNumber(taxRate.DisplayTaxRate)),
    raw: taxRate || {},
    status: firstText(taxRate.Status, taxRate.status),
    taxType
  };
}

function toLiveAccount(account) {
  const code = firstText(account.Code, account.code);
  const name = firstText(account.Name, account.name, code);
  if (!code || !name) return null;

  return {
    code,
    id: firstText(account.AccountID, account.accountID, account.id),
    name,
    raw: account || {},
    status: firstText(account.Status, account.status),
    taxType: firstText(account.TaxType, account.taxType),
    type: firstText(account.Type, account.type, account.Class, account.class)
  };
}

async function xeroReferenceCacheState(database) {
  const result = await database.query(`
    select
      (select count(*)::int from xero_contacts where id not like 'sheet:%') as contacts,
      (select count(*)::int from xero_tax_rates) as tax_rates,
      (select count(*)::int from xero_accounts) as accounts,
      least(
        coalesce((select max(synced_at) from xero_contacts where id not like 'sheet:%'), 'epoch'::timestamptz),
        coalesce((select max(synced_at) from xero_tax_rates), 'epoch'::timestamptz),
        coalesce((select max(synced_at) from xero_accounts), 'epoch'::timestamptz)
      ) as oldest_synced_at
  `);
  const row = result.rows[0] || {};
  const oldestSyncedAt = row.oldest_synced_at ? new Date(row.oldest_synced_at).getTime() : 0;
  const hasReferenceData = Number(row.contacts || 0) > 0 && Number(row.tax_rates || 0) > 0 && Number(row.accounts || 0) > 0;
  return {
    hasReferenceData,
    oldestSyncedAt,
    fresh: hasReferenceData && oldestSyncedAt > Date.now() - config.xeroReferenceSyncTtlMs
  };
}

export async function syncXeroReferenceData({ force = false } = {}) {
  const pool = getDatabasePool();
  if (!pool) {
    return {
      connected: false,
      message: "DATABASE_URL is not configured.",
      synced: false
    };
  }

  if (!force) {
    const cacheState = await xeroReferenceCacheState(pool);
    if (cacheState.fresh) {
      return {
        cached: true,
        connected: true,
        message: "Cached Xero reference data is still fresh.",
        synced: false,
        syncedAt: new Date(cacheState.oldestSyncedAt).toISOString()
      };
    }
  }

  const liveReference = await fetchXeroReferenceData();
  if (liveReference.mode !== "live") {
    return {
      connected: false,
      message: "Xero is not connected; cached reference data was used.",
      synced: false
    };
  }

  const contacts = (liveReference.contacts || []).map(toLiveContact).filter(Boolean);
  const taxRates = (liveReference.taxRates || []).map(toLiveTaxRate).filter(Boolean);
  const accounts = (liveReference.accounts || []).map(toLiveAccount).filter(Boolean);
  const database = await pool.connect();

  try {
    await database.query("begin");

    for (const contact of contacts) {
      await database.query(
        `
          insert into xero_contacts (id, name, email, tax_number, discount, raw, synced_at)
          values ($1, $2, $3, $4, $5, $6, now())
          on conflict (id) do update
          set name = excluded.name,
              email = excluded.email,
              tax_number = excluded.tax_number,
              discount = excluded.discount,
              raw = excluded.raw,
              synced_at = now()
        `,
        [
          contact.id,
          contact.name,
          contact.email,
          contact.taxNumber,
          contact.discount,
          JSON.stringify(contact.raw)
        ]
      );
    }

    for (const taxRate of taxRates) {
      await database.query(
        `
          insert into xero_tax_rates (tax_type, name, rate, status, raw, synced_at)
          values ($1, $2, $3, $4, $5, now())
          on conflict (tax_type) do update
          set name = excluded.name,
              rate = excluded.rate,
              status = excluded.status,
              raw = excluded.raw,
              synced_at = now()
        `,
        [
          taxRate.taxType,
          taxRate.name,
          taxRate.rate,
          taxRate.status,
          JSON.stringify(taxRate.raw)
        ]
      );
    }

    for (const account of accounts) {
      await database.query(
        `
          insert into xero_accounts (code, id, name, type, status, tax_type, raw, synced_at)
          values ($1, $2, $3, $4, $5, $6, $7, now())
          on conflict (code) do update
          set id = excluded.id,
              name = excluded.name,
              type = excluded.type,
              status = excluded.status,
              tax_type = excluded.tax_type,
              raw = excluded.raw,
              synced_at = now()
        `,
        [
          account.code,
          account.id,
          account.name,
          account.type,
          account.status,
          account.taxType,
          JSON.stringify(account.raw)
        ]
      );
    }

    if (contacts.length) {
      await database.query("delete from xero_contacts where id like 'sheet:%'");
    }

    await database.query("commit");

    return {
      connected: true,
      contacts: contacts.length,
      taxRates: taxRates.length,
      accounts: accounts.length,
      synced: true,
      syncedAt: new Date().toISOString(),
      tenantName: liveReference.tenantName || ""
    };
  } catch (error) {
    await database.query("rollback");
    throw error;
  } finally {
    database.release();
  }
}

export async function listXeroContacts() {
  const result = await query(`
    select id, name, email, tax_number, discount
    from xero_contacts
    where id not like 'sheet:%'
       or not exists (
         select 1
         from xero_contacts live_contact
         where live_contact.id not like 'sheet:%'
       )
    order by lower(name), id
  `);

  return result.rows.map(contactRow);
}

export async function listXeroTaxRates() {
  const result = await query(`
    select tax_type, name, rate, status
    from xero_tax_rates
    order by lower(name), tax_type
  `);

  return result.rows.map(taxRateRow);
}

export async function listXeroAccounts() {
  const pool = getDatabasePool();
  if (!pool) return [];

  const result = await query(`
    select code, id, name, type, status, tax_type
    from xero_accounts
    where coalesce(nullif(status, ''), 'ACTIVE') = 'ACTIVE'
    order by lower(name), code
  `);

  return result.rows.map(accountRow);
}

export async function getXeroReference({ force = false, sync = false } = {}) {
  let syncResult = null;
  if (sync) {
    try {
      syncResult = await syncXeroReferenceData({ force });
    } catch (error) {
      syncResult = {
        error: error.message,
        synced: false
      };
    }
  }

  const [contacts, taxRates, accounts] = await Promise.all([
    listXeroContacts(),
    listXeroTaxRates(),
    listXeroAccounts()
  ]);

  return {
    accounts,
    contacts,
    sync: syncResult,
    taxRates
  };
}
