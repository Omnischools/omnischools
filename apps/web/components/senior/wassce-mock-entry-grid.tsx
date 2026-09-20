"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveMockResult,
  moderateMockResult,
  clearMockModeration,
} from "@/lib/actions/wassce-mocks";
import { WASSCE_GRADES, type WassceGrade } from "@/lib/wassce/mock-grades";
import { GRADE_COLORS, GRADE_CHIP_TEXT } from "@/lib/wassce/grade-colors";
import type { MockColumn, MockCandidateRow } from "@/lib/wassce/mock-view";

/**
 * The §B.2 candidate trajectory table — THE mark-entry write surface (INCR-16) and, since INCR-18, the
 * home of the HoA MODERATION write (Decision 10: distribution → escalate → moderate). CLIENT component:
 * it imports the pure view-model types + the pure grade helpers + the server actions, but NO db driver
 * and NO server loader (repo memory `reports-data-is-server-only`). Every value it renders is a
 * PRE-FORMATTED string handed from the server.
 *
 * States (Part C): a mock column that is `locked` (marking complete) renders read-only grade chips; an
 * open column with write access renders a grade <select> that saves on change (pending tint is the SOLID
 * `bg-gold-bg`, never `bg-gold/8` — the no-alpha trap). A moderated cell is read-only for the teacher and
 * shows the HoA grade over the teacher's dimmed original (AC10).
 *
 * MODERATION (`canModerate` = WASSCE_SETUP_ROLES only — never a TEACHER, not even on their own subject)
 * is a per-cell affordance that opens ONE panel above the grid rather than a second screen. It stays
 * available when the column is `locked`: moderation is precisely the write that survives marking closing.
 */

function GradeChip({ grade, dim, small }: { grade: WassceGrade; dim?: boolean; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md font-display font-semibold ${
        small ? "h-5 px-1.5 text-[10px]" : "h-[30px] w-[30px] text-[12px]"
      }`}
      style={
        dim
          ? { background: "transparent", color: "#8A93A6", textDecoration: "line-through" }
          : { background: GRADE_COLORS[grade], color: GRADE_CHIP_TEXT }
      }
    >
      {grade}
    </span>
  );
}

const EM_DASH = "—";

/** The cell currently open in the moderation panel. */
type ModerationTarget = {
  mockId: string;
  candidateId: string;
  candidateName: string;
  columnLabel: string;
  grade: WassceGrade;
  moderatedGrade: WassceGrade | null;
};

export function WassceMockEntryGrid({
  rows,
  columns,
  subjectId,
  canWrite,
  canModerate = false,
  predictorColumnId,
}: {
  rows: MockCandidateRow[];
  columns: MockColumn[];
  subjectId: string;
  canWrite: boolean;
  /** WASSCE_SETUP_ROLES only. A TEACHER never gets this, including on their own subject. */
  canModerate?: boolean;
  predictorColumnId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<ModerationTarget | null>(null);
  const [modGrade, setModGrade] = useState("");
  const [modReason, setModReason] = useState("");

  const anyOpen = columns.some((c) => !c.locked);

  function save(mockId: string, candidateId: string, grade: string) {
    setError(null);
    setBusyKey(`${mockId}:${candidateId}`);
    startTransition(async () => {
      const res = await saveMockResult({ mockId, candidateId, subjectId, grade });
      setBusyKey(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function openPanel(t: ModerationTarget) {
    setError(null);
    setTarget(t);
    setModGrade(t.moderatedGrade ?? "");
    setModReason(""); // never pre-filled: each moderation event carries its own rationale
  }

  function submitModeration(clear: boolean) {
    if (!target) return;
    setError(null);
    startTransition(async () => {
      const key = { mockId: target.mockId, candidateId: target.candidateId, subjectId };
      const res = clear
        ? await clearMockModeration({ ...key, reason: modReason })
        : await moderateMockResult({ ...key, moderatedGrade: modGrade, reason: modReason });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setTarget(null);
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border-2 bg-surface p-10 text-center text-[12px] text-navy-3">
        No candidates have mock results for this subject yet.
        {canWrite && anyOpen ? " Enter a grade to begin." : ""}
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-2 rounded-md border border-terra bg-terra-bg px-3 py-2 text-[12px] text-terra">
          {error}
        </div>
      )}
      {target && (
        <div className="mb-2 rounded-xl border border-gold-soft bg-gold-bg p-4">
          <div className="font-display text-[14px] font-medium text-navy">
            Moderate · {target.candidateName} · {target.columnLabel}
          </div>
          <div className="mt-1 text-[11px] text-navy-2">
            Teacher grade {target.grade} — kept on the record. Moderating adds a grade alongside it; it
            never replaces it.
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
              Moderated grade
              <select
                value={modGrade}
                onChange={(e) => setModGrade(e.target.value)}
                className="rounded-md border border-border-2 bg-surface px-2 py-1.5 font-display text-[13px] font-semibold text-navy focus:border-gold focus:outline-none"
              >
                <option value="">{EM_DASH}</option>
                {WASSCE_GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[260px] flex-1 flex-col gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
              Reason (required, 5–500 characters)
              <input
                type="text"
                value={modReason}
                maxLength={500}
                onChange={(e) => setModReason(e.target.value)}
                placeholder="Re-mark of Section B after script review."
                className="rounded-md border border-border-2 bg-surface px-2 py-1.5 text-[12px] text-navy focus:border-gold focus:outline-none"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending || modGrade === "" || modReason.trim().length < 5}
                onClick={() => submitModeration(false)}
                className="rounded-md border border-gold bg-gold px-3.5 py-2 text-[12px] font-bold text-navy disabled:opacity-50"
              >
                Save moderation
              </button>
              {target.moderatedGrade != null && (
                <button
                  type="button"
                  disabled={pending || modReason.trim().length < 5}
                  onClick={() => submitModeration(true)}
                  className="rounded-md border border-border-2 bg-surface px-3.5 py-2 text-[12px] font-semibold text-terra disabled:opacity-50"
                >
                  Clear moderation
                </button>
              )}
              <button
                type="button"
                onClick={() => setTarget(null)}
                className="rounded-md border border-border-2 bg-surface px-3.5 py-2 text-[12px] font-semibold text-navy"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[720px] border-collapse">
          <thead className="border-b border-border bg-bg text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
            <tr>
              <th className="px-3 py-3 text-left">#</th>
              <th className="px-3 py-3 text-left">Name &amp; house</th>
              {columns.map((c) => (
                <th key={c.id} className="px-3 py-3 text-center">
                  {c.label}
                  {c.locked && <span className="ml-1 text-navy-3">🔒</span>}
                </th>
              ))}
              <th className="px-3 py-3 text-center">Trajectory</th>
              <th className="px-3 py-3 text-center">Predicted</th>
              <th className="px-3 py-3 text-left">Teacher note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-border align-middle"
                style={
                  r.isFocus
                    ? { background: "#FBEBE7" }
                    : r.rank <= 3
                      ? { background: "#F5FBF7" }
                      : undefined
                }
              >
                <td className="px-3 py-3 font-mono text-[11px] font-semibold text-navy-3">
                  {String(r.rank).padStart(2, "0")}
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="font-display text-[12px] font-semibold text-navy">{r.name}</span>
                    {r.medFlag && (
                      <span className="rounded-full bg-terra-bg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-terra">
                        MED
                      </span>
                    )}
                    {r.isFocus && (
                      <span className="rounded-full bg-warn-bg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-warn">
                        FOCUS
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-navy-3">
                    {r.house ? `${r.house} · ` : ""}
                    {r.indexNumber}
                  </div>
                </td>
                {columns.map((c) => {
                  const cell = r.cells[c.id];
                  const editable = canWrite && !c.locked && (!cell || cell.moderatedGrade == null);
                  const key = `${c.id}:${r.id}`;
                  const isBusy = busyKey === key && pending;
                  return (
                    <td
                      key={c.id}
                      className="px-3 py-3 text-center"
                      style={isBusy ? { background: "var(--gold-bg)" } : undefined}
                    >
                      {cell && cell.moderatedGrade != null ? (
                        <span className="inline-flex flex-col items-center gap-0.5">
                          <span className="inline-flex items-center gap-1">
                            <GradeChip grade={cell.moderatedGrade} small />
                            <span className="rounded bg-navy px-1 py-0.5 text-[8px] font-bold uppercase text-gold">
                              MOD
                            </span>
                          </span>
                          <GradeChip grade={cell.grade} small dim />
                        </span>
                      ) : editable ? (
                        <select
                          aria-label={`${c.label} grade for ${r.name}`}
                          disabled={isBusy}
                          value={cell ? cell.grade : ""}
                          onChange={(e) => e.target.value && save(c.id, r.id, e.target.value)}
                          className="rounded-md border border-border-2 bg-surface px-1.5 py-1 font-display text-[12px] font-semibold text-navy focus:border-gold focus:outline-none"
                        >
                          <option value="">{EM_DASH}</option>
                          {WASSCE_GRADES.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      ) : cell ? (
                        <GradeChip grade={cell.effective} />
                      ) : (
                        <span className="text-[13px] text-navy-3">{EM_DASH}</span>
                      )}
                      {canModerate && cell && (
                        <button
                          type="button"
                          onClick={() =>
                            openPanel({
                              mockId: c.id,
                              candidateId: r.id,
                              candidateName: r.name,
                              columnLabel: c.label,
                              grade: cell.grade,
                              moderatedGrade: cell.moderatedGrade,
                            })
                          }
                          className="mt-1 block w-full text-[9px] font-bold uppercase tracking-wide text-navy-3 hover:text-gold"
                        >
                          {cell.moderatedGrade != null ? "Edit moderation" : "Moderate"}
                        </button>
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-3 text-center">
                  <span
                    className={`text-[13px] font-bold ${
                      r.trajectory.dir === "down"
                        ? "text-terra"
                        : r.trajectory.dir === "up"
                          ? "text-green"
                          : "text-navy-3"
                    }`}
                  >
                    {r.trajectory.label}
                  </span>
                </td>
                <td className="px-3 py-3 text-center">
                  {r.predicted ? (
                    <GradeChip grade={r.predicted} small />
                  ) : (
                    <span className="text-[13px] text-navy-3">{EM_DASH}</span>
                  )}
                </td>
                <td className="px-3 py-3 text-[11px] text-navy-2">
                  {r.teacherNote ?? <span className="text-navy-3">{EM_DASH}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] italic text-navy-3">
        {rows.length} candidates ·{" "}
        {predictorColumnId
          ? "predicted grade = the moderated-or-teacher grade of the predictor mock (derived on read)"
          : "no predictor mock yet — predicted grade pending"}
        {canWrite
          ? anyOpen
            ? " · marking open — pick a grade to save"
            : " · marking complete — read-only"
          : " · read-only (not your assigned subject)"}
        .
      </p>
    </div>
  );
}
