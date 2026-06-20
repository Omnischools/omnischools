"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendFeeReminders } from "@/lib/actions/billing";

const ghs = (n: number) =>
  `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function RemindersCard({ families, total }: { families: number; total: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    setMsg(null);
    const res = await sendFeeReminders();
    setBusy(false);
    if (res.ok) {
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
        {error && <p className="mt-1 text-sm text-terra">{error}</p>}
      </div>
      <button
        onClick={send}
        disabled={busy || families === 0}
        className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
      >
        {busy ? "Sending…" : "Send reminders"}
      </button>
    </div>
  );
}
