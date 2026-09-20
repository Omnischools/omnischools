import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";

/**
 * Shared form-field primitives (Issue 9). Hook-free + server-safe — they only
 * render styled native elements, so a client parent supplies state/handlers.
 *
 * - <Select> — styled native dropdown (uniform class/subject/year-group fields).
 * - <Combobox> + <DataList> — a dropdown of suggestions that also accepts a new,
 *   typed value (the "add new item" affordance). Render one <DataList> and point
 *   any number of <Combobox listId=…> inputs at it.
 * - <DateInput> — tokenised native date picker.
 */
export const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
export const labelClass = "mb-1 block text-xs font-semibold text-navy-2";

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${fieldClass} ${className ?? ""}`} {...props}>
      {children}
    </select>
  );
}

export function DateInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="date" className={`${fieldClass} ${className ?? ""}`} {...props} />;
}

export function Combobox({
  listId,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { listId: string }) {
  return (
    <input list={listId} className={`${fieldClass} ${className ?? ""}`} {...props} />
  );
}

export function DataList({ id, options }: { id: string; options: readonly string[] }) {
  return (
    <datalist id={id}>
      {options.map((o) => (
        <option key={o} value={o} />
      ))}
    </datalist>
  );
}
