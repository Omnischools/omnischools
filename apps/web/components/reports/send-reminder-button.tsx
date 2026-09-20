"use client";
import { useState, useTransition } from "react";
import { sendReminderToStudent } from "@/lib/actions/billing";

/** Sends the fee-balance SMS to one debtor's primary guardian (Reports drill-down). */
export function SendReminderButton({ studentId }: { studentId: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    start(async () => {
      const res = await sendReminderToStudent({ studentId });
      if (res.ok) {
        setState("sent");
      } else {
        setState("error");
        setError(res.error ?? "Could not send.");
      }
    });
  }

  if (state === "sent") {
    return <span className="text-xs font-medium text-green">Reminder sent ✓</span>;
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={go}
        disabled={pending}
        className="text-xs font-semibold text-gold transition-colors hover:underline disabled:opacity-50 print:hidden"
      >
        {pending ? "Sending…" : state === "error" ? "Retry" : "Remind"}
      </button>
      {error && <span className="text-xs text-terra">{error}</span>}
    </span>
  );
}
