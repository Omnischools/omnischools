"use client";
import { useEffect, useRef } from "react";

/**
 * Centered modal dialog. Dims + blurs the page behind it (blur signals "tap
 * outside to dismiss"), traps initial focus, closes on Escape or backdrop click,
 * and animates in (fade + slight zoom, ~200ms ease-out). One primary CTA lives in
 * the children. Tokens: navy scrim, surface card, rounded-2xl, shadow-xl.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    // focus the first focusable field
    const first = cardRef.current?.querySelector<HTMLElement>(
      "input, select, textarea, button",
    );
    first?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        onClick={onClose}
        className="bg-navy/50 absolute inset-0 backdrop-blur-sm duration-150 animate-in fade-in"
      />
      <div
        ref={cardRef}
        className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-xl duration-200 animate-in fade-in zoom-in-95"
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="font-display text-lg font-semibold text-navy">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-navy-3 transition-colors hover:bg-bg hover:text-navy"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
