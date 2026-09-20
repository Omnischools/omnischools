"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveTerminalResult } from "@/lib/actions/terminal-results";
import type { ExamType } from "@/lib/reports/terminal-results-data";
import { MIN_SITTING_YEAR, maxSittingYear } from "@/lib/import/terminal-results-import";

/**
 * GOV-6 · manual capture of ONE terminal-exam sitting. Upserts on (exam_type, year), so re-entering an
 * exam/year corrects it. The four sex-split leaf counts only — total / pass rate are computed on read,
 * never entered (R364). exam_type is limited to what the school's tier sits (R367).
 */
export function TerminalResultsForm({ offeredExamTypes }: { offeredExamTypes: ExamType[] }) {
  const router = useRouter();
  const yearMax = maxSittingYear();
  const [examType, setExamType] = useState<ExamType>(offeredExamTypes[0] ?? "BECE");
  const [year, setYear] = useState<string>(String(yearMax - 1));
  const [femaleCandidates, setFemaleCandidates] = useState("");
  const [maleCandidates, setMaleCandidates] = useState("");
  const [femalePassed, setFemalePassed] = useState("");
  const [malePassed, setMalePassed] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const numField = (
    label: string,
    value: string,
    set: (v: string) => void,
  ) => (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-navy-3">{label}</span>
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={value}
        onChange={(e) => set(e.target.value)}
        className="mt-1 w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-sm text-navy focus:border-gold focus:outline-none"
      />
    </label>
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await saveTerminalResult({
      examType,
      year: Number(year),
      femaleCandidates: Number(femaleCandidates || 0),
      maleCandidates: Number(maleCandidates || 0),
      femalePassed: Number(femalePassed || 0),
      malePassed: Number(malePassed || 0),
      note,
    });
    setBusy(false);
    if (res.ok) {
      setDone(`Saved ${examType} ${year}.`);
      setFemaleCandidates("");
      setMaleCandidates("");
      setFemalePassed("");
      setMalePassed("");
      setNote("");
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-border bg-surface p-5">
      <div>
        <h2 className="font-display text-lg font-semibold text-navy">Capture a sitting</h2>
        <p className="text-sm text-navy-3">
          Enter the school-level candidate and pass counts, split by sex. Re-entering an exam and year
          updates it. The total and pass rate are worked out for you.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-navy-3">Exam</span>
          <select
            value={examType}
            onChange={(e) => setExamType(e.target.value as ExamType)}
            className="mt-1 w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-sm text-navy focus:border-gold focus:outline-none"
          >
            {offeredExamTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-navy-3">
            Sitting year
          </span>
          <input
            type="number"
            min={MIN_SITTING_YEAR}
            max={yearMax}
            inputMode="numeric"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="mt-1 w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-sm text-navy focus:border-gold focus:outline-none"
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {numField("Female candidates", femaleCandidates, setFemaleCandidates)}
        {numField("Male candidates", maleCandidates, setMaleCandidates)}
        {numField("Female passed", femalePassed, setFemalePassed)}
        {numField("Male passed", malePassed, setMalePassed)}
      </div>

      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wide text-navy-3">
          Note (optional)
        </span>
        <input
          type="text"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Main sitting"
          className="mt-1 w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-sm text-navy focus:border-gold focus:outline-none"
        />
      </label>

      {done && (
        <p className="rounded-md bg-green-bg px-4 py-3 text-sm font-medium text-green">{done}</p>
      )}
      {error && <p className="text-sm text-terra">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save sitting"}
      </button>
    </form>
  );
}
