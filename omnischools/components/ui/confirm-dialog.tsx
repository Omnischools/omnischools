"use client";
import { Modal } from "./modal";

/**
 * Destructive-action confirmation built on Modal. Used for both single-row and
 * bulk deletes. The confirm button is terra (danger); `message` spells out the
 * consequences so the user understands what's being removed before they commit.
 * While `busy`, the dialog can't be dismissed (no double-fire).
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  busy = false,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={title}>
      <div className="space-y-4">
        <div className="text-sm leading-relaxed text-navy-2">{message}</div>
        {error && (
          <p className="rounded-md bg-terra-bg px-3 py-2 text-sm text-terra">{error}</p>
        )}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-sm font-semibold text-navy-2 transition-colors hover:text-navy disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-terra px-4 py-2 text-sm font-semibold text-bg transition-colors hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
