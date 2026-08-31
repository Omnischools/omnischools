"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestParentExeat } from "@/lib/actions/parent-exeat";

/**
 * EXEAT PHASE 2 · the parent's "Request leave" form — calls the `requestParentExeat` server action ONLY (no
 * server-only import, so it can be a client component). Native <input type="date"> (no picker lib). The child
 * <select> shows only when the parent has more than one boarder; a single boarder is defaulted and hidden.
 * Submit disabled while an open request exists (advisory — the fn's open-guard is authoritative). On success
 * it shows the ref code + clears + router.refresh() so the status list re-reads.
 */
export function ExeatRequestForm({
  wards,
  hasOpenRequest,
}: {
  wards: { studentId: string; firstName: string }[];
  hasOpenRequest: boolean;
}) {
  const [studentId, setStudentId] = useState(wards[0]?.studentId ?? "");
  const [reason, setReason] = useState("");
  const [departDate, setDepartDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refCode, setRefCode] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const canSubmit = !!studentId && reason.trim().length >= 4 && !!departDate && !!returnDate && !pending;

  function submit() {
    if (!canSubmit) return;
    setError(null);
    setRefCode(null);
    start(async () => {
      const res = await requestParentExeat({ studentId, reason, departDate, returnDate });
      if (res.ok) {
        setRefCode(res.refCode ?? null);
        setReason("");
        setDepartDate("");
        setReturnDate("");
        router.refresh();
      } else {
        setError(res.error ?? "Couldn't submit your request. Please try again.");
      }
    });
  }

  const field =
    "mt-1 w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-[13px] text-navy outline-none focus:border-gold disabled:opacity-60";
  const label = "text-[11px] font-semibold text-navy-3";

  return (
    <section className="rounded-xl border border-border bg-surface px-[26px] py-[22px]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-navy-3">Request leave</div>
      <p className="mt-1 text-[13px] leading-relaxed text-navy-2">
        Ask the House to let your ward leave campus (a funeral, illness in the family, a church engagement).
        The House reviews and the Senior Housemaster signs off — you&apos;ll see the status below.
      </p>

      {refCode && (
        <div className="mt-4 rounded-md border border-gold-soft bg-gold-bg px-3.5 py-2.5 text-[13px] text-navy">
          Request submitted — ref <span className="font-mono font-semibold">{refCode}</span>. The House will
          review it.
        </div>
      )}

      <div className="mt-4 space-y-3.5">
        {wards.length > 1 && (
          <label className="block">
            <span className={label}>Which ward</span>
            <select
              className={field}
              value={studentId}
              disabled={pending}
              onChange={(e) => setStudentId(e.target.value)}
            >
              {wards.map((c) => (
                <option key={c.studentId} value={c.studentId}>
                  {c.firstName}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className={label}>Reason</span>
          <textarea
            className={`${field} resize-none`}
            rows={3}
            value={reason}
            disabled={pending}
            placeholder="Funeral · illness in the family · church engagement…"
            onChange={(e) => setReason(e.target.value)}
          />
        </label>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <label className="block">
            <span className={label}>Leave date</span>
            <input
              type="date"
              className={field}
              value={departDate}
              disabled={pending}
              onChange={(e) => setDepartDate(e.target.value)}
            />
          </label>
          <label className="block">
            <span className={label}>Return date</span>
            <input
              type="date"
              className={field}
              value={returnDate}
              disabled={pending}
              onChange={(e) => setReturnDate(e.target.value)}
            />
          </label>
        </div>
      </div>

      {error && <p className="mt-3 text-[12px] text-terra">{error}</p>}
      {hasOpenRequest && !refCode && (
        <p className="mt-3 text-[11px] leading-relaxed text-navy-3">
          Your ward already has a leave request in progress — please wait for it to close before making
          another.
        </p>
      )}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit || hasOpenRequest}
          className="rounded-md bg-navy px-5 py-2 text-[13px] font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Submitting…" : "Submit request"}
        </button>
      </div>
    </section>
  );
}
