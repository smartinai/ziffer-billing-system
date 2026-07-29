function compactText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function nextClientInvoiceNumber({ abbreviation, invoiceNumbers = [], year }) {
  const prefix = compactText(abbreviation).toUpperCase();
  const invoiceYear = String(year || "").trim();
  if (!prefix || !/^\d{4}$/.test(invoiceYear)) return "";

  const escapedPrefix = escapeRegExp(prefix);
  const separatedPattern = new RegExp(`^${escapedPrefix}\\s*-\\s*${invoiceYear}\\s*-\\s*(\\d+)$`, "i");
  const compactPattern = new RegExp(`^${escapedPrefix}\\s*-\\s*${invoiceYear}(\\d+)$`, "i");
  let highestSequence = 0;
  let detectedStyle = "compact";

  for (const invoiceNumber of invoiceNumbers) {
    const value = compactText(invoiceNumber);
    const separatedMatch = value.match(separatedPattern);
    const compactMatch = separatedMatch ? null : value.match(compactPattern);
    const match = separatedMatch || compactMatch;
    if (!match) continue;
    const sequence = Number(match[1]) || 0;
    if (sequence > highestSequence) {
      highestSequence = sequence;
      detectedStyle = separatedMatch ? "separated" : "compact";
    }
  }

  const nextSequence = String(highestSequence + 1).padStart(2, "0");
  return detectedStyle === "compact"
    ? `${prefix}-${invoiceYear}${nextSequence}`
    : `${prefix}-${invoiceYear}-${nextSequence}`;
}
