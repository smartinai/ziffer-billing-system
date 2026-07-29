import { Archive, Loader2, RefreshCw, Send, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { formatAppDate } from "./dateFormatting.js";

const documentTypes = [
  { value: "draft_invoice", label: "Draft invoice" },
  { value: "draft_quote", label: "Draft quote" }
];

function money(value, currency) {
  return new Intl.NumberFormat("en-LU", { currency: currency || "EUR", minimumFractionDigits: 2, style: "currency" }).format(value || 0);
}

function quantity(value) {
  return new Intl.NumberFormat("en-LU", { maximumFractionDigits: 4 }).format(value || 0);
}

function date(value) {
  return formatAppDate(value, { fallback: "—" });
}

export default function XeroDocumentPreviewModal({
  busy = false,
  document: previewDocument,
  documentType,
  error = "",
  loading = false,
  onArchive,
  onClose,
  onDocumentTypeChange,
  onRetry,
  onSend
}) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const isQuote = documentType === "draft_quote";

  useEffect(() => {
    const previous = globalThis.document.activeElement;
    closeRef.current?.focus();
    function handleKeyDown(event) {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll("button:not([disabled]), select:not([disabled]), [href]") || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && globalThis.document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && globalThis.document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previous?.focus?.();
    };
  }, [busy, onClose]);

  return (
    <div className="modal-backdrop xero-preview-backdrop" role="presentation">
      <section aria-labelledby="xero-preview-title" aria-modal="true" className="xero-preview-modal" ref={dialogRef} role="dialog">
        <header className="xero-preview-toolbar">
          <div>
            <p>Xero document preview</p>
            <h2 id="xero-preview-title">{isQuote ? "Quote preview" : "Invoice preview"}</h2>
          </div>
          <div className="xero-preview-actions">
            <label>
              <span className="sr-only">Xero document type</span>
              <select disabled={busy || loading} value={documentType} onChange={(event) => onDocumentTypeChange(event.target.value)}>
                {documentTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <button className="secondary-button" disabled={busy || loading} onClick={onArchive} type="button">
              <Archive size={16} /> Archive
            </button>
            <button className="primary-action-button" disabled={busy || loading || !previewDocument} onClick={onSend} type="button">
              {busy ? <Loader2 className="spin" size={17} /> : <Send size={17} />} Send to Xero
            </button>
            <button aria-label="Close Xero preview" className="modal-close-button" disabled={busy} onClick={onClose} ref={closeRef} type="button">
              <X size={20} />
            </button>
          </div>
        </header>

        <div className="xero-preview-scroll">
          {loading ? <div className="loading-state xero-preview-loading"><Loader2 className="spin" size={24} /><span>Preparing exact Xero document</span></div> : null}
          {error ? (
            <div className="xero-preview-error" role="alert">
              <p>{error}</p>
              <button className="secondary-button" disabled={busy} onClick={onRetry} type="button"><RefreshCw size={16} /> Retry</button>
            </div>
          ) : null}
          {previewDocument && !loading ? (
            <div className="xero-document-sheet">
              <div className="xero-document-header">
                <div className="xero-contact-block">
                  <span>Contact</span>
                  <strong>{previewDocument.contact?.name || "—"}</strong>
                  {(previewDocument.contact?.address || []).map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}
                </div>
                <dl>
                  <div><dt>Issue date</dt><dd>{date(previewDocument.issueDate)}</dd></div>
                  <div><dt>{isQuote ? "Expiry date" : "Due date"}</dt><dd>{date(previewDocument.dueDate)}</dd></div>
                  <div><dt>{isQuote ? "Quote number" : "Invoice number"}</dt><dd>{previewDocument.number || "—"}</dd></div>
                  <div><dt>Reference</dt><dd>{previewDocument.reference || "—"}</dd></div>
                </dl>
              </div>

              <p className="xero-tax-exclusive">Amounts are tax exclusive</p>
              <div className="xero-preview-table-wrap">
                <table className="xero-preview-table">
                  <thead><tr><th>Item</th><th>Description</th><th>Qty.</th><th>Price</th><th>Disc.</th><th>Account</th><th>Tax rate</th><th>Tax amount</th><th>Amount {previewDocument.currency}</th></tr></thead>
                  <tbody>
                    {previewDocument.lines.map((line, index) => (
                      <tr key={`${line.description}-${index}`}>
                        <td>{line.itemCode || "—"}</td>
                        <td className="xero-description-cell">{line.description || "—"}</td>
                        <td>{quantity(line.quantity)}</td>
                        <td>{money(line.unitAmount, previewDocument.currency)}</td>
                        <td>{quantity(line.discount)}%</td>
                        <td>{[line.accountCode, line.accountName].filter(Boolean).join(" - ") || "—"}</td>
                        <td>{line.taxName || line.taxType || "—"}{line.taxRate ? ` (${quantity(line.taxRate)}%)` : ""}</td>
                        <td>{money(line.taxAmount, previewDocument.currency)}</td>
                        <td>{money(line.lineAmount, previewDocument.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl className="xero-preview-totals">
                <div><dt>Subtotal</dt><dd>{money(previewDocument.totals.subtotal, previewDocument.currency)}</dd></div>
                <div><dt>Total tax</dt><dd>{money(previewDocument.totals.totalTax, previewDocument.currency)}</dd></div>
                <div className="xero-preview-total"><dt>Total</dt><dd>{money(previewDocument.totals.total, previewDocument.currency)}</dd></div>
              </dl>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
