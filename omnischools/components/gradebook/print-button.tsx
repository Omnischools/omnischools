"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="border-border-2 bg-surface rounded-md border px-4 py-2 text-sm font-semibold text-navy hover:bg-gold-bg print:hidden"
    >
      Print
    </button>
  );
}
