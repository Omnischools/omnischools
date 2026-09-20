"use client";
/**
 * VLC Session register — client interactives (SHS module 4.5 / INCR-42a): the P/L/A attendance grid and
 * the "open session" picker. Everything else on the register is server-rendered. Both receive plain
 * serializable props (NEVER the DB driver) and call the FM-gated server actions; the server re-checks the
 * write scope + the auto-lock, so a disabled control is a convenience, not the boundary.
 *
 * No-alpha token care (memory `no-alpha-token-opacity`): the P/L/A cells use the dedicated `-bg` tint
 * tokens (green-bg / warn-bg / terra-bg / gold-bg) and solid dot colours — never a slash-opacity on a
 * raw-hex green/terra.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SessionCell, CellStatus } from "@/lib/vlc/session-data";
import { markAttendance, openSession } from "@/lib/actions/vlc-sessions";

const NEXT: Record<CellStatus, CellStatus> = { present: "late", late: "absent", absent: "present" };
const STATUS_ENUM: Record<CellStatus, "PRESENT" | "LATE" | "ABSENT"> = {
  present: "PRESENT",
  late: "LATE",
  absent: "ABSENT",
};

function cellTokens(c: SessionCell): { ground: string; dot: string; name: string } {
  if (c.status === "absent") return { ground: "border-terra bg-terra-bg", dot: "bg-terra", name: "text-terra" };
  if (c.status === "late") return { ground: "border-warn bg-warn-bg", dot: "bg-warn", name: "text-warn" };
  if (c.isPeerGuide) return { ground: "border-gold bg-gold-bg", dot: "bg-gold", name: "text-navy" };
  return { ground: "border-border bg-bg", dot: "bg-green", name: "text-navy-3" };
}

export function SessionAttendanceGrid({
  sessionId,
  cells: initial,
  canEdit,
}: {
  sessionId: string;
  cells: SessionCell[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [cells, setCells] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const summary = useMemo(() => {
    const enrolled = cells.length;
    const absent = cells.filter((c) => c.status === "absent").length;
    const late = cells.filter((c) => c.status === "late").length;
    const pg = cells.filter((c) => c.isPeerGuide).length;
    const present = Math.max(0, enrolled - absent);
    return { enrolled, absent, late, pg, present, pct: enrolled ? Math.round((present / enrolled) * 100) : 0 };
  }, [cells]);

  const cycle = (studentId: string) => {
    if (!canEdit || pending) return;
    setError(null);
    const target = cells.find((c) => c.studentId === studentId);
    if (!target) return;
    const next = NEXT[target.status];
    const prev = cells;
    setCells((cs) => cs.map((c) => (c.studentId === studentId ? { ...c, status: next } : c)));
    start(async () => {
      const res = await markAttendance({ sessionId, studentId, status: STATUS_ENUM[next] });
      if (!res.ok) {
        setCells(prev); // revert on refusal (wrong role / auto-locked)
        setError(res.error ?? "Could not save that mark.");
      } else {
        router.refresh();
      }
    });
  };

  return (
    <div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
        {cells.map((c) => {
          const t = cellTokens(c);
          const Tag = canEdit ? "button" : "div";
          return (
            <Tag
              key={c.studentId}
              {...(canEdit
                ? { type: "button" as const, onClick: () => cycle(c.studentId), disabled: pending }
                : {})}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-2 text-left ${t.ground} ${
                canEdit ? "transition-colors hover:brightness-95 disabled:opacity-60" : ""
              }`}
              title={canEdit ? "Click to cycle Present → Late → Absent" : undefined}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${t.dot}`} aria-hidden />
              <span className={`truncate text-[11px] font-medium ${t.name}`}>{c.name}</span>
            </Tag>
          );
        })}
      </div>

      {/* summary pills — all DERIVED from the P/L/A cells + the PG flag */}
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="rounded-pill bg-green-bg px-3 py-1 text-[11px] font-bold uppercase tracking-[0.04em] text-green">
          {summary.present} present · {summary.pct}%
        </span>
        <span className="rounded-pill bg-warn-bg px-3 py-1 text-[11px] font-bold uppercase tracking-[0.04em] text-warn">
          {summary.late} late
        </span>
        <span className="rounded-pill bg-terra-bg px-3 py-1 text-[11px] font-bold uppercase tracking-[0.04em] text-terra">
          {summary.absent} absent
        </span>
        <span className="rounded-pill bg-gold-bg px-3 py-1 text-[11px] font-bold uppercase tracking-[0.04em] text-gold">
          {summary.pg} PG (gold) first
        </span>
      </div>

      {error && <p className="mt-3 text-[12px] text-terra">{error}</p>}
      {!canEdit && (
        <p className="mt-3 text-[12px] italic text-navy-3">
          The register is read-only — it can be marked only by the class Form Master while the session is
          live.
        </p>
      )}
    </div>
  );
}

export function OpenSessionForm({
  classId,
  date,
  templates,
}: {
  classId: string;
  date: string;
  templates: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!templateId || pending) return;
    setError(null);
    start(async () => {
      const res = await openSession({ classId, date, sessionTemplateId: templateId });
      if (!res.ok) setError(res.error ?? "Could not open the session.");
      else router.refresh();
    });
  };

  if (templates.length === 0) {
    return (
      <p className="text-[13px] text-navy-3">
        No VLC values are configured yet — set the programme up on the{" "}
        <span className="font-semibold text-navy">Setup</span> tab first.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">
        Value · session
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="min-w-[280px] rounded-md border border-border-2 bg-surface px-3 py-2 text-[13px] font-normal normal-case text-navy"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={submit}
        disabled={pending || !templateId}
        className="rounded-md border border-gold bg-gold px-4 py-2 text-xs font-bold text-navy hover:brightness-95 disabled:opacity-60"
      >
        {pending ? "Opening…" : "Open session"}
      </button>
      {error && <p className="w-full text-[12px] text-terra">{error}</p>}
    </div>
  );
}
