"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateAcademicPeriods } from "@/lib/actions/settings";

type Period = { periodId?: string; label: string; startsOn: string; endsOn: string };
const inputCls =
  "w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";

export function TermDatesForm({
  initial,
  academicYear,
}: {
  initial: Period[];
  academicYear: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Period[]>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
  const update = (i: number, k: keyof Period, v: string) => {
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
    setMsg(null);
  };
  const addTerm = () => {
    setRows((p) => [
      ...p,
      { label: `Term ${p.length + 1}`, startsOn: "", endsOn: "" },
    ]);
    setMsg(null);
  };
  const removeNew = (i: number) => setRows((p) => p.filter((_, idx) => idx !== i));

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await updateAcademicPeriods({ academicYear, periods: rows });
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: "Saved." });
      router.refresh();
    } else setMsg({ ok: false, text: res.error ?? "Could not save." });
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-navy">School year &amp; terms</h2>
        <span className="font-mono text-xs text-navy-3">{academicYear}</span>
      </div>
      <p className="mb-4 mt-0.5 text-sm text-navy-3">
        Term boundaries for the current year. These drive attendance weeks, report cards and
        fee cycles.
      </p>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-2 bg-bg px-4 py-5 text-sm text-navy-3">
          No terms set up yet. Add your terms below — most Basic/JHS schools run 3, SHS runs
          2 semesters.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div
              key={r.periodId ?? `new-${i}`}
              className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
            >
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-navy-3">
                  Term
                </label>
                <input
                  className={inputCls}
                  value={r.label}
                  onChange={(e) => update(i, "label", e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-navy-3">
                  Starts
                </label>
                <input
                  type="date"
                  className={inputCls}
                  value={r.startsOn}
                  onChange={(e) => update(i, "startsOn", e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-navy-3">
                  Ends
                </label>
                <input
                  type="date"
                  className={inputCls}
                  value={r.endsOn}
                  onChange={(e) => update(i, "endsOn", e.target.value)}
                />
              </div>
              <div className="flex items-end">
                {!r.periodId && (
                  <button
                    type="button"
                    onClick={() => removeNew(i)}
                    aria-label="Remove term"
                    className="flex h-9 w-9 items-center justify-center rounded-md text-navy-3 transition-colors hover:bg-terra-bg hover:text-terra"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={addTerm}
        disabled={rows.length >= 8}
        className="mt-3 text-[13px] font-semibold text-gold hover:underline disabled:opacity-50"
      >
        + Add term
      </button>

      <div className="mt-5 flex items-center gap-3 border-t border-border pt-5">
        <button
          onClick={save}
          disabled={busy || !dirty || rows.length === 0}
          className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save term dates"}
        </button>
        {msg && (
          <span className={`text-sm ${msg.ok ? "text-green" : "text-terra"}`}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
