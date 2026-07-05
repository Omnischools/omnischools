"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setLedgerPath } from "@/lib/actions/score-ledger";

export type CapturePath = "AUTO_COMPILE" | "SCAN_EXTRACT" | "DIRECT_ENTRY";

/**
 * The three capture paths (spec §4). Peers, not a progression — the branded paper ledger
 * is a feature, not a transitional artifact (§4.4). Path B (scan/OCR) is Item 4, so it
 * renders inactive; A (auto-compile) and C (direct entry) are selectable per context.
 */
const PATHS: {
  path: CapturePath;
  letter: string;
  name: string;
  desc: string;
  available: boolean;
}[] = [
  {
    path: "AUTO_COMPILE",
    letter: "A",
    name: "Auto-compile",
    desc: "From the assignments, exams and projects I've recorded through the semester. Portfolio entered at semester end.",
    available: true,
  },
  {
    path: "SCAN_EXTRACT",
    letter: "B",
    name: "Scan my paper ledger",
    desc: "I keep a paper book; photograph it and Omnischools extracts the scores. I verify cell-by-cell.",
    available: false,
  },
  {
    path: "DIRECT_ENTRY",
    letter: "C",
    name: "Type directly",
    desc: "Skip individual assignment tracking; enter category scores onto the ledger grid as I go.",
    available: true,
  },
];

export function PathChooser({
  activePath,
  context,
}: {
  activePath: CapturePath;
  /** Present only when a class·subject·period is selected — the path is per-context. */
  context: { classId: string; subjectId: string; periodId: string } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<CapturePath | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(p: CapturePath) {
    if (!context || p === activePath || busy) return;
    setBusy(p);
    setError(null);
    const res = await setLedgerPath({ ...context, path: p });
    setBusy(null);
    if (res.ok) router.refresh();
    else setError(res.error);
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        {PATHS.map((p) => {
          const active = context ? p.path === activePath : p.path === "AUTO_COMPILE";
          const clickable = !!context && p.available && !active;
          return (
            <button
              key={p.letter}
              type="button"
              onClick={() => choose(p.path)}
              disabled={!clickable}
              aria-pressed={active}
              className={
                "relative rounded-xl border p-4 text-left transition-colors " +
                (active
                  ? "border-gold bg-gold-bg"
                  : p.available
                    ? "border-border-2 bg-surface hover:border-gold-soft"
                    : "border-border-2 bg-surface opacity-80") +
                (clickable ? " cursor-pointer" : " cursor-default")
              }
            >
              {active && (
                <span className="absolute right-3 top-3 text-[9px] font-semibold uppercase tracking-wide text-gold">
                  Active
                </span>
              )}
              <div className="font-display text-[22px] italic text-gold">{p.letter}</div>
              <div className="mt-1 text-sm font-semibold text-navy">{p.name}</div>
              <p className="mt-1 text-xs leading-relaxed text-navy-3">{p.desc}</p>
              <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-navy-3">
                {!p.available
                  ? "Coming soon"
                  : busy === p.path
                    ? "Switching…"
                    : active
                      ? ""
                      : context
                        ? "Tap to use this path"
                        : ""}
              </div>
            </button>
          );
        })}
      </div>
      {error && <p className="mt-2 text-sm text-terra">{error}</p>}
    </div>
  );
}
