"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { reassignConversation } from "@/lib/actions/inbox";
import type { StaffOption } from "@/lib/data/staff-options";

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";

/**
 * Reassign drawer (surface §02) — hand a thread off to a colleague with an optional
 * handoff note. Renders inside the focus-safe Modal. On submit it calls
 * reassignConversation (which reassigns, clears auto-route provenance, and audits the
 * note), then refreshes and closes. The "notify by SMS" checkbox is a cosmetic stub.
 */
export function ReassignDrawer({
  conversationId,
  currentAssigneeName,
  staff,
  currentUserId,
}: {
  conversationId: string;
  currentAssigneeName: string | null;
  staff: StaffOption[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [toUserId, setToUserId] = useState<string>("");
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Exclude the current user from the pick list — reassigning to yourself is a no-op.
  const colleagues = staff.filter((s) => s.id !== currentUserId);

  const selected = staff.find((s) => s.id === toUserId) ?? null;
  const fromLabel = currentAssigneeName ?? "Unassigned";
  const toLabel = selected ? selected.name : "Unassigned";

  function reset() {
    setToUserId("");
    setNote("");
    setNotify(true);
    setError(null);
  }

  function close() {
    setOpen(false);
    reset();
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await reassignConversation({
        conversationId,
        toUserId,
        handoffNote: note,
      });
      if (!res.ok) {
        setError(res.error ?? "Could not reassign.");
        return;
      }
      router.refresh();
      close();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-pill border border-gold bg-surface px-3 py-1.5 text-sm font-semibold text-gold transition-colors hover:bg-gold-bg"
      >
        Reassign →
      </button>

      <Modal open={open} onClose={close} title="Reassign thread">
        <div className="space-y-4">
          <p className="text-xs text-navy-3">
            Hand this thread off to a colleague. The new assignee owns it and Auto-route
            provenance is cleared.
          </p>

          {/* From → To hint */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl border border-border bg-bg px-3.5 py-3">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3">
                From
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gold-bg font-display text-[11px] font-bold text-navy">
                  {currentAssigneeName ? initials(currentAssigneeName) : "?"}
                </span>
                <span className="truncate text-xs font-semibold text-navy">
                  {fromLabel}
                </span>
              </div>
            </div>
            <div className="text-center font-display text-lg font-bold text-gold">→</div>
            <div>
              <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3">
                To
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full font-display text-[11px] font-bold ${
                    selected ? "bg-green text-bg" : "bg-gold-bg text-navy"
                  }`}
                >
                  {selected ? initials(selected.name) : "?"}
                </span>
                <span className="truncate text-xs font-semibold text-navy">{toLabel}</span>
              </div>
            </div>
          </div>

          {/* Colleague picker */}
          <div>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">
              Choose colleague
            </div>
            <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                  toUserId === ""
                    ? "border-gold bg-gold-bg"
                    : "border-border bg-surface hover:bg-bg"
                }`}
              >
                <input
                  type="radio"
                  name="reassign-to"
                  value=""
                  checked={toUserId === ""}
                  onChange={() => setToUserId("")}
                  className="accent-gold"
                />
                <span className="text-sm font-medium text-navy-3">
                  — Leave unassigned —
                </span>
              </label>
              {colleagues.map((s) => (
                <label
                  key={s.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                    toUserId === s.id
                      ? "border-gold bg-gold-bg"
                      : "border-border bg-surface hover:bg-bg"
                  }`}
                >
                  <input
                    type="radio"
                    name="reassign-to"
                    value={s.id}
                    checked={toUserId === s.id}
                    onChange={() => setToUserId(s.id)}
                    className="accent-gold"
                  />
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gold-bg font-display text-[11px] font-bold text-navy">
                    {initials(s.name)}
                  </span>
                  <span className="text-sm font-medium text-navy">{s.name}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Handoff note */}
          <div>
            <label
              htmlFor="handoff-note"
              className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3"
            >
              Handoff note · optional
            </label>
            <textarea
              id="handoff-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={600}
              placeholder={`Brief context for ${
                selected ? firstName(selected.name) : "the new assignee"
              } — what's happened so far, what needs to happen next`}
              className="min-h-[70px] w-full resize-none rounded-lg border border-border-2 bg-surface px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold"
            />
          </div>

          {/* Notify (cosmetic stub) */}
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              className="mt-0.5 accent-green"
            />
            <span className="text-sm">
              <span className="font-medium text-navy">Notify by SMS</span>
              <span className="mt-0.5 block text-xs text-navy-3">
                Notify the new assignee that this thread is now theirs.
              </span>
            </span>
          </label>

          {error ? <p className="text-sm font-medium text-terra">{error}</p> : null}

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <button
              type="button"
              onClick={close}
              disabled={pending}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-navy-3 transition-colors hover:text-navy disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="rounded-lg bg-gold px-4 py-2 text-sm font-bold text-navy transition-colors hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "Reassigning…" : "Reassign →"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
