"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createGradebookColumn } from "@/lib/actions/gradebook";

/** Inline "add an assessment column" form, shared by the empty state and the grid. */
export function AddColumnForm({
  classId,
  subjectId,
  periodId,
  onCancel,
  onDone,
}: {
  classId: string;
  subjectId: string;
  periodId: string;
  onCancel?: () => void;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"CA" | "EXAM">("CA");
  const [maxScore, setMaxScore] = useState("10");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    const res = await createGradebookColumn({
      classId,
      subjectId,
      periodId,
      name,
      category,
      maxScore,
    });
    setPending(false);
    if (res.ok) {
      onDone?.();
      router.refresh();
    } else setError(res.error);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Column name (e.g. Quiz 1)"
          className="min-w-[12rem] flex-1 rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as "CA" | "EXAM")}
          className="rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        >
          <option value="CA">Continuous Assessment</option>
          <option value="EXAM">Term Exam</option>
        </select>
        <input
          type="number"
          min="1"
          step="0.01"
          value={maxScore}
          onChange={(e) => setMaxScore(e.target.value)}
          placeholder="Max"
          className="w-20 rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
        <button
          onClick={submit}
          disabled={pending}
          className="rounded-md border border-gold bg-gold px-3.5 py-2 text-sm font-semibold text-navy hover:bg-gold-soft disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add"}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={pending}
            className="rounded-md px-3 py-2 text-sm font-semibold text-navy-3 hover:text-navy disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>
      {error && <p className="text-sm text-terra">{error}</p>}
    </div>
  );
}
