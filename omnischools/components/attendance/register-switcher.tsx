"use client";
import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Sparkline segment colours, keyed to the attendance statuses + unmarked. */
const SEG_BG: Record<string, string> = {
  PRESENT: "bg-green",
  LATE: "bg-gold",
  EXCUSED: "bg-warn",
  MEDICAL: "bg-navy-2",
  ABSENT: "bg-terra",
  UNMARKED: "bg-border-2",
};

export type SwitcherSeg = { kind: string; n: number };
export type SwitcherClass = {
  id: string;
  name: string;
  studentCount: number;
  state: "PENDING" | "PARTIAL" | "DONE" | "LOCKED";
  metaLine: string;
  segs: SwitcherSeg[];
};
export type EarlierReg = {
  iso: string;
  dateLabel: string;
  markedAtLabel: string | null;
  segs: SwitcherSeg[];
};

const PILL: Record<SwitcherClass["state"], { label: string; cls: string }> = {
  PENDING: { label: "Pending", cls: "bg-terra-bg text-terra" },
  PARTIAL: { label: "Partial", cls: "bg-warn-bg text-warn" },
  DONE: { label: "Done", cls: "bg-green-bg text-green" },
  LOCKED: { label: "Locked", cls: "border border-border bg-bg text-navy-3" },
};

/** "JHS 2A register" → JHS <em>2A</em> register (italic-gold form token). */
function ClassName({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  const last = parts[parts.length - 1];
  if (parts.length > 1 && /^[A-Za-z]?\d+[A-Za-z]?$/.test(last)) {
    return (
      <>
        {parts.slice(0, -1).join(" ")} <em className="not-italic text-gold">{last}</em>{" "}
        register
      </>
    );
  }
  return <>{name} register</>;
}

function Sparkline({ segs }: { segs: SwitcherSeg[] }) {
  return (
    <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-sm bg-bg">
      {segs.map((s, i) => (
        <div
          key={i}
          className={SEG_BG[s.kind] ?? "bg-border-2"}
          style={{ flexGrow: s.n, flexBasis: 0 }}
        />
      ))}
    </div>
  );
}

export function RegisterSwitcher({
  dateLabel,
  classes,
  earlier,
  activeId,
}: {
  dateLabel: string;
  classes: SwitcherClass[];
  earlier: EarlierReg[];
  activeId: string;
}) {
  const [filter, setFilter] = useState<"all" | "pending" | "done">("all");

  const isPending = (c: SwitcherClass) => c.state === "PENDING" || c.state === "PARTIAL";
  const isDone = (c: SwitcherClass) => c.state === "DONE" || c.state === "LOCKED";
  const pendingN = classes.filter(isPending).length;
  const doneN = classes.filter(isDone).length;
  const total = classes.length;
  const shown =
    filter === "all"
      ? classes
      : filter === "pending"
        ? classes.filter(isPending)
        : classes.filter(isDone);
  const pct = total ? Math.round((doneN / total) * 100) : 0;

  const pills: { key: "all" | "pending" | "done"; label: string; n: number }[] = [
    { key: "all", label: "All", n: total },
    { key: "pending", label: "Pending", n: pendingN },
    { key: "done", label: "Done", n: doneN },
  ];

  return (
    <aside className="hidden w-72 shrink-0 flex-col self-start overflow-hidden rounded-[10px] border border-border bg-surface lg:sticky lg:top-6 lg:flex lg:max-h-[calc(100vh-3rem)]">
      {/* Head */}
      <div className="border-b border-border px-[18px] pb-3.5 pt-[18px]">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold">
            Today&apos;s registers
          </span>
          <span className="font-mono text-[10px] font-semibold text-navy-3">{dateLabel}</span>
        </div>
        <h2 className="font-display text-xl font-semibold text-navy">
          My <em className="text-gold">classes</em> today
        </h2>
      </div>

      {/* Progress strip */}
      <div className="border-b border-gold-soft bg-gold-bg px-[18px] py-3">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="font-display text-base font-semibold text-navy">
            {doneN} of <em className="not-italic text-gold">{total}</em> done
          </span>
          <span className="text-[11px] text-navy-3">{total - doneN} left to mark</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-pill bg-white/70">
          <div className="h-full rounded-pill bg-gold" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex gap-1 border-b border-border px-3.5 py-2.5">
        {pills.map((p) => {
          const active = filter === p.key;
          return (
            <button
              key={p.key}
              onClick={() => setFilter(p.key)}
              className={cn(
                "rounded-pill px-2.5 py-1.5 text-[11px] font-semibold",
                active
                  ? "border border-border bg-bg text-navy"
                  : "border border-transparent text-navy-3 hover:text-navy",
              )}
            >
              {p.label}
              <span
                className={cn(
                  "ml-1 rounded-pill px-1.5 py-px text-[9px] font-bold",
                  active ? "bg-gold text-navy" : "bg-bg text-navy-3",
                )}
              >
                {p.n}
              </span>
            </button>
          );
        })}
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {shown.map((c) => {
          const active = c.id === activeId;
          const pill = PILL[c.state];
          return (
            <Link
              key={c.id}
              href={`/attendance/${c.id}`}
              className={cn(
                "grid grid-cols-[1fr_auto] gap-2 border-b border-border px-[18px] py-3.5 hover:bg-bg",
                active && "border-l-[3px] border-l-gold bg-gold-bg pl-[15px]",
              )}
            >
              <div className="min-w-0">
                <div className="mb-1 flex items-baseline gap-2">
                  <span className="font-display text-sm font-semibold text-navy">
                    <ClassName name={c.name} />
                  </span>
                  <span className="font-mono text-[10px] font-semibold text-navy-3">
                    {c.studentCount}
                  </span>
                </div>
                <div className="text-[11px] text-navy-3">{c.metaLine}</div>
                <Sparkline segs={c.segs} />
              </div>
              <span
                className={cn(
                  "self-center rounded-pill px-2 py-[3px] text-[9px] font-bold uppercase tracking-[0.06em]",
                  pill.cls,
                )}
              >
                {pill.label}
              </span>
            </Link>
          );
        })}

        {earlier.length > 0 && (
          <>
            <div className="border-t-[6px] border-bg bg-bg px-[18px] pb-1.5 pt-3.5 text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
              Earlier this week
            </div>
            {earlier.map((e) => (
              <Link
                key={e.iso}
                href={`/attendance/${activeId}?date=${e.iso}`}
                className="grid grid-cols-[1fr_auto] gap-2 border-b border-border px-[18px] py-3.5 hover:bg-bg"
              >
                <div className="min-w-0">
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="font-display text-sm font-semibold text-navy">
                      <ClassName name={classes.find((c) => c.id === activeId)?.name ?? ""} />
                    </span>
                  </div>
                  <div className="text-[11px] text-navy-3">
                    {e.dateLabel}
                    {e.markedAtLabel ? (
                      <>
                        {" · marked "}
                        <b className="font-semibold text-navy-2">{e.markedAtLabel}</b>
                      </>
                    ) : null}
                  </div>
                  <Sparkline segs={e.segs} />
                </div>
                <span className="self-center rounded-pill border border-border bg-bg px-2 py-[3px] text-[9px] font-bold uppercase tracking-[0.06em] text-navy-3">
                  Locked
                </span>
              </Link>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
