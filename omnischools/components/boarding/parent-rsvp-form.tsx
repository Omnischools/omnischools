"use client";
import { useState, useTransition } from "react";
import { submitParentRsvp } from "@/lib/actions/boarding-rsvp";

/**
 * The public parent RSVP form (INCR #298 part B). Reveals nothing about the ward until the parent passes
 * the date-of-birth factor: on success the confirmation addresses them by the ward's given name (returned
 * by the server only after the match). The token comes from the URL; the parent supplies DOB + visitor
 * name (+ optional note). All validation and the generic no-oracle error come from the server action.
 */
export function ParentRsvpForm({ token, schoolName }: { token: string; schoolName: string }) {
  const [pending, startTransition] = useTransition();
  const [dob, setDob] = useState("");
  const [visitorName, setVisitorName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [wardName, setWardName] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await submitParentRsvp({ token, dob, visitorName, note: note || undefined });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setWardName(res.wardName);
    });
  }

  if (wardName) {
    return (
      <div className="rounded-2xl border border-green bg-green-bg p-6 text-center">
        <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-green">RSVP confirmed</div>
        <h1 className="font-display text-xl font-semibold text-navy">See you on visiting day</h1>
        <p className="mt-2 text-sm text-navy-2">
          Your visit to <b className="text-navy">{wardName}</b> is confirmed. Please bring photo ID — the
          gate team will check you in on arrival.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
      <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-gold">Visiting-day RSVP</div>
      <h1 className="font-display text-xl font-semibold text-navy">{schoolName}</h1>
      <p className="mt-2 text-sm text-navy-3">
        Confirm your visit for the coming visiting day. Enter your child&apos;s date of birth to verify
        this is you.
      </p>

      <form
        className="mt-5 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="block">
          <span className="text-xs font-semibold text-navy-2">Your child&apos;s date of birth</span>
          <input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-border-2 bg-bg p-2.5 text-sm text-navy outline-none focus:border-gold"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-navy-2">Visitor&apos;s full name</span>
          <input
            type="text"
            value={visitorName}
            onChange={(e) => setVisitorName(e.target.value)}
            required
            maxLength={120}
            placeholder="e.g. Mrs. Ama Mensah"
            className="mt-1 w-full rounded-md border border-border-2 bg-bg p-2.5 text-sm text-navy outline-none focus:border-gold"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-navy-2">Note for the House (optional)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={280}
            placeholder="e.g. arriving around noon"
            className="mt-1 w-full rounded-md border border-border-2 bg-bg p-2.5 text-sm text-navy outline-none focus:border-gold"
          />
        </label>

        {error && <p className="text-xs font-semibold text-terra">{error}</p>}

        <button
          type="submit"
          disabled={pending || dob === "" || visitorName.trim() === ""}
          className="w-full rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-bg disabled:opacity-50"
        >
          {pending ? "Confirming…" : "Confirm my visit"}
        </button>
      </form>
      <p className="mt-3 text-[11px] text-navy-3">
        Your details are shared only with {schoolName} for this visit.
      </p>
    </div>
  );
}
