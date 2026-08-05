import { ArrowRight, Info, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

function focusableElements(container) {
  return [...(container?.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
  ) || [])];
}

export default function TaskNameReviewModal({
  applying = false,
  error = "",
  loading = false,
  model = "",
  open = false,
  onApply,
  onClose,
  onRegenerate,
  onRetry,
  onStartOver,
  progress = { completed: 0, label: "", total: 0 },
  promptVersion = "",
  suggestions = [],
  totalTaskCount = 0
}) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const previousFocusRef = useRef(null);
  const previousSuggestionsRef = useRef(new Map());
  const [drafts, setDrafts] = useState({});
  const [selected, setSelected] = useState(() => new Set());
  const [showChangedOnly, setShowChangedOnly] = useState(false);

  useEffect(() => {
    const previous = previousSuggestionsRef.current;
    setDrafts((current) => Object.fromEntries(suggestions.map((item) => {
      const incomingWording = item.suggestedTaskName || item.currentTaskName || "";
      const previousItem = previous.get(item.lineId);
      const changed = previousItem?.suggestedTaskName !== item.suggestedTaskName
        || previousItem?.status !== item.status;
      return [item.lineId, changed ? incomingWording : current[item.lineId] ?? incomingWording];
    })));
    setSelected((current) => {
      const next = new Set([...current].filter((lineId) => suggestions.some((item) => item.lineId === lineId)));
      for (const item of suggestions) {
        const previousItem = previous.get(item.lineId);
        const changed = previousItem?.suggestedTaskName !== item.suggestedTaskName
          || previousItem?.status !== item.status;
        if (!changed) continue;
        const incomingWording = String(item.suggestedTaskName || item.currentTaskName || "").trim();
        if (item.status === "suggested" && incomingWording && incomingWording !== item.currentTaskName) {
          next.add(item.lineId);
        } else {
          next.delete(item.lineId);
        }
      }
      return next;
    });
    previousSuggestionsRef.current = new Map(suggestions.map((item) => [item.lineId, item]));
  }, [suggestions]);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    closeButtonRef.current?.focus();
    return () => previousFocusRef.current?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape" && !applying) onClose();
      if (event.key !== "Tab") return;
      const focusable = focusableElements(dialogRef.current);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [applying, onClose, open]);

  const selectedRows = useMemo(() => suggestions
    .filter((item) => selected.has(item.lineId))
    .map((item) => ({ ...item, suggestedTaskName: String(drafts[item.lineId] || "").trim() }))
    .filter((item) => item.suggestedTaskName && item.suggestedTaskName !== item.currentTaskName), [drafts, selected, suggestions]);

  const changedRows = useMemo(() => suggestions.filter((item) => {
    const wording = String(drafts[item.lineId] ?? item.suggestedTaskName ?? item.currentTaskName ?? "").trim();
    return wording && wording !== item.currentTaskName;
  }), [drafts, suggestions]);

  const visibleSuggestions = showChangedOnly ? changedRows : suggestions;
  const progressTotal = Math.max(progress.total || totalTaskCount || suggestions.length, 1);
  const progressCompleted = Math.min(Math.max(progress.completed || 0, 0), progressTotal);
  const displayedTaskCount = totalTaskCount || suggestions.length;

  function toggleSelected(lineId, checked) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(lineId);
      else next.delete(lineId);
      return next;
    });
  }

  function keepOriginal(item) {
    setDrafts((current) => ({ ...current, [item.lineId]: item.currentTaskName }));
    toggleSelected(item.lineId, false);
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop task-name-review-backdrop" role="presentation">
      <section
        aria-labelledby="task-name-review-title"
        aria-modal="true"
        className="task-name-review-modal"
        ref={dialogRef}
        role="dialog"
      >
        <header className="task-name-review-header">
          <div>
            <div className="task-name-review-kicker">
              <span className="eyebrow"><Sparkles size={15} /> AI-assisted wording</span>
              {displayedTaskCount ? <span className="task-name-review-count">{displayedTaskCount} tasks</span> : null}
            </div>
            <h2 id="task-name-review-title">Review task names</h2>
            <p>Compare the Teamwork names with the invoice wording, then apply only the changes you want.</p>
          </div>
          <div className="task-name-review-header-actions">
            {model ? <span className="task-name-review-model">{model}</span> : null}
            <span className="task-name-review-info">
              <button
                aria-describedby="task-name-review-privacy"
                aria-label="How AI task names are processed"
                className="task-name-review-info-button"
                type="button"
              >
                <Info size={16} />
              </button>
              <span id="task-name-review-privacy" role="tooltip">
                Task names and time-entry descriptions are sent to OpenAI. Hours, rates, and assigned staff are excluded. Ziffer requests no response storage.
              </span>
            </span>
            <button aria-label="Close task-name review" className="icon-only-button" disabled={applying} onClick={onClose} ref={closeButtonRef} type="button">
              <X size={20} />
            </button>
          </div>
        </header>

        {suggestions.length ? (
          <div className="task-name-review-toolbar">
            <div className="task-name-review-bulk-actions">
              <button disabled={applying || loading || !changedRows.length} onClick={() => setSelected(new Set(changedRows.map((item) => item.lineId)))} type="button">Select all changes</button>
              <button disabled={applying || loading || !selected.size} onClick={() => setSelected(new Set())} type="button">Deselect all</button>
              <button disabled={applying || loading} onClick={onStartOver} type="button"><RefreshCw size={14} /> Start over</button>
            </div>
            <label className="task-name-review-filter">
              <input
                checked={showChangedOnly}
                disabled={applying || loading}
                onChange={(event) => setShowChangedOnly(event.target.checked)}
                type="checkbox"
              />
              <span>Show changed only</span>
              <strong>{changedRows.length}</strong>
            </label>
          </div>
        ) : <div className="task-name-review-toolbar task-name-review-toolbar--empty" />}

        <div className="task-name-review-body">
          {loading && !suggestions.length ? (
            <div className="task-name-review-state" role="status">
              <Loader2 className="spin" size={24} />
              <strong>Preparing suggestions…</strong>
              {progress.label ? <span>{progress.label}</span> : null}
            </div>
          ) : null}
          {error && suggestions.length ? (
            <div className="task-name-review-inline-error" role="alert">
              <strong>Couldn’t prepare task names.</strong>
              <span>{error}</span>
              <button className="secondary-action-button" disabled={loading} onClick={onRetry} type="button">
                <RefreshCw size={16} /> Retry remaining
              </button>
            </div>
          ) : null}
          {error && !suggestions.length ? (
            <div className="task-name-review-state task-name-review-state--error" role="alert">
              <strong>Couldn’t prepare task names.</strong>
              <span>{error}</span>
              <button className="secondary-action-button" disabled={loading} onClick={onRetry} type="button">
                <RefreshCw size={16} /> Retry
              </button>
            </div>
          ) : null}
          {visibleSuggestions.length ? (
            <div aria-hidden="true" className="task-name-review-columns">
              <span />
              <span>Original Teamwork name</span>
              <span />
              <span>Invoice wording</span>
            </div>
          ) : null}
          {visibleSuggestions.map((item) => {
            const wording = String(drafts[item.lineId] ?? item.suggestedTaskName ?? item.currentTaskName ?? "");
            const wordingChanged = Boolean(wording.trim() && wording.trim() !== item.currentTaskName);
            return (
            <article className={`task-name-review-row${selected.has(item.lineId) && wordingChanged ? " task-name-review-row--selected" : ""}`} key={item.lineId}>
              <label className="task-name-review-select">
                <input
                  aria-label={`Use invoice wording for ${item.originalTaskName || item.currentTaskName}`}
                  checked={selected.has(item.lineId) && wordingChanged}
                  disabled={applying || !wordingChanged}
                  onChange={(event) => toggleSelected(item.lineId, event.target.checked)}
                  type="checkbox"
                />
                <span className="sr-only">Use suggestion</span>
              </label>
              <div className="task-name-review-original">
                <small className="task-name-review-field-label">Original Teamwork name</small>
                <strong>{item.originalTaskName || item.currentTaskName}</strong>
                <span>{item.entryCount} time {item.entryCount === 1 ? "entry" : "entries"}</span>
              </div>
              <ArrowRight aria-hidden="true" className="task-name-review-arrow" size={17} />
              <div className="task-name-review-suggestion">
                <label className="task-name-review-field-label" htmlFor={`task-name-suggestion-${item.lineId}`}>Invoice wording</label>
                <textarea
                  aria-describedby={item.warning ? `task-name-warning-${item.lineId}` : undefined}
                  disabled={applying}
                  id={`task-name-suggestion-${item.lineId}`}
                  maxLength={300}
                  onChange={(event) => {
                    const nextWording = event.target.value;
                    setDrafts((current) => ({ ...current, [item.lineId]: nextWording }));
                    toggleSelected(item.lineId, Boolean(nextWording.trim() && nextWording.trim() !== item.currentTaskName));
                  }}
                  rows={2}
                  value={wording}
                />
                {item.warning ? (
                  <small className="task-name-review-warning" id={`task-name-warning-${item.lineId}`}>
                    {item.warning}{item.status !== "suggested" ? " Enter the invoice wording manually if needed." : ""}
                  </small>
                ) : null}
                <div className="task-name-review-row-actions">
                  <button disabled={applying || loading} onClick={() => keepOriginal(item)} type="button">Keep original</button>
                  <button disabled={applying || loading} onClick={() => onRegenerate(item.lineId)} type="button"><RefreshCw size={14} /> Regenerate</button>
                </div>
              </div>
            </article>
            );
          })}
          {!loading && suggestions.length && !visibleSuggestions.length ? (
            <div className="task-name-review-empty">
              <strong>No changed suggestions to review.</strong>
              <span>Turn off “Show changed only” to see every task.</span>
            </div>
          ) : null}
        </div>

        <footer className="task-name-review-footer">
          {loading ? (
            <div className="task-name-review-progress" role="status">
              <div className="task-name-review-progress-copy">
                <strong>{progress.label || "Preparing task names"}</strong>
                <span>{progressCompleted} of {progressTotal} task names prepared</span>
              </div>
              <progress aria-label="Preparing task names" max={progressTotal} value={progressCompleted} />
            </div>
          ) : null}
          <div className="task-name-review-footer-row">
            <span aria-live="polite"><strong>{selectedRows.length}</strong> of {displayedTaskCount} task names selected</span>
            <div className="task-name-review-footer-actions">
              <button className="secondary-action-button" disabled={applying} onClick={onClose} type="button">Cancel</button>
              <button
                className="primary-action-button"
                disabled={applying || loading || !selectedRows.length}
                onClick={() => onApply(selectedRows, promptVersion)}
                type="button"
              >
                {applying || loading ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
                {applying
                  ? "Applying…"
                  : loading
                    ? "Preparing…"
                    : `Apply ${selectedRows.length} task ${selectedRows.length === 1 ? "name" : "names"}`}
              </button>
            </div>
          </div>
        </footer>
      </section>
    </div>
  );
}
