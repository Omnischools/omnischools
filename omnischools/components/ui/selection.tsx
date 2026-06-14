"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Row-selection state for tables that support multi-select + bulk actions. */
export function useSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setAll = useCallback((ids: string[], on: boolean) => {
    setSelected(on ? new Set(ids) : new Set());
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  return { selected, toggle, setAll, clear, count: selected.size };
}

const boxClass =
  "h-4 w-4 cursor-pointer rounded border-border-2 accent-gold align-middle";

export function RowCheckbox({
  checked,
  onChange,
  label = "Select row",
}: {
  checked: boolean;
  onChange: () => void;
  label?: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      className={boxClass}
    />
  );
}

/** Header checkbox with an indeterminate state when only some rows are selected. */
export function HeaderCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label="Select all"
      checked={checked}
      onChange={onChange}
      className={boxClass}
    />
  );
}

/** Sticky action bar shown above a table when one or more rows are selected. */
export function BulkBar({
  count,
  singular,
  plural,
  onDelete,
  onClear,
}: {
  count: number;
  singular: string;
  plural: string;
  onDelete: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-gold-soft bg-gold-bg px-4 py-2.5 duration-150 animate-in fade-in">
      <span className="text-sm font-medium text-navy">
        {count} {count === 1 ? singular : plural} selected
      </span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onClear}
          className="text-sm font-semibold text-navy-2 transition-colors hover:text-navy"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md bg-terra px-3.5 py-1.5 text-sm font-semibold text-bg transition-colors hover:opacity-90"
        >
          Delete selected
        </button>
      </div>
    </div>
  );
}
