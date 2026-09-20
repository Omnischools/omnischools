"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateGradeScale } from "@/lib/actions/settings";
import { GRADE_SCALE_PRESETS } from "@/lib/onboarding";

type Row = { grade: string; label: string; minScore: number };
const inputCls =
  "w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";

export function GradeScaleEditor({ initial }: { initial: Row[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const update = (i: number, k: keyof Row, v: string) => {
    setRows((p) =>
      p.map((r, idx) =>
        idx === i ? { ...r, [k]: k === "minScore" ? Number(v) : v } : r,
      ),
    );
    setMsg(null);
  };
  const add = () => setRows((p) => [...p, { grade: "", label: "", minScore: 0 }]);
  const remove = (i: number) => setRows((p) => p.filter((_, idx) => idx !== i));
  const applyPreset = (key: "BASIC" | "WASSCE") => {
    setRows(GRADE_SCALE_PRESETS[key].map((r) => ({ ...r })));
    setMsg(null);
  };

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await updateGradeScale({ rows });
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: "Saved." });
      router.refresh();
    } else setMsg({ ok: false, text: res.error ?? "Could not save." });
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-navy">Grade scale</h2>
        <div className="flex gap-2 text-[11px]">
          <button
            onClick={() => applyPreset("BASIC")}
            className="font-semibold text-gold hover:underline"
          >
            Use A–F
          </button>
          <span className="text-navy-3">·</span>
          <button
            onClick={() => applyPreset("WASSCE")}
            className="font-semibold text-gold hover:underline"
          >
            Use WASSCE A1–F9
          </button>
        </div>
      </div>
      <p className="mb-4 mt-0.5 text-sm text-navy-3">
        How a final score maps to a grade. A grade applies from its threshold up to the next
        grade; the lowest grade covers everything below.
      </p>

      <div className="space-y-2">
        <div className="grid grid-cols-[80px_1fr_110px_36px] gap-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-navy-3">
          <div>Grade</div>
          <div>Label</div>
          <div>From (score)</div>
          <div />
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[80px_1fr_110px_36px] items-center gap-2">
            <input
              className={`${inputCls} text-center font-mono font-semibold`}
              value={r.grade}
              maxLength={8}
              onChange={(e) => update(i, "grade", e.target.value)}
            />
            <input
              className={inputCls}
              value={r.label}
              placeholder="e.g. Credit"
              onChange={(e) => update(i, "label", e.target.value)}
            />
            <input
              type="number"
              min={0}
              max={100}
              className={`${inputCls} text-right font-mono`}
              value={r.minScore}
              onChange={(e) => update(i, "minScore", e.target.value)}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove ${r.grade || "row"}`}
              className="flex h-8 w-8 items-center justify-center rounded-md text-navy-3 transition-colors hover:bg-terra-bg hover:text-terra"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={add}
        className="mt-3 text-[13px] font-semibold text-gold hover:underline"
      >
        + Add grade
      </button>

      <div className="mt-5 flex items-center gap-3 border-t border-border pt-5">
        <button
          onClick={save}
          disabled={busy || rows.length === 0}
          className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save grade scale"}
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
