"use client";
import { useState } from "react";
import { updateGradingWeights } from "@/lib/actions/settings";

export function WeightsForm({ initialClassWeight }: { initialClassWeight: number }) {
  const [classWeight, setClassWeight] = useState(initialClassWeight);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const examWeight = 100 - classWeight;
  const dirty = classWeight !== initialClassWeight;

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await updateGradingWeights({ classWeight, examWeight });
    setBusy(false);
    setMsg(
      res.ok
        ? { ok: true, text: "Saved." }
        : { ok: false, text: res.error ?? "Could not save." },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-6">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-navy-2">
            Class score (continuous assessment)
          </span>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={classWeight}
              onChange={(e) => setClassWeight(Number(e.target.value))}
              className="w-48 accent-gold"
            />
            <span className="w-12 text-right font-mono text-sm font-semibold text-navy">
              {classWeight}%
            </span>
          </div>
        </label>
        <div className="text-sm text-navy-3">
          Exam (terminal):{" "}
          <span className="font-mono font-semibold text-navy">{examWeight}%</span>
        </div>
      </div>
      <p className="text-xs text-navy-3">
        Most JHS schools use 50 / 50 for BECE alignment. Weights always total 100%.
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save weights"}
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
