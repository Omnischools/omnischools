"use client";

/** Triggers the browser print dialog — users "Save as PDF" from there. */
export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-md border border-border-2 bg-surface px-3 py-1.5 text-xs font-semibold text-navy-2 transition-colors hover:border-gold print:hidden"
    >
      Print / Save as PDF
    </button>
  );
}
