"use client";
/**
 * The manual send of a DUE scheduled reminder (SHS module 4.4 / INCR-26). Console-only; the single
 * `scheduled_for → sent_at` stamp. Nothing auto-fires — this button IS the fire.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendScheduledReminder } from "@/lib/actions/sickbay-notify";

export function ScheduledSendButton({ notificationId }: { notificationId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await sendScheduledReminder({ notificationId });
            if (!res.ok) setError(res.error ?? "Could not send.");
            else router.refresh();
          })
        }
        className="rounded-md border border-gold bg-gold px-[11px] py-[5px] text-[10px] font-bold text-navy disabled:opacity-50"
      >
        {pending ? "…" : "Send now"}
      </button>
      {error && <span className="text-[9px] font-semibold text-terra">{error}</span>}
    </span>
  );
}
