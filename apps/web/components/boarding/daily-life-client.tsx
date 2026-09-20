"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Select, fieldClass, labelClass } from "@/components/ui/fields";
import {
  recordDailyInspection,
  recordWeeklyInspection,
  logPrepException,
} from "@/lib/actions/boarding-daily";

type Result = { ok: boolean; error?: string; message?: string };
type CheckState = "OK" | "ISSUE";
type ResultState = "PASS" | "PARTIAL" | "FAIL";

const btn = "rounded-md border px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50";
const btnPlain = `${btn} border-border-2 bg-surface text-navy hover:bg-bg`;
const btnPrimary = `${btn} border-navy bg-navy text-bg`;

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<Result>, onDone: () => void) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else {
        onDone();
        router.refresh();
      }
    });
  };
  return { pending, error, run, setError };
}

/** OK / ISSUE toggle for the three daily checks + weekly areas. */
function CheckToggle({
  value,
  onChange,
}: {
  value: CheckState;
  onChange: (v: CheckState) => void;
}) {
  return (
    <div className="flex gap-1">
      {(["OK", "ISSUE"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded px-2.5 py-1 text-[11px] font-semibold ${
            value === v
              ? v === "OK"
                ? "bg-green text-bg"
                : "bg-terra text-bg"
              : "border border-border-2 bg-surface text-navy-3"
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily per-dorm inspection recorder (build addition — surface shows only the read)
// ---------------------------------------------------------------------------

export function DailyInspectionButton({
  dormId,
  dormName,
  defaultTotal,
  recorded,
}: {
  dormId: string;
  dormName: string;
  defaultTotal: number;
  recorded: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, run } = useAction();
  const [result, setResult] = useState<ResultState>("PASS");
  const [bunksTotal, setBunksTotal] = useState(String(defaultTotal || 0));
  const [bunksClean, setBunksClean] = useState(String(defaultTotal || 0));
  const [checks, setChecks] = useState<{ bunks: CheckState; lockers: CheckState; attire: CheckState }>({
    bunks: "OK",
    lockers: "OK",
    attire: "OK",
  });
  const [flagged, setFlagged] = useState("");
  const [notes, setNotes] = useState("");

  const submit = () => {
    const flaggedBunks = flagged
      .split(/[,\s]+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    run(
      () =>
        recordDailyInspection({
          dormId,
          result,
          bunksClean: parseInt(bunksClean, 10) || 0,
          bunksTotal: parseInt(bunksTotal, 10) || 0,
          checks,
          flaggedBunks: flaggedBunks.length ? flaggedBunks : undefined,
          notes: notes.trim() || undefined,
        }),
      () => setOpen(false),
    );
  };

  return (
    <>
      <button className={`${btnPlain} w-full`} onClick={() => setOpen(true)}>
        {recorded ? "Re-inspect" : "Record inspection"}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Daily inspection · Dorm ${dormName}`}>
        <div className="space-y-3">
          <div>
            <label className={labelClass}>Result</label>
            <div className="flex gap-1.5">
              {(["PASS", "PARTIAL", "FAIL"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setResult(r)}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[12px] font-semibold ${
                    result === r
                      ? r === "PASS"
                        ? "bg-green text-bg"
                        : r === "PARTIAL"
                          ? "bg-warn text-bg"
                          : "bg-terra text-bg"
                      : "border border-border-2 bg-surface text-navy-3"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Bunks clean</label>
              <input
                className={fieldClass}
                inputMode="numeric"
                value={bunksClean}
                onChange={(e) => setBunksClean(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>Bunks total</label>
              <input
                className={fieldClass}
                inputMode="numeric"
                value={bunksTotal}
                onChange={(e) => setBunksTotal(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2 rounded-lg border border-border bg-bg p-3">
            {(["bunks", "lockers", "attire"] as const).map((k) => (
              <div key={k} className="flex items-center justify-between">
                <span className="text-[12px] font-semibold capitalize text-navy-2">{k}</span>
                <CheckToggle value={checks[k]} onChange={(v) => setChecks((c) => ({ ...c, [k]: v }))} />
              </div>
            ))}
          </div>
          <div>
            <label className={labelClass}>Flagged bunks (positions, optional)</label>
            <input
              className={fieldClass}
              placeholder="e.g. 6, 9, 13"
              value={flagged}
              onChange={(e) => setFlagged(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Notes (optional)</label>
            <textarea
              className={fieldClass}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {error && <p className="text-[12px] font-semibold text-terra">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button className={btnPlain} onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </button>
            <button className={btnPrimary} onClick={submit} disabled={pending}>
              {pending ? "Recording…" : "Record"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Weekly whole-house inspection recorder (Saturday-scoped view — a design addition)
// ---------------------------------------------------------------------------

const WEEKLY_AREAS = ["Washrooms", "Drying lines", "Chop-box store", "Bicycle shed"] as const;

export function WeeklyInspectionButton({ houseId, houseName }: { houseId: string; houseName: string }) {
  const [open, setOpen] = useState(false);
  const { pending, error, run } = useAction();
  const [result, setResult] = useState<ResultState>("PASS");
  const [areas, setAreas] = useState<{ area: string; result: CheckState; note: string }[]>(
    WEEKLY_AREAS.map((area) => ({ area, result: "OK", note: "" })),
  );
  const [notes, setNotes] = useState("");

  const submit = () => {
    run(
      () =>
        recordWeeklyInspection({
          houseId,
          result,
          areas: areas.map((a) => ({
            area: a.area,
            result: a.result,
            note: a.note.trim() || undefined,
          })),
          notes: notes.trim() || undefined,
        }),
      () => setOpen(false),
    );
  };

  return (
    <>
      <button className={btnPlain} onClick={() => setOpen(true)}>
        Record weekly inspection
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Weekly inspection · ${houseName} House`}>
        <div className="space-y-3">
          <div>
            <label className={labelClass}>Whole-house result</label>
            <div className="flex gap-1.5">
              {(["PASS", "PARTIAL", "FAIL"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setResult(r)}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[12px] font-semibold ${
                    result === r
                      ? r === "PASS"
                        ? "bg-green text-bg"
                        : r === "PARTIAL"
                          ? "bg-warn text-bg"
                          : "bg-terra text-bg"
                      : "border border-border-2 bg-surface text-navy-3"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2 rounded-lg border border-border bg-bg p-3">
            {areas.map((a, i) => (
              <div key={a.area} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-navy-2">{a.area}</span>
                  <CheckToggle
                    value={a.result}
                    onChange={(v) =>
                      setAreas((prev) => prev.map((p, j) => (j === i ? { ...p, result: v } : p)))
                    }
                  />
                </div>
                <input
                  className={`${fieldClass} py-1 text-[12px]`}
                  placeholder="Note (optional)"
                  value={a.note}
                  onChange={(e) =>
                    setAreas((prev) => prev.map((p, j) => (j === i ? { ...p, note: e.target.value } : p)))
                  }
                />
              </div>
            ))}
          </div>
          <div>
            <label className={labelClass}>Overall notes (optional)</label>
            <textarea
              className={fieldClass}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {error && <p className="text-[12px] font-semibold text-terra">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button className={btnPlain} onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </button>
            <button className={btnPrimary} onClick={submit} disabled={pending}>
              {pending ? "Recording…" : "Record"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Prep exception entry (the late-log — no visible button on the surface; build the entry UI)
// ---------------------------------------------------------------------------

export function PrepExceptionLog({
  houseId,
  dateIso,
  boarders,
}: {
  houseId: string;
  dateIso: string;
  boarders: { id: string; name: string; formLabel: string | null }[];
}) {
  const { pending, error, run } = useAction();
  const [studentId, setStudentId] = useState("");
  const [status, setStatus] = useState<"LATE" | "ABSENT" | "EXCUSED" | "MEDICAL">("LATE");
  const [minutesLate, setMinutesLate] = useState("5");
  const [note, setNote] = useState("");

  const submit = () => {
    if (!studentId) return;
    run(
      () =>
        logPrepException({
          houseId,
          studentId,
          status,
          minutesLate: status === "LATE" ? parseInt(minutesLate, 10) || 0 : undefined,
          note: note.trim() || undefined,
          date: dateIso,
        }),
      () => {
        setStudentId("");
        setNote("");
      },
    );
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-navy-3">
        Log a prep exception
      </div>
      <div className="grid gap-2 sm:grid-cols-[1.6fr_1fr_auto] sm:items-end">
        <div>
          <label className={labelClass}>Boarder</label>
          <Select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Select a boarder…</option>
            {boarders.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.formLabel ? ` · ${b.formLabel}` : ""}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className={labelClass}>Status</label>
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="LATE">Late</option>
            <option value="ABSENT">Absent</option>
            <option value="EXCUSED">Excused</option>
            <option value="MEDICAL">Medical</option>
          </Select>
        </div>
        {status === "LATE" && (
          <div>
            <label className={labelClass}>Min late</label>
            <input
              className={`${fieldClass} w-20`}
              inputMode="numeric"
              value={minutesLate}
              onChange={(e) => setMinutesLate(e.target.value)}
            />
          </div>
        )}
      </div>
      <div className="mt-2 flex items-end gap-2">
        <div className="flex-1">
          <label className={labelClass}>Note (optional)</label>
          <input className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button className={btnPrimary} onClick={submit} disabled={pending || !studentId}>
          {pending ? "Logging…" : "Log exception"}
        </button>
      </div>
      {error && <p className="mt-2 text-[12px] font-semibold text-terra">{error}</p>}
      <p className="mt-2 text-[11px] text-navy-3">
        Present-by-default: a boarder with no exception is present. Only late, absent, excused &amp;
        medical are logged.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Attendance for scrubbing" — STUB (no write, no 3rd table — Kofi OQ4)
// ---------------------------------------------------------------------------

export function ScrubbingAttendanceButton() {
  return (
    <button
      className={`${btnPlain} cursor-not-allowed opacity-60`}
      disabled
      title="Scrubbing attendance ships with a later batch — no data is recorded yet."
    >
      Attendance for scrubbing
    </button>
  );
}
