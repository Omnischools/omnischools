"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { saveAttendance, requestCorrection } from "@/lib/actions/attendance";
import { ATTENDANCE_REASONS, reasonLabel } from "@/lib/attendance-reasons";
import {
  ATTENDANCE_STATUS_META,
  ATTENDANCE_STATUS_ORDER,
  STATUS_HOTKEYS,
  type AttendanceStatus,
} from "@/lib/attendance-status";

type Tag = { label: string; tone: "warn" | "terra" };

export type RegisterRow = {
  id: string;
  first: string;
  last: string;
  initials: string;
  code: string;
  status: AttendanceStatus | null;
  recordId: string | null;
  reasonCode: string | null;
  note: string | null;
  termPct: number | null;
  termDays: string | null;
  consecutiveAbsent: number;
  tags: Tag[];
};

export type YesterdayPrefill = {
  date: string;
  entries: Record<
    string,
    { status: AttendanceStatus; reasonCode: string | null; note: string | null }
  >;
};

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};

const pctTone = (p: number) =>
  p >= 90 ? "text-green" : p >= 70 ? "text-gold" : "text-terra";

/** "JHS 2A" → JHS <em>2A</em> (italic-gold form suffix, per the surface H1). */
function ClassTitle({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  const last = parts[parts.length - 1];
  if (parts.length > 1 && /^[A-Za-z]?\d+[A-Za-z]?$/.test(last)) {
    return (
      <>
        {parts.slice(0, -1).join(" ")} <em className="not-italic text-gold">{last}</em>
      </>
    );
  }
  return <>{name}</>;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-b-2 border-border-2 bg-bg px-[5px] font-mono text-[10px] font-bold text-navy-2">
      {children}
    </span>
  );
}

export function TakeRegister({
  classId,
  date,
  roster,
  locked = false,
  className,
  dateLabel,
  teacher,
  termLabel,
  dayOf,
  editWindowHours = 24,
  windowCloseLabel = null,
  yesterday = null,
}: {
  classId: string;
  date: string;
  roster: RegisterRow[];
  locked?: boolean;
  className: string;
  dateLabel: string;
  teacher: string | null;
  termLabel: string | null;
  dayOf: number | null;
  editWindowHours?: number;
  windowCloseLabel?: string | null;
  yesterday?: YesterdayPrefill | null;
}) {
  const router = useRouter();
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus | null>>(
    Object.fromEntries(roster.map((r) => [r.id, r.status])),
  );
  const [reasons, setReasons] = useState<Record<string, string>>(
    Object.fromEntries(roster.map((r) => [r.id, r.reasonCode ?? ""])),
  );
  const [notes, setNotes] = useState<Record<string, string>>(
    Object.fromEntries(roster.map((r) => [r.id, r.note ?? ""])),
  );
  const [focused, setFocused] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = roster.length;
  const byStatus = (st: AttendanceStatus) => roster.filter((r) => statuses[r.id] === st);
  const present = byStatus("PRESENT");
  const late = byStatus("LATE");
  const excused = byStatus("EXCUSED");
  const medical = byStatus("MEDICAL");
  const absent = byStatus("ABSENT");
  const marked = roster.filter((r) => statuses[r.id] != null).length;
  const unmarked = total - marked;
  const pctOfClass = total ? Math.round((present.length / total) * 1000) / 10 : 0;
  const fullName = (r: RegisterRow) => `${r.first} ${r.last}`;
  const overflow = (arr: RegisterRow[]) => (arr.length > 1 ? ` +${arr.length - 1}` : "");

  const markStatus = useCallback((id: string, v: AttendanceStatus) => {
    setStatuses((s) => ({ ...s, [id]: v }));
  }, []);

  const allPresent = () =>
    setStatuses(Object.fromEntries(roster.map((r) => [r.id, "PRESENT" as AttendanceStatus])));
  const reset = () =>
    setStatuses(Object.fromEntries(roster.map((r) => [r.id, null])));
  const copyYesterday = () => {
    if (!yesterday) return;
    setStatuses((s) => {
      const next = { ...s };
      for (const r of roster) {
        const y = yesterday.entries[r.id];
        if (y) next[r.id] = y.status;
      }
      return next;
    });
    setReasons((s) => {
      const next = { ...s };
      for (const r of roster) {
        const y = yesterday.entries[r.id];
        if (y) next[r.id] = y.reasonCode ?? "";
      }
      return next;
    });
    setNotes((s) => {
      const next = { ...s };
      for (const r of roster) {
        const y = yesterday.entries[r.id];
        if (y) next[r.id] = y.note ?? "";
      }
      return next;
    });
  };

  const doSave = useCallback(async () => {
    const entries = roster
      .filter((r) => statuses[r.id] != null)
      .map((r) => ({
        studentId: r.id,
        status: statuses[r.id] as AttendanceStatus,
        reasonCode: statuses[r.id] === "PRESENT" ? null : reasons[r.id] || null,
        note: statuses[r.id] === "PRESENT" ? null : notes[r.id] || null,
      }));
    if (entries.length === 0) {
      setError("Mark at least one student before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    setResult(null);
    const res = await saveAttendance({ classId, date, entries });
    setSaving(false);
    if (res.ok) {
      setResult(
        `Saved ${res.marked} · ${res.absent} absent · ${res.alertsSent} alert(s) sent`,
      );
      router.refresh();
    } else {
      setError(res.error);
    }
  }, [roster, statuses, reasons, notes, classId, date, router]);

  // Keyboard workflow (surface legend: P L E M A · ↑ ↓ · ⏎ · ⌘⏎).
  useEffect(() => {
    if (locked) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (marked === total && total > 0) void doSave();
        return;
      }
      const el = e.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocused((f) => Math.min((f ?? -1) + 1, total - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocused((f) => Math.max((f ?? total) - 1, 0));
      } else if (focused != null) {
        const hot = STATUS_HOTKEYS[e.key.toLowerCase()];
        if (hot) {
          e.preventDefault();
          markStatus(roster[focused].id, hot);
        } else if (e.key === "Enter") {
          e.preventDefault();
          document
            .querySelector<HTMLSelectElement>(`[data-reason="${roster[focused].id}"]`)
            ?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, focused, marked, total, roster, markStatus, doSave]);

  const absentSms = absent.length;
  const footerMeta = (
    <>
      {absentSms === 0
        ? "No absence SMS to send"
        : `${absentSms} absence SMS will be sent on submit`}{" "}
      ·{" "}
      {windowCloseLabel ? (
        <>
          edit window closes <b className="font-semibold text-navy-2">{windowCloseLabel}</b>
        </>
      ) : (
        <>
          edit window: <b className="font-semibold text-navy-2">{editWindowHours}h</b> after
          you submit
        </>
      )}
    </>
  );

  type Tile = { label: string; count: number; num: string; accent: string; sub: React.ReactNode };
  const tiles: Tile[] = [
    {
      label: "Present",
      count: present.length,
      num: ATTENDANCE_STATUS_META.PRESENT.num,
      accent: "#2F6B47",
      sub: (
        <>
          <b className="font-semibold text-navy-2">{pctOfClass}%</b> of class
        </>
      ),
    },
    {
      label: "Late",
      count: late.length,
      num: ATTENDANCE_STATUS_META.LATE.num,
      accent: "#C8975B",
      sub: late.length ? `${fullName(late[0])}${overflow(late)}` : "—",
    },
    {
      label: "Excused",
      count: excused.length,
      num: ATTENDANCE_STATUS_META.EXCUSED.num,
      accent: "#C58A2E",
      sub: excused.length
        ? `${fullName(excused[0])} · ${reasonLabel(reasons[excused[0].id]) ?? "excused"}`
        : "—",
    },
    {
      label: "Medical",
      count: medical.length,
      num: ATTENDANCE_STATUS_META.MEDICAL.num,
      accent: "#2D3F5C",
      sub: medical.length ? `${fullName(medical[0])} · medical` : "—",
    },
    {
      label: "Absent",
      count: absent.length,
      num: ATTENDANCE_STATUS_META.ABSENT.num,
      accent: "#B84A39",
      sub: absent.length
        ? `${fullName(absent[0])}${
            absent[0].consecutiveAbsent >= 2
              ? ` · ${ordinal(absent[0].consecutiveAbsent)} day`
              : ""
          }${overflow(absent)}`
        : "—",
    },
    {
      label: "Unmarked",
      count: unmarked,
      num: "text-navy-3",
      accent: "#D4CCBA",
      sub: unmarked === 0 ? "All accounted for" : `${unmarked} to mark`,
    },
  ];

  const ledeParts: React.ReactNode[] = [
    `${total} student${total === 1 ? "" : "s"}`,
  ];
  if (teacher)
    ledeParts.push(
      <>
        class teacher <b className="font-semibold text-navy-2">{teacher}</b>
      </>,
    );
  if (termLabel) ledeParts.push(termLabel);
  if (dayOf != null) ledeParts.push(`Day ${dayOf}`);

  return (
    <div>
      {/* ── Active-register head ───────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-navy-3">
            <Link href="/attendance" className="text-gold hover:underline">
              Attendance
            </Link>{" "}
            / Today / {className}
          </div>
          <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
            <ClassTitle name={className} /> · {dateLabel}
          </h1>
          <p className="mt-1 text-sm text-navy-3">
            {ledeParts.map((p, i) => (
              <span key={i}>
                {i > 0 ? " · " : ""}
                {p}
              </span>
            ))}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={copyYesterday}
            disabled={locked || !yesterday}
            title={yesterday ? `Copy marks from ${yesterday.date}` : "No earlier register"}
            className="rounded-md border border-border-2 bg-surface px-3 py-2 text-sm font-semibold text-navy hover:bg-gold-bg disabled:opacity-50"
          >
            Copy from yesterday
          </button>
          <Link
            href={`/attendance/term-grid?classId=${classId}`}
            className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-bg hover:bg-navy-deep"
          >
            View term grid
          </Link>
        </div>
      </div>

      {/* Stat strip */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="grid grid-cols-[auto_1fr] items-center gap-3 rounded-[10px] border border-border bg-surface px-4 py-3"
            style={{ borderLeftWidth: 3, borderLeftColor: t.accent }}
          >
            <div className={cn("font-display text-[26px] font-semibold leading-none", t.num)}>
              {t.count}
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">
                {t.label}
              </div>
              <div className="mt-0.5 text-[11px] text-navy-3">{t.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {locked && (
        <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-warn/40 bg-warn-bg/40 px-4 py-3 text-sm">
          <span className="font-semibold text-warn">Register locked.</span>
          <span className="text-navy-2">
            The edit window has closed — use <b>Request correction</b> on a student to change a
            mark (it needs an admin co-sign).
          </span>
        </div>
      )}

      {/* ── Action bar ─────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={allPresent}
            disabled={locked}
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
          >
            All present
          </button>
          <button
            onClick={reset}
            disabled={locked || marked === 0}
            className="rounded-md border border-border-2 bg-surface px-3 py-2 text-sm font-semibold text-navy hover:bg-gold-bg disabled:opacity-50"
          >
            Reset
          </button>
          <label className="ml-1 flex items-center gap-2 text-sm text-navy-2">
            Date
            <input
              type="date"
              value={date}
              onChange={(e) =>
                router.push(`/attendance/${classId}?date=${e.target.value}`)
              }
              className="rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none focus:border-gold"
            />
          </label>
        </div>
        <div className="hidden gap-3.5 text-[10px] font-semibold text-navy-3 lg:flex">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>P</Kbd>
            <Kbd>L</Kbd>
            <Kbd>E</Kbd>
            <Kbd>M</Kbd>
            <Kbd>A</Kbd>
            <span className="tracking-wide">mark status</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            <span className="tracking-wide">navigate</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>⏎</Kbd>
            <span className="tracking-wide">add reason</span>
          </span>
        </div>
      </div>

      {result && (
        <p className="mb-3 rounded-md bg-green-bg px-3 py-2 text-sm text-green">{result}</p>
      )}
      {error && <p className="mb-3 text-sm text-terra">{error}</p>}

      {/* ── Roster table ───────────────────────────────────────── */}
      <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg text-left text-[9px] uppercase tracking-[0.14em] text-navy-3">
            <tr>
              <th className="w-8 px-4 py-2.5 font-bold">#</th>
              <th className="px-4 py-2.5 font-bold">Student</th>
              <th className="px-4 py-2.5 font-bold">Term attendance</th>
              <th className="px-4 py-2.5 text-center font-bold">Status</th>
              <th className="px-4 py-2.5 font-bold">Reason / note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {roster.map((r, idx) => {
              const st = statuses[r.id];
              const isFocused = focused === idx;
              const tint = st ? ATTENDANCE_STATUS_META[st].rowTint : "";
              const editable = !locked && st != null && st !== "PRESENT";
              return (
                <tr
                  key={r.id}
                  onClick={() => setFocused(idx)}
                  className={cn(
                    isFocused && "bg-gold-bg outline outline-2 -outline-offset-2 outline-gold",
                  )}
                  style={!isFocused && tint ? { backgroundColor: tint } : undefined}
                >
                  <td className="px-4 py-2.5 font-mono text-[11px] font-semibold text-navy-3">
                    {String(idx + 1).padStart(2, "0")}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold-bg font-display text-[11px] font-semibold text-navy">
                        {r.initials}
                      </span>
                      <div>
                        <div className="text-[13px] font-semibold text-navy">
                          {fullName(r)}
                        </div>
                        <div className="font-mono text-[10px] text-navy-3">{r.code}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {r.termPct === null ? (
                      <span className="text-[10px] text-navy-3">—</span>
                    ) : (
                      <span className="flex items-baseline gap-2">
                        <span
                          className={cn(
                            "font-display text-sm font-semibold",
                            pctTone(r.termPct),
                          )}
                        >
                          {r.termPct}%
                        </span>
                        <span className="text-[10px] text-navy-3">{r.termDays}</span>
                        {r.tags.map((tag) => (
                          <span
                            key={tag.label}
                            className={cn(
                              "rounded-pill px-[7px] py-0.5 text-[9px] font-bold uppercase tracking-[0.04em]",
                              tag.tone === "terra"
                                ? "bg-terra-bg text-terra"
                                : "bg-warn-bg text-warn",
                            )}
                          >
                            {tag.label}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-center">
                      <div className="inline-flex gap-0 rounded-lg border border-border bg-bg p-[3px]">
                        {ATTENDANCE_STATUS_ORDER.map((s) => {
                          const m = ATTENDANCE_STATUS_META[s];
                          const sel = st === s;
                          return (
                            <button
                              key={s}
                              onClick={() => markStatus(r.id, s)}
                              disabled={locked}
                              title={m.label}
                              className={cn(
                                "flex h-[30px] w-9 items-center justify-center rounded-[5px] font-display text-[13px] font-bold transition-colors disabled:opacity-60",
                                sel ? m.seg : "text-navy-3 hover:bg-surface hover:text-navy",
                              )}
                            >
                              {m.letter}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {locked && r.recordId ? (
                      <div className="text-xs italic leading-snug text-navy-2">
                        {r.reasonCode || r.note ? (
                          <>
                            <b className="font-semibold not-italic text-navy">
                              {reasonLabel(r.reasonCode) ?? "Marked"}
                            </b>
                            {r.note ? ` · ${r.note}` : ""}
                          </>
                        ) : (
                          <span className="opacity-50">—</span>
                        )}
                        <span className="ml-2 not-italic">
                          <RequestCorrection recordId={r.recordId} />
                        </span>
                      </div>
                    ) : editable ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <select
                          data-reason={r.id}
                          value={reasons[r.id] ?? ""}
                          onChange={(e) =>
                            setReasons((s) => ({ ...s, [r.id]: e.target.value }))
                          }
                          className="rounded border border-border-2 bg-bg px-1.5 py-1 text-xs text-navy outline-none focus:border-gold"
                        >
                          <option value="">Reason…</option>
                          {ATTENDANCE_REASONS.map((o) => (
                            <option key={o.code} value={o.code}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <input
                          value={notes[r.id] ?? ""}
                          onChange={(e) =>
                            setNotes((s) => ({ ...s, [r.id]: e.target.value }))
                          }
                          placeholder="note (optional)"
                          maxLength={300}
                          className="w-36 rounded border border-border-2 bg-bg px-1.5 py-1 text-xs text-navy outline-none focus:border-gold"
                        />
                      </div>
                    ) : (
                      <span className="text-[11px] italic text-navy-3 opacity-50">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Sticky submit footer ───────────────────────────────── */}
      <div className="sticky bottom-0 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-border bg-surface px-5 py-4 shadow-sm">
        <div>
          <div className="font-display text-sm font-semibold text-navy">
            {marked} of {total} marked
          </div>
          <div className="text-[11px] text-navy-3">{footerMeta}</div>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={doSave}
            disabled={saving || locked || marked === 0 || marked === total}
            className="rounded-md border border-border-2 bg-surface px-4 py-2.5 text-sm font-semibold text-navy hover:bg-gold-bg disabled:opacity-50"
          >
            Save draft
          </button>
          <button
            onClick={doSave}
            disabled={saving || locked || total === 0 || marked !== total}
            className="inline-flex items-center gap-1.5 rounded-md bg-navy px-5 py-2.5 text-sm font-bold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
          >
            {locked ? "Locked" : saving ? "Saving…" : "Submit register"}
            {!locked && !saving && <Kbd>⌘ ⏎</Kbd>}
          </button>
        </div>
      </div>

      <p className="mt-3 text-xs text-navy-3">
        P present · L late · E excused · M medical · A absent. Add a reason for any non-present
        mark. Absences notify the primary guardian by SMS on submit.
      </p>
    </div>
  );
}

function RequestCorrection({ recordId }: { recordId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AttendanceStatus>("PRESENT");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-navy-3 hover:text-gold"
      >
        Request correction
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
        className="rounded border border-border-2 bg-bg px-1.5 py-1 text-xs"
      >
        {ATTENDANCE_STATUS_ORDER.map((s) => (
          <option key={s} value={s}>
            {ATTENDANCE_STATUS_META[s].label}
          </option>
        ))}
      </select>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="reason"
        className="w-28 rounded border border-border-2 bg-bg px-1.5 py-1 text-xs"
      />
      <button
        disabled={busy || reason.length < 3}
        onClick={async () => {
          setBusy(true);
          await requestCorrection({
            attendanceRecordId: recordId,
            requestedStatus: status,
            reason,
          });
          setBusy(false);
          setOpen(false);
          router.refresh();
        }}
        className="text-xs font-semibold text-gold hover:underline disabled:opacity-50"
      >
        Send
      </button>
      <button onClick={() => setOpen(false)} className="text-xs text-navy-3">
        ×
      </button>
    </span>
  );
}
