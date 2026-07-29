import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

export default function EditableQuoteCell({
  active,
  ariaLabel,
  busy = false,
  children,
  disabled = false,
  draftValue = "",
  field,
  inputMode,
  lineId,
  onActivate,
  onCancel,
  onChange,
  onCommit,
  onMove,
  textAlign = "left"
}) {
  const inputRef = useRef(null);
  const suppressBlurCommitRef = useRef(false);

  useEffect(() => {
    if (!active || !inputRef.current) return;
    inputRef.current.focus();
    inputRef.current.select();
  }, [active]);

  if (!active) {
    return (
      <button
        aria-label={`Edit ${ariaLabel}`}
        className={`quote-inline-cell quote-inline-cell--${textAlign}`}
        data-inline-cell={`${lineId}:${field}`}
        disabled={disabled}
        onClick={onActivate}
        type="button"
      >
        {children}
      </button>
    );
  }

  return (
    <div className="quote-inline-editor" data-inline-editor={`${lineId}:${field}`}>
      <input
        ref={inputRef}
        aria-label={ariaLabel}
        className={`quote-inline-input quote-inline-input--${textAlign}`}
        readOnly={busy}
        inputMode={inputMode}
        value={draftValue}
        onBlur={() => {
          if (suppressBlurCommitRef.current) {
            suppressBlurCommitRef.current = false;
          } else if (!busy) onCommit();
        }}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            suppressBlurCommitRef.current = true;
            onCancel();
          } else if (event.key === "Enter") {
            event.preventDefault();
            suppressBlurCommitRef.current = true;
            onCommit();
          } else if (event.key === "Tab") {
            suppressBlurCommitRef.current = true;
            onMove(event.shiftKey ? -1 : 1);
          }
        }}
      />
      {busy ? <Loader2 aria-hidden="true" className="quote-inline-spinner spin" size={14} /> : null}
    </div>
  );
}
