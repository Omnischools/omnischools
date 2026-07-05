"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createSeniorAssessment,
  deleteSeniorAssessment,
  saveAssessmentScores,
} from "@/lib/actions/score-ledger";

export type AssessmentCategory =
  | "ASSIGNMENT"
  | "MID_SEM_EXAM"
  | "END_SEM_EXAM"
  | "PROJECT";

type Assessment = {
  id: string;
  category: AssessmentCategory;
  title: string;
  maxMark: number;
};
type Student = { id: string; name: string; code: string };

/** Category display + pill colour (§3.4: assignments/project green; the two exams navy). */
const CATEGORY: Record<
  AssessmentCategory,
  { short: string; long: string; pill: string; single: boolean }
> = {
  ASSIGNMENT: {
    short: "Assignment",
    long: "Assignments / class exercises",
    pill: "bg-green-bg text-green",
    single: false,
  },
  MID_SEM_EXAM: {
    short: "Mid-sem",
    long: "Mid-semester examination",
    pill: "bg-navy text-bg",
    single: true,
  },
  END_SEM_EXAM: {
    short: "End-of-sem",
    long: "End-of-semester examination",
    pill: "bg-navy text-bg",
    single: true,
  },
  PROJECT: {
    short: "Project",
    long: "Individual project work",
    pill: "bg-green-bg text-green",
    single: false,
  },
};
const ORDER: AssessmentCategory[] = [
  "ASSIGNMENT",
  "MID_SEM_EXAM",
  "END_SEM_EXAM",
  "PROJECT",
];

const inputCls =
  "w-16 rounded-md border border-border-2 bg-bg px-2 py-1.5 text-sm font-mono text-navy outline-none focus:border-gold";

const cellKey = (assessmentId: string, studentId: string) =>
  `${assessmentId}:${studentId}`;

export function SeniorAssessmentGrid({
  assessments,
  roster,
  scores,
  classId,
  subjectId,
  periodId,
}: {
  assessments: Assessment[];
  roster: Student[];
  scores: { assessmentId: string; studentId: string; raw: string }[];
  classId: string;
  subjectId: string;
  periodId: string;
}) {
  const router = useRouter();
  const initial = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of scores) m[cellKey(s.assessmentId, s.studentId)] = s.raw;
    return m;
  }, [scores]);

  const [cells, setCells] = useState<Record<string, string>>(initial);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(assessments.length === 0);

  // Add-assessment form state.
  const [category, setCategory] = useState<AssessmentCategory>("ASSIGNMENT");
  const [title, setTitle] = useState("");
  const [maxMark, setMaxMark] = useState("");
  const [adding, setAdding] = useState(false);

  // Columns ordered by category then insertion.
  const columns = useMemo(
    () =>
      [...assessments].sort(
        (a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category),
      ),
    [assessments],
  );

  function set(assessmentId: string, studentId: string, v: string) {
    const k = cellKey(assessmentId, studentId);
    setCells((c) => ({ ...c, [k]: v }));
    setDirty((d) => new Set(d).add(k));
    setMsg(null);
  }

  /** Over the event's max is allowed (bonus marks, Kofi Q3) but flagged. */
  function overMax(col: Assessment, studentId: string): boolean {
    const raw = cells[cellKey(col.id, studentId)];
    if (raw == null || raw.trim() === "") return false;
    const n = Number(raw);
    return Number.isFinite(n) && n > col.maxMark;
  }

  async function save() {
    if (dirty.size === 0) {
      setMsg("Nothing to save.");
      return;
    }
    setSaving(true);
    setError(null);
    setMsg(null);
    const payload = Array.from(dirty).map((k) => {
      const [assessmentId, studentId] = k.split(":");
      return { assessmentId, studentId, raw: cells[k] ?? "" };
    });
    const res = await saveAssessmentScores({ classId, subjectId, periodId, scores: payload });
    setSaving(false);
    if (res.ok) {
      setDirty(new Set());
      setMsg(`Saved ${res.saved} mark${res.saved === 1 ? "" : "s"} · ledger recompiled.`);
      router.refresh();
    } else setError(res.error);
  }

  async function addAssessment() {
    setError(null);
    setAdding(true);
    const res = await createSeniorAssessment({
      classId,
      subjectId,
      periodId,
      category,
      title: title.trim(),
      maxMark,
    });
    setAdding(false);
    if (res.ok) {
      setTitle("");
      setMaxMark("");
      setShowAdd(false);
      router.refresh();
    } else setError(res.error);
  }

  async function removeAssessment(id: string) {
    setError(null);
    const res = await deleteSeniorAssessment({ assessmentId: id });
    if (res.ok) router.refresh();
    else setError(res.error);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-navy-3">
          Record assignments, exams and projects · Path A auto-compiles the ledger on save.
        </p>
        <div className="flex items-center gap-2">
          {!showAdd && (
            <button
              onClick={() => setShowAdd(true)}
              className="rounded-md border border-border-2 bg-surface px-4 py-2 text-sm font-semibold text-navy hover:bg-gold-bg"
            >
              + Add assessment
            </button>
          )}
          <button
            onClick={save}
            disabled={saving || dirty.size === 0}
            className="rounded-md bg-navy px-5 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save & compile"}
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="mb-3 rounded-xl border border-border bg-surface p-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-navy-3">
              Category
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as AssessmentCategory)}
                className="mt-1 block rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none focus:border-gold"
              >
                {ORDER.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY[c].long}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-navy-3">
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Assignment 1"
                className="mt-1 block rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none focus:border-gold"
              />
            </label>
            <label className="text-xs text-navy-3">
              Max mark
              <input
                value={maxMark}
                onChange={(e) => setMaxMark(e.target.value)}
                type="number"
                min="1"
                placeholder="20"
                className="mt-1 block w-24 rounded-md border border-border-2 bg-bg px-3 py-2 text-sm font-mono text-navy outline-none focus:border-gold"
              />
            </label>
            <button
              onClick={addAssessment}
              disabled={adding || !title.trim() || !maxMark}
              className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg hover:bg-navy-deep disabled:opacity-60"
            >
              {adding ? "Adding…" : "Add"}
            </button>
            {assessments.length > 0 && (
              <button
                onClick={() => setShowAdd(false)}
                className="rounded-md border border-border-2 bg-surface px-4 py-2 text-sm font-semibold text-navy hover:bg-gold-bg"
              >
                Cancel
              </button>
            )}
          </div>
          <p className="mt-2 text-[11px] text-navy-3">
            Mid-semester and end-of-semester exams are single events per class · assignments
            and projects can be many.
          </p>
        </div>
      )}

      {msg && (
        <p className="mb-3 rounded-md bg-green-bg px-3 py-2 text-sm text-green">{msg}</p>
      )}
      {error && <p className="mb-3 text-sm text-terra">{error}</p>}

      {columns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-2 bg-surface p-10 text-center text-sm text-navy-3">
          No assessments yet. Add an assignment, exam or project to start recording marks —
          the ledger auto-compiles as you go.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
              <tr>
                <th className="sticky left-0 z-10 bg-bg px-4 py-3 font-semibold">
                  Student
                </th>
                {columns.map((col) => (
                  <th key={col.id} className="px-3 py-3 text-center font-semibold">
                    <div className="flex items-center justify-center gap-1.5">
                      <span className="text-navy">{col.title}</span>
                      <button
                        onClick={() => removeAssessment(col.id)}
                        title={`Delete ${col.title}`}
                        aria-label={`Delete ${col.title}`}
                        className="text-navy-3 hover:text-terra"
                      >
                        ×
                      </button>
                    </div>
                    <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[10px] normal-case">
                      <span className="font-mono text-navy-3">/{col.maxMark}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${CATEGORY[col.category].pill}`}
                      >
                        {CATEGORY[col.category].short}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {roster.map((s) => (
                <tr key={s.id}>
                  <td className="sticky left-0 z-10 bg-surface px-4 py-2.5">
                    <div className="font-medium text-navy">{s.name}</div>
                    <div className="font-mono text-xs text-navy-3">{s.code}</div>
                  </td>
                  {columns.map((col) => (
                    <td key={col.id} className="px-3 py-2.5 text-center">
                      <input
                        className={
                          overMax(col, s.id)
                            ? inputCls + " border-warn bg-warn-bg text-warn"
                            : inputCls
                        }
                        type="number"
                        min="0"
                        step="0.01"
                        title={overMax(col, s.id) ? `Above the ${col.maxMark} max` : undefined}
                        value={cells[cellKey(col.id, s.id)] ?? ""}
                        onChange={(e) => set(col.id, s.id, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
