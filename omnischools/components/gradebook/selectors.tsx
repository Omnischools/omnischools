"use client";
import { useRouter } from "next/navigation";

type Opt = { id: string; label: string };

/** Three linked selectors (class · subject · period) that drive /gradebook via query. */
export function GradebookSelectors({
  classes,
  subjects,
  periods,
  classId,
  subjectId,
  periodId,
  basePath = "/gradebook",
  showSubject = true,
}: {
  classes: Opt[];
  subjects: Opt[];
  periods: Opt[];
  classId?: string;
  subjectId?: string;
  periodId?: string;
  basePath?: string;
  showSubject?: boolean;
}) {
  const router = useRouter();
  function go(next: { classId?: string; subjectId?: string; periodId?: string }) {
    const p = new URLSearchParams();
    const cId = next.classId ?? classId;
    const sId = next.subjectId ?? subjectId;
    const pId = next.periodId ?? periodId;
    if (cId) p.set("classId", cId);
    if (showSubject && sId) p.set("subjectId", sId);
    if (pId) p.set("periodId", pId);
    router.push(`${basePath}?${p.toString()}`);
  }
  const cls =
    "rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none focus:border-gold";
  return (
    <div className="flex flex-wrap gap-2">
      <select
        value={classId ?? ""}
        onChange={(e) => go({ classId: e.target.value })}
        className={cls}
      >
        <option value="">Class…</option>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      {showSubject && (
        <select
          value={subjectId ?? ""}
          onChange={(e) => go({ subjectId: e.target.value })}
          className={cls}
        >
          <option value="">Subject…</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      )}
      <select
        value={periodId ?? ""}
        onChange={(e) => go({ periodId: e.target.value })}
        className={cls}
      >
        <option value="">Period…</option>
        {periods.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </div>
  );
}
