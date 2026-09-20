"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  sendFeeReminders,
  previewFeeReminders,
  type ReminderPreview,
} from "@/lib/actions/billing";
import { Modal } from "@/components/ui/modal";

const ghs = (n: number) =>
  `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function RemindersCard({ families, total }: { families: number; total: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<ReminderPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openPreview() {
    setOpen(true);
    setPreview(null);
    setError(null);
    setMsg(null);
    setLoading(true);
    const res = await previewFeeReminders();
    setLoading(false);
    if (res.ok) setPreview(res.preview);
    else setError(res.error ?? "Could not load the preview.");
  }

  async function confirmSend() {
    setBusy(true);
    setError(null);
    const res = await sendFeeReminders();
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      setMsg(
        `Sent ${res.sent} reminder${res.sent === 1 ? "" : "s"}${res.noPhone ? ` · ${res.noPhone} family/ies had no phone on file` : ""}.`,
      );
      router.refresh();
    } else setError(res.error ?? "Could not send.");
  }

  return (
    <div className="bg-warn-bg/40 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-warn-bg p-5">
      <div>
        <div className="font-display text-lg font-semibold text-navy">
          {families} {families === 1 ? "family owes" : "families owe"} {ghs(total)}
        </div>
        <p className="text-sm text-navy-3">
          Send an SMS fee reminder to every family with an outstanding balance.
        </p>
        {msg && <p className="mt-1 text-sm font-medium text-green">{msg}</p>}
        {!open && error && <p className="mt-1 text-sm text-terra">{error}</p>}
      </div>
      <button
        onClick={openPreview}
        disabled={families === 0}
        className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
      >
        Send reminders
      </button>

      <Modal
        open={open}
        onClose={busy ? () => {} : () => setOpen(false)}
        title="Send fee reminders"
      >
        <div className="space-y-4">
          {loading ? (
            <p className="text-sm text-navy-3">Calculating recipients…</p>
          ) : preview ? (
            <>
              <p className="text-sm leading-relaxed text-navy-2">
                An SMS will be sent to each family with an outstanding balance and a phone
                number on file.
              </p>
              <dl className="space-y-2 rounded-lg border border-border-2 bg-bg p-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-navy-3">Recipients</dt>
                  <dd className="font-semibold text-navy">{preview.recipients}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-navy-3">Outstanding total</dt>
                  <dd className="font-medium text-navy">
                    {ghs(preview.totalOutstanding)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-navy-3">SMS segments</dt>
                  <dd className="font-medium text-navy">{preview.segments}</dd>
                </div>
                <div className="flex justify-between border-t border-border-2 pt-2">
                  <dt className="font-semibold text-navy">Estimated cost</dt>
                  <dd className="font-display text-base font-semibold text-navy">
                    {ghs(preview.estCost)}
                  </dd>
                </div>
                {preview.noPhone > 0 && (
                  <p className="pt-1 text-xs text-warn">
                    {preview.noPhone} family/ies have a balance but no phone on file — they
                    will be skipped.
                  </p>
                )}
              </dl>

              {error && (
                <p className="rounded-md bg-terra-bg px-3 py-2 text-sm text-terra">
                  {error}
                </p>
              )}

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                  className="text-sm font-semibold text-navy-2 transition-colors hover:text-navy disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmSend}
                  disabled={busy || preview.recipients === 0}
                  className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
                >
                  {busy
                    ? "Sending…"
                    : `Send ${preview.recipients} reminder${preview.recipients === 1 ? "" : "s"}`}
                </button>
              </div>
            </>
          ) : (
            <p className="rounded-md bg-terra-bg px-3 py-2 text-sm text-terra">
              {error ?? "Could not load the preview."}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
