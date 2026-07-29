function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round((number(value) + Number.EPSILON) * 100) / 100;
}

function text(value) {
  return String(value || "").trim();
}

function contactAddress(raw = {}) {
  const addresses = Array.isArray(raw.Addresses) ? raw.Addresses : [];
  const address = addresses.find((item) => item?.AddressType === "STREET") || addresses[0] || {};
  return [
    address.AddressLine1,
    address.AddressLine2,
    address.AddressLine3,
    [address.PostalCode, address.City].filter(Boolean).join(" "),
    address.Region,
    address.Country
  ].map(text).filter(Boolean);
}

export function buildXeroDocumentPreview({ accounts = [], contact = null, payload, taxRates = [] }) {
  const source = payload?.document || {};
  const accountByCode = new Map(accounts.map((account) => [text(account.code), account]));
  const taxByType = new Map(taxRates.map((taxRate) => [text(taxRate.taxType), taxRate]));
  const lines = (source.LineItems || []).map((line) => {
    const taxRate = taxByType.get(text(line.TaxType));
    const rate = number(taxRate?.rate);
    const lineAmount = roundMoney(line.LineAmount);
    return {
      accountCode: text(line.AccountCode),
      accountName: text(accountByCode.get(text(line.AccountCode))?.name),
      description: text(line.Description),
      discount: number(line.DiscountRate),
      itemCode: text(line.ItemCode),
      lineAmount,
      quantity: number(line.Quantity),
      taxAmount: roundMoney(lineAmount * rate / 100),
      taxName: text(taxRate?.name || line.TaxType),
      taxRate: rate,
      taxType: text(line.TaxType),
      unitAmount: number(line.UnitAmount)
    };
  });
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.lineAmount, 0));
  const totalTax = roundMoney(lines.reduce((sum, line) => sum + line.taxAmount, 0));
  const isQuote = payload.documentType === "draft_quote";

  return {
    contact: {
      address: contactAddress(contact?.raw),
      name: text(source.Contact?.Name || contact?.name)
    },
    currency: text(source.CurrencyCode || "EUR"),
    documentType: payload.documentType,
    dueDate: isQuote ? text(source.ExpiryDate) : text(source.DueDate),
    issueDate: text(source.Date),
    lineAmountType: text(source.LineAmountTypes || "Exclusive"),
    lines,
    number: text(isQuote ? source.QuoteNumber : source.InvoiceNumber),
    reference: text(source.Reference),
    totals: {
      subtotal,
      total: roundMoney(subtotal + totalTax),
      totalTax
    }
  };
}
