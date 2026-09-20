"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendFeeReminders } from "@/lib/actions/billing";

/** "Send reminders to all overdue (N)" — bulk fee-reminder SMS to every overdue debtor's primary guardian. */
export function BulkRemindersButton({ count }: { count: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  if (count === 0) return null;

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={() =>
          start(async () => {
            setMsg(null);
            const res = await sendFeeReminders();
            setMsg(res.ok ? `Sent ${res.sent ?? count}` : (res.error ?? "Could not send."));
            if (res.ok) router.refresh();
          })
        }
        disabled={pending}
        className="rounded-md bg-gold px-3 py-2 text-sm font-semibold text-navy transition-colors hover:opacity-90 disabled:opacity-50 print:hidden"
      >
        {pending ? "Sending…" : `Send reminders to all overdue (${count})`}
      </button>
      {msg && <span className="text-xs font-medium text-green">{msg}</span>}
    </span>
  );
}
