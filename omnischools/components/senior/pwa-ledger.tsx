"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  saveDirectLedgerScores,
  savePortfolioScores,
  logClassSwitch,
} from "@/lib/actions/score-ledger";
import { provisionalTotal, type CategoryWeights } from "@/lib/score-ledger/compute";
import type { LedgerRow } from "@/components/senior/senior-ledger-grid";
import {
  PWA_CATS,
  type PwaCat,
  cellId,
  emptyBuffer,
  bufferEdit,
  bufferSetOnline,
  cellStatus,
  cellHeld,
  hasPending,
  heldCount,
  stripTone,
  heldStripText,
  heldBadgeText,
  type PendingBuffer,
} from "@/lib/score-ledger/pwa-buffer";
import { flushPending, type FlushLatch } from "@/lib/score-ledger/pwa-flush";
import {
  readViewPref,
  writeViewPref,
  type LedgerView,
} from "@/lib/score-ledger/view-pref";
import {
  chevronSuppressed,
  classCountLabel,
  switcherPill,
  type SwitcherPill,
} from "@/lib/score-ledger/pwa-switcher";

/** One of the teacher's classes for this subject × semester — a full switchable ledger. */
export type PwaClass = {
  classId: string;
  className: string;
  subjectName: string;
  studentCount: number;
  path: "AUTO_COMPILE" | "SCAN_EXTRACT" | "DIRECT_ENTRY";
  /** computeVhmTier n/5 — categories every student in the class has entered. */
  categoriesDone: number;
  rows: LedgerRow[];
  weights: CategoryWeights;
};

type Props = {
  classes: PwaClass[];
  activeClassId: string;
  subjectId: string;
  periodId: string;
  teacherId: string;
  teacherName: string;
  semesterMeta: string; // "Semester 2 · 2025/26"
};

// Card uses the fuller labels; Grid uses the tight 3-letter header (surface §1.2 / §1.3).
const CARD_LABEL: Record<PwaCat, string> = {
  asgn: "Assignments",
  midSem: "Mid-sem exam",
  endSem: "End-of-sem",
  project: "Project work",
  portfolio: "Portfolio",
};
const GRID_LABEL: Record<PwaCat, string> = {
  asgn: "Asg",
  midSem: "Mid",
  endSem: "End",
  project: "Pro",
  portfolio: "Por",
};

const editableFor = (path: PwaClass["path"]): Set<PwaCat> =>
  path === "DIRECT_ENTRY"
    ? new Set(PWA_CATS)
    : new Set<PwaCat>(["portfolio"]); // Path A/B: four auto-compiled, portfolio manual

function initials(name: string): string {
  const parts = name.replace(/^(mr|mrs|ms|dr|rev)\.?\s+/i, "").trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

function relTime(then: number, now: number): string {
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
}

const PILL_CLS: Record<SwitcherPill, string> = {
  current: "bg-gold text-navy",
  ready: "bg-green-bg text-green",
  behind: "bg-warn-bg text-warn",
};

export function PwaLedger(props: Props) {
  const { classes, subjectId, periodId, teacherId, teacherName, semesterMeta } = props;

  const [activeClassId, setActiveClassId] = useState(props.activeClassId);
  const active = classes.find((c) => c.classId === activeClassId) ?? classes[0];

  // View preference (Q5) — Card by default; read the persisted choice after mount (SSR-safe).
  const [view, setView] = useState<LedgerView>("card");
  useEffect(() => {
    setView(
      readViewPref({ teacherId, subjectId, classId: active.classId, periodId }),
    );
  }, [teacherId, subjectId, periodId, active.classId]);
  const chooseView = (v: LedgerView) => {
    setView(v);
    writeViewPref({ teacherId, subjectId, classId: active.classId, periodId }, v);
  };

  // One cells map across ALL the teacher's classes (ids are globally unique), so a class switch
  // is a pure state change — no remount, no lost buffer (S6). Init from every class's editable
  // cats respecting its path.
  const [cells, setCells] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const c of classes) {
      const ed = editableFor(c.path);
      for (const r of c.rows) {
        for (const cat of PWA_CATS) {
          if (!ed.has(cat)) continue;
          const v = r[cat];
          m[cellId(r.id, cat)] = v == null ? "" : String(v);
        }
      }
    }
    return m;
  });

  const [buffer, setBuffer] = useState<PendingBuffer>(() => emptyBuffer(true));
  const [now, setNow] = useState(() => Date.now());
  const [sheetOpen, setSheetOpen] = useState(false);

  // Lookups the flush needs, kept in refs so the online/offline listeners never read stale state.
  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  const bufferRef = useRef(buffer);
  bufferRef.current = buffer;
  // Re-entrancy latch (inFlight + rerun) — a mid-flush edit drains again so nothing sticks pending.
  const latch = useRef<FlushLatch>({ inFlight: false, rerun: false });
  const flushTimer = useRef<ReturnType<typeof setTimeout>>();

  const classOfStudent = useMemo(() => {
    const m = new Map<string, PwaClass>();
    for (const c of classes) for (const r of c.rows) m.set(r.id, c);
    return m;
  }, [classes]);

  const num = (sid: string, cat: PwaCat, cls: PwaClass): number | null => {
    if (editableFor(cls.path).has(cat)) {
      const raw = cellsRef.current[cellId(sid, cat)];
      if (raw == null || raw.trim() === "") return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    const row = cls.rows.find((r) => r.id === sid);
    return row ? row[cat] : null;
  };

  const flush = useCallback(
    () =>
      flushPending({
        latch: latch.current,
        getBuffer: () => bufferRef.current,
        setBuffer,
        getCell: (sid, cat) => cellsRef.current[cellId(sid, cat)] ?? "",
        classOf: (sid) => classOfStudent.get(sid),
        isOnline: () => typeof navigator === "undefined" || navigator.onLine,
        saveDirect: saveDirectLedgerScores,
        savePortfolio: savePortfolioScores,
        subjectId,
        periodId,
        now: Date.now,
      }),
    [classOfStudent, subjectId, periodId],
  );

  const scheduleFlush = useCallback(() => {
    clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => void flush(), 700);
  }, [flush]);

  // Connectivity: reflect the true state at mount, then track events and auto-flush on reconnect.
  useEffect(() => {
    if (typeof navigator !== "undefined")
      setBuffer((s) => bufferSetOnline(s, navigator.onLine));
    const onOnline = () => {
      setBuffer((s) => bufferSetOnline(s, true));
      void flush();
    };
    const onOffline = () => setBuffer((s) => bufferSetOnline(s, false));
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [flush]);

  // Warn before a hard reload/close while scores are still held (B5) — the in-memory buffer does
  // NOT survive a reload; on reload cells fall back to the last server-confirmed value.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (hasPending(bufferRef.current)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  // Tick so the green strip's "last N ago" stays fresh.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  function setCell(sid: string, cat: PwaCat, value: string) {
    setCells((c) => ({ ...c, [cellId(sid, cat)]: value }));
    setBuffer((s) => bufferEdit(s, cellId(sid, cat), value));
    scheduleFlush();
  }

  function switchClass(cid: string) {
    setSheetOpen(false);
    if (cid === activeClassId) return;
    setActiveClassId(cid); // view re-reads its per-class pref via the effect below
    try {
      window.localStorage.setItem(`omnischools:ledger-last-class:${teacherId}:${subjectId}`, cid);
    } catch {
      /* best-effort */
    }
    void logClassSwitch({ classId: cid, subjectId, periodId }); // audit the switch (S5)
  }

  const tone = stripTone(buffer);
  const heldN = heldCount(buffer);
  const multiClass = !chevronSuppressed(classes.length);
  const activeIndex = classes.findIndex((c) => c.classId === active.classId);

  return (
    <div className="mx-auto max-w-[420px] overflow-hidden rounded-[18px] border border-border bg-surface shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between bg-navy px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-gold font-display text-[13px] font-semibold italic text-navy">
            O
          </div>
          <div className="font-display text-[14px] font-semibold italic text-bg">Omnischools</div>
        </div>
        <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-gold text-[11px] font-bold text-navy">
          {initials(teacherName)}
        </div>
      </div>

      {/* Context + chevron switcher */}
      <button
        type="button"
        disabled={!multiClass}
        onClick={() => multiClass && setSheetOpen(true)}
        className="block w-full border-b border-border px-4 py-3 text-left disabled:cursor-default"
      >
        <div className="font-display text-[18px] font-semibold text-navy">
          {active.className} · <em className="italic text-gold">{active.subjectName}</em>
          {multiClass && (
            <>
              {" "}
              <span className="font-mono text-[14px] text-gold">▾</span>
              <span className="ml-1.5 inline-block rounded-full bg-gold-bg px-[7px] py-[2px] align-middle text-[9px] font-bold uppercase tracking-[0.04em] text-navy">
                {classCountLabel(activeIndex, classes.length)}
              </span>
            </>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-navy-3">
          {semesterMeta} · {active.studentCount} students
        </div>
      </button>

      {/* Sync strip — always visible (H5). Solid tints (§0 trap). */}
      <div
        className={`flex items-center gap-2 px-4 py-2 text-[11px] font-semibold ${
          tone === "gold" ? "bg-gold-bg text-gold" : "bg-green-bg text-green"
        }`}
      >
        <span
          className={`h-[7px] w-[7px] rounded-full ${tone === "gold" ? "bg-gold" : "bg-green"}`}
        />
        <span>
          {tone === "gold"
            ? heldStripText(heldN)
            : buffer.lastSyncedAt
              ? `All scores synced · last ${relTime(buffer.lastSyncedAt, now)}`
              : "All scores synced"}
        </span>
      </div>

      {/* Domain-error banner (B6) — a rejected save is surfaced, never parked as pending. */}
      {buffer.lastError && (
        <div className="mx-4 mt-3 rounded-[7px] border border-terra bg-terra-bg px-3 py-2 text-[11.5px] text-terra">
          {buffer.lastError}
        </div>
      )}

      {/* View toggle */}
      <div className="mx-4 mt-3 flex rounded-md border border-border bg-bg p-[3px]">
        {(["card", "grid"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => chooseView(v)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-sm py-1.5 text-[11px] font-semibold tracking-[0.04em] ${
              view === v ? "bg-navy text-bg" : "text-navy-3"
            }`}
          >
            <span className="font-display italic">{v === "card" ? "▤" : "▦"}</span>
            {v === "card" ? "Card" : "Grid"}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="max-h-[62vh] overflow-y-auto px-4 py-3">
        {view === "card"
          ? renderCards()
          : renderGrid()}
      </div>

      {/* Bottom bar (§6) — real primary-nav destinations. */}
      <div className="grid grid-cols-4 border-t border-border bg-surface">
        {[
          { label: "Today", icon: "T", href: "/dashboard", active: false },
          { label: "Classes", icon: "C", href: "/classes", active: false },
          { label: "Ledger", icon: "L", href: "/senior/score-ledger", active: true },
          { label: "More", icon: "M", href: "/settings", active: false },
        ].map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className={`flex flex-col items-center gap-1 py-2 text-[9.5px] font-semibold ${
              t.active ? "text-gold" : "text-navy-3"
            }`}
          >
            <span
              className={`flex h-[22px] w-[22px] items-center justify-center rounded-sm font-display text-[11px] italic ${
                t.active ? "bg-gold text-navy" : "bg-bg text-navy"
              }`}
            >
              {t.icon}
            </span>
            {t.label}
          </Link>
        ))}
      </div>

      {/* Class-switcher bottom sheet + dim overlay (§2) */}
      {sheetOpen && (
        <>
          <div
            role="button"
            tabIndex={-1}
            aria-label="Dismiss"
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0 z-[5] bg-[rgba(26,43,71,0.45)]"
          />
          <div className="absolute inset-x-0 bottom-0 z-10 max-h-[78%] overflow-y-auto rounded-t-[18px] bg-surface p-4 shadow-lg">
            <div className="mx-auto mb-3 h-1 w-[38px] rounded-sm bg-border-2" />
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">
              Switch class · {teacherName} · {semesterMeta.split(" · ")[0]}
            </div>
            <div className="space-y-2">
              {classes.map((c) => {
                const isCurrent = c.classId === active.classId;
                const pill = switcherPill(isCurrent, c.categoriesDone);
                const pathLabel =
                  c.path === "DIRECT_ENTRY" ? "Path C" : c.path === "SCAN_EXTRACT" ? "Path B" : "Path A";
                const portfolioDone = c.rows.length > 0 && c.rows.every((r) => r.portfolio != null);
                return (
                  <button
                    key={c.classId}
                    type="button"
                    onClick={() => switchClass(c.classId)}
                    className={`flex w-full items-center gap-2.5 rounded-[10px] border p-3 text-left ${
                      isCurrent ? "border-gold bg-gold-bg" : "border-border bg-bg"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-[13px] font-semibold text-navy">
                        {c.className} · <em className="italic text-gold">{c.subjectName}</em>
                      </div>
                      <div className="mt-0.5 text-[9.5px] text-navy-3">
                        {c.studentCount} students · {pathLabel} · {c.categoriesDone} of 5 categories ·
                        portfolio {portfolioDone ? "complete" : "pending"}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-[9px] py-1 text-[9px] font-bold uppercase tracking-[0.06em] ${PILL_CLS[pill]}`}
                    >
                      {pill}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );

  // ---- renderers (closures over cells/buffer) ---------------------------------------------

  function inputClass(sid: string, cat: PwaCat): string {
    const id = cellId(sid, cat);
    const raw = cells[id] ?? "";
    const base =
      "w-full rounded-[7px] border-[1.5px] py-2 px-2.5 text-center font-mono text-[13px] font-bold outline-none";
    // The load-bearing "not saved yet" tint — solid bg-gold-bg (§0 trap). Held = a score kept
    // across a connection drop, gold until the server confirms it.
    if (cellHeld(buffer, id)) return `${base} border-gold bg-gold-bg text-navy`;
    if (cellStatus(buffer, id) === "errored") return `${base} border-terra bg-terra-bg text-terra`;
    if (raw.trim() === "") return `${base} border-border-2 bg-surface text-border-2 focus:border-gold focus:bg-gold-bg`;
    return `${base} border-border-2 bg-surface text-navy focus:border-gold focus:bg-gold-bg`;
  }

  function renderCards() {
    const ed = editableFor(active.path);
    return (
      <div className="space-y-3">
        <p className="text-[10.5px] text-navy-3">
          Card view · one student at a time · swipe between students within the class.
        </p>
        {active.rows.map((r, i) => {
          const vals = Object.fromEntries(
            PWA_CATS.map((cat) => [cat, num(r.id, cat, active)]),
          ) as Record<PwaCat, number | null>;
          const present = Object.values(vals).filter((v) => v != null).length;
          const { total } = provisionalTotal(vals, active.weights);
          const provisional = present > 0 && present < 5;
          const cardHeld = PWA_CATS.filter((cat) => cellHeld(buffer, cellId(r.id, cat))).length;
          return (
            <div key={r.id} className="rounded-[10px] border border-border bg-surface p-3.5">
              <div className="text-[14px] font-bold text-navy">{r.name}</div>
              <div className="font-mono text-[9.5px] tracking-[0.04em] text-navy-3">
                {r.code} · {i + 1} of {active.rows.length}
              </div>
              <div className="mt-3 space-y-2.5">
                {PWA_CATS.map((cat) => (
                  <div key={cat} className="grid grid-cols-[1fr_78px] items-center gap-2">
                    <div className="text-[11.5px] text-navy-2">
                      {CARD_LABEL[cat]}{" "}
                      <span className="font-mono text-[9.5px] text-navy-3">
                        {active.weights[cat]}%
                      </span>
                    </div>
                    {ed.has(cat) ? (
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        max="100"
                        step="0.01"
                        placeholder="—"
                        value={cells[cellId(r.id, cat)] ?? ""}
                        onChange={(e) => setCell(r.id, cat, e.target.value)}
                        className={inputClass(r.id, cat)}
                      />
                    ) : (
                      <div className="rounded-[7px] border-[1.5px] border-border-2 bg-bg py-2 px-2.5 text-center font-mono text-[13px] text-navy-2">
                        {vals[cat] == null ? (
                          <span className="text-border-2">—</span>
                        ) : (
                          vals[cat]!.toFixed(1)
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.04em] text-navy-3">
                  Weighted total
                </div>
                <div className="font-display text-[22px] font-semibold text-navy">
                  {present === 0 ? (
                    <span className="text-border-2">—</span>
                  ) : (
                    <em className="not-italic">{total.toFixed(1)}</em>
                  )}
                  {provisional && (
                    <span className="ml-1.5 text-[11px] font-normal text-navy-3">+ portfolio</span>
                  )}
                </div>
              </div>
              {cardHeld > 0 && (
                <div className="mt-2.5 flex items-center gap-2 rounded-[7px] bg-gold-bg px-3 py-2 text-[10.5px] text-navy-2">
                  <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-gold" />
                  <span>{heldBadgeText(cardHeld)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  function renderGrid() {
    const ed = editableFor(active.path);
    return (
      <div>
        <p className="mb-2 text-[10.5px] text-navy-3">
          Grid view · whole class at a glance · scroll for more rows, tap any cell to edit.
        </p>
        <div className="overflow-x-auto rounded-[10px] border border-border">
          <table className="w-full border-collapse text-center">
            <thead>
              <tr className="bg-navy text-[9px] font-bold uppercase text-bg">
                <th className="sticky left-0 z-10 bg-navy px-2 py-2 text-left">Student</th>
                {PWA_CATS.map((cat) => (
                  <th key={cat} className="px-1.5 py-2">
                    {GRID_LABEL[cat]}
                    <span className="ml-0.5 block font-mono text-[8px] opacity-80">
                      {active.weights[cat]}
                    </span>
                  </th>
                ))}
                <th className="bg-gold px-1.5 py-2 text-navy">
                  Wt<span className="block font-mono text-[8px]">total</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {active.rows.map((r) => {
                const vals = Object.fromEntries(
                  PWA_CATS.map((cat) => [cat, num(r.id, cat, active)]),
                ) as Record<PwaCat, number | null>;
                const present = Object.values(vals).filter((v) => v != null).length;
                const { total } = provisionalTotal(vals, active.weights);
                return (
                  <tr key={r.id}>
                    <td className="sticky left-0 z-10 bg-surface px-2 py-1.5 text-left">
                      <div className="text-[11px] font-semibold text-navy">{r.name}</div>
                      <div className="font-mono text-[8.5px] text-navy-3">{r.code.slice(-4)}</div>
                    </td>
                    {PWA_CATS.map((cat) => {
                      const id = cellId(r.id, cat);
                      const held = cellHeld(buffer, id);
                      const errored = cellStatus(buffer, id) === "errored";
                      if (ed.has(cat)) {
                        return (
                          <td key={cat} className="px-0.5 py-1">
                            <input
                              type="number"
                              inputMode="numeric"
                              min="0"
                              max="100"
                              step="0.01"
                              placeholder="—"
                              value={cells[id] ?? ""}
                              onChange={(e) => setCell(r.id, cat, e.target.value)}
                              className={`w-11 rounded border py-1 text-center font-mono text-[12px] outline-none ${
                                held
                                  ? "border-gold bg-gold-bg font-semibold text-navy"
                                  : errored
                                    ? "border-terra bg-terra-bg text-terra"
                                    : "border-transparent bg-transparent text-navy-2 focus:border-gold focus:bg-gold-bg"
                              }`}
                            />
                          </td>
                        );
                      }
                      return (
                        <td key={cat} className="px-1 py-1.5 font-mono text-[12px] text-navy-2">
                          {vals[cat] == null ? (
                            <span className="text-navy-3 opacity-50">—</span>
                          ) : (
                            vals[cat]!.toFixed(0)
                          )}
                        </td>
                      );
                    })}
                    <td className="bg-gold-bg px-1 py-1.5 font-display text-[14px] font-semibold italic text-gold">
                      {present === 0 ? "—" : total.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between bg-bg px-3 py-2">
            <div className="text-[10px] font-semibold text-navy-3">
              {active.rows.length} of {active.studentCount} · scroll for more
            </div>
            <div className="font-display text-[10px] italic text-navy-3">tap any cell to edit</div>
          </div>
        </div>
      </div>
    );
  }
}
