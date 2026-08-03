function auditAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

export function xeroSendAuditMetadata(payload = {}) {
  const xero = payload.xero || {};
  const preview = payload.preview || {};
  const clientName = xero.clientName || preview.billingClient?.displayName || "client";
  const documentNumber = xero.quoteNumber || preview.quoteNumber || "";
  const sentAmount = auditAmount(xero.amount ?? preview.amount);
  const documentLabel = xero.documentLabel || "document";

  return {
    clientName,
    documentNumber,
    documentType: xero.documentType,
    lineCount: xero.lineCount,
    mode: xero.mode,
    status: xero.status,
    sentAmount,
    summary: `Sent ${documentLabel} ${documentNumber} to Xero for ${clientName} (${sentAmount} EUR)`.trim()
  };
}
