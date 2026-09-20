"use client";
/**
 * New-visit form (SHS module 4.4 / INCR-22a) — the write-path entry. The live queue that normally
 * seeds a visit is the `today` board (22c); at 22a a matron opens a visit from here. Plain
 * serialisable props only; the student search is server-side (`?q=`), this component just captures
 * the selection + complaint + intake reporter and calls `createVisit`.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createVisit } from "@/lib/actions/sickbay-visit";
import type { StudentPick } from "@/lib/sickbay/visit-reads";

export function NewVisitForm({ students, query }: { students: StudentPick[]; query: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [complaint, setComplaint] = useState("");
  const [intake, setIntake] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorVisitId, setErrorVisitId] = useState<string | null>(null);

  function submit() {
    setError(null);
    setErrorVisitId(null);
    if (!studentId) return setError("Pick the student first.");
    if (!complaint.trim()) return setError("Record the presenting complaint.");
    startTransition(async () => {
      const res = await createVisit({
        studentId,
        presentingComplaint: complaint.trim(),
        intakeReportedBy: intake.trim() || null,
      });
      if (!res.ok || !res.id) {
        // On the R75b collision the action returns the BLOCKING visit's id beside the error.
        if (!res.ok && res.id) setErrorVisitId(res.id);
        return setError(res.error ?? "Could not open the visit.");
      }
      router.push(`/senior/sickbay/visits/${res.id}`);
    });
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-[16px_20px_20px]">
      {/* Student search — a plain GET so the roster never ships wholesale (server search). */}
      <form method="get" className="mb-4 flex gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Search student by name or code"
          className="flex-1 rounded-md border border-border-2 bg-bg px-3 py-2 text-[13px] text-navy-2 outline-none focus:border-gold"
        />
        <button
          type="submit"
          className="rounded-[5px] border border-border-2 bg-surface px-[14px] py-2 text-[12px] font-semibold text-navy-2"
        >
          Search
        </button>
      </form>

      <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">Student</div>
      {students.length === 0 ? (
        <p className="py-2 text-[12px] italic text-navy-3">
          {query ? "No active student matches that." : "Type a name or code to find the student."}
        </p>
      ) : (
        <ul className="mb-4 max-h-[280px] overflow-auto rounded-md border border-border">
          {students.map((s) => (
            <li key={s.id}>
              <label className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 text-[12px] last:border-b-0 hover:bg-gold-bg">
                <input
                  type="radio"
                  name="student"
                  checked={studentId === s.id}
                  onChange={() => setStudentId(s.id)}
                />
                <span className="font-semibold text-navy">{s.name}</span>
                <span className="text-navy-3">
                  {s.formLabel}
                  {s.houseName ? ` · ${s.houseName} House` : ""} · {s.studentCode}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <label className="mb-1 block text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
        Presenting complaint · as recorded
      </label>
      <textarea
        value={complaint}
        onChange={(e) => setComplaint(e.target.value)}
        rows={4}
        placeholder="What the student reports, in their words."
        className="mb-4 w-full rounded-[10px] border border-border bg-bg px-4 py-3 text-[13px] leading-[1.55] text-navy-2 outline-none focus:border-gold"
      />

      <label className="mb-1 block text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
        Brought / reported by <span className="font-normal normal-case tracking-normal text-navy-3">(optional)</span>
      </label>
      <input
        value={intake}
        onChange={(e) => setIntake(e.target.value)}
        placeholder="e.g. Sick Bay Prefect, a housemaster's name"
        className="mb-4 w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-[13px] text-navy-2 outline-none focus:border-gold"
      />

      {error && (
        <p className="mb-3 text-[12px] font-semibold text-terra">
          {error}
          {/* R75b — the open-visit collision returns the id of the visit that blocked this one, so
              the matron has somewhere to go rather than a dead end. */}
          {errorVisitId && (
            <a
              href={`/senior/sickbay/visits/${errorVisitId}`}
              className="ml-2 font-semibold text-gold no-underline"
            >
              Open that visit →
            </a>
          )}
        </p>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={submit}
        className="rounded-[5px] border border-navy bg-navy px-[16px] py-[9px] text-[12px] font-bold text-bg disabled:opacity-60"
      >
        {pending ? "Opening…" : "Open visit"}
      </button>
    </div>
  );
}
