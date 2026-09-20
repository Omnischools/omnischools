"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { assignConversation, setConversationStatus } from "@/lib/actions/inbox";
import type { StaffOption } from "@/lib/data/staff-options";

export function ConversationControls({
  conversationId,
  status,
  assignedTo,
  staff,
}: {
  conversationId: string;
  status: "OPEN" | "CLOSED";
  assignedTo: string | null;
  staff: StaffOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function assign(userId: string) {
    setBusy(true);
    await assignConversation({ conversationId, userId });
    setBusy(false);
    router.refresh();
  }

  async function toggle() {
    setBusy(true);
    await setConversationStatus({
      conversationId,
      status: status === "OPEN" ? "CLOSED" : "OPEN",
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <select
        defaultValue={assignedTo ?? ""}
        disabled={busy}
        onChange={(e) => assign(e.target.value)}
        className="rounded-md border border-border-2 bg-bg px-2.5 py-1.5 text-sm text-navy outline-none focus:border-gold disabled:opacity-60"
      >
        <option value="">Unassigned</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button
        onClick={toggle}
        disabled={busy}
        className="rounded-md border border-border-2 px-3 py-1.5 text-sm font-semibold text-navy-2 transition-colors hover:bg-bg disabled:opacity-60"
      >
        {status === "OPEN" ? "Close" : "Reopen"}
      </button>
    </div>
  );
}
