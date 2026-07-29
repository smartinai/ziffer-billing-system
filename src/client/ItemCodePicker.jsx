import { Check, Loader2, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

function searchableText(item) {
  return `${item.code || ""} ${item.name || ""} ${item.description || ""}`.toLowerCase();
}

export default function ItemCodePicker({
  busy = false,
  disabled = false,
  itemCode = "",
  items = [],
  onSelect,
  taskName = ""
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const selectedItem = items.find((item) => item.code === itemCode) || null;
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (normalizedQuery
      ? items.filter((item) => searchableText(item).includes(normalizedQuery))
      : items
    ).slice(0, 20);
  }, [items, query]);

  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus();
    function closeOnOutsideClick(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  async function select(code) {
    await onSelect(code);
    setOpen(false);
    setQuery("");
  }

  return (
    <span className="item-code-picker" ref={rootRef} onClick={(event) => event.stopPropagation()}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${itemCode ? "Change" : "Assign"} item code for ${taskName || "task"}`}
        className={`item-code-badge${itemCode ? " item-code-badge--assigned" : ""}`}
        disabled={disabled || busy}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        {busy ? <Loader2 className="spin" size={12} /> : null}
        {itemCode || "+ Item code"}
      </button>

      {open ? (
        <span aria-label="Choose Xero item code" className="item-code-popover" role="dialog">
          <span className="item-code-search">
            <Search size={15} />
            <input
              aria-label="Search Xero item codes"
              placeholder="Search code or description"
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setOpen(false);
                if (event.key === "Enter" && filteredItems.length === 1) select(filteredItems[0].code);
              }}
            />
          </span>
          <span className="item-code-options" role="listbox">
            {itemCode ? (
              <button className="item-code-option item-code-option--clear" role="option" type="button" onClick={() => select("")}>
                <X size={14} />
                Remove item code
              </button>
            ) : null}
            {filteredItems.map((item) => (
              <button
                aria-selected={item.code === itemCode}
                className="item-code-option"
                key={item.code}
                role="option"
                type="button"
                onClick={() => select(item.code)}
              >
                <span>
                  <strong>{item.code}</strong>
                  <small>{item.name || item.description || "No description"}</small>
                </span>
                {item.code === itemCode ? <Check size={15} /> : null}
              </button>
            ))}
            {!filteredItems.length ? <span className="item-code-empty">No matching Xero item codes.</span> : null}
          </span>
          {selectedItem ? <span className="item-code-current">{selectedItem.description || selectedItem.name}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
