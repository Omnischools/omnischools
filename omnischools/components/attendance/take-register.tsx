"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { saveAttendance, requestCorrection } from "@/lib/actions/attendance";

type Status = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" | "MEDICAL";
type Row = {
  id: string;
  name: string;
  code: string;
  status: Status | null;
  recordId: string | null;
};

const OPTS: { v: Status; label: string; on: string }[] = [
  { v: "PRESENT", label: "P", on: "bg-green text-white" },
  { v: "ABSENT", label: "A", on: "bg-terra text-white" },
  { v: "LATE", label: "L", on: "bg-warn text-white" },
  { v: "EXCUSED", label: "E", on: "bg-navy-2 text-white" },
  { v: "MEDICAL", label: "M", on: "bg-gold text-navy" },
];

export function TakeRegister({
  classId,
  date,
  roster,
}: {
  classId: string;
  date: string;
  roster: Row[];
}) {
  const router = useRouter();
  const [statuses, setStatuses] = useState<Record<string, Status>>(
    Object.fromEntries(roster.map((r) => [r.id, r.status ?? "PRESENT"])),
  );
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (id: string, v: Status) => setStatuses((s) => ({ ...s, [id]: v }));
  const allPresent = () =>
    setStatuses(Object.fromEntries(roster.map((r) => [r.id, "PRESENT" as Status])));

  async function save() {
    setSaving(true);
    setError(null);
    setResult(null);
    const res = await saveAttendance({
      classId,
      date,
      entries: roster.map((r) => ({ studentId: r.id, status: statuses[r.id] })),
    });
    setSaving(false);
    if (res.ok) {
      setResult(
        `Saved ${res.marked} · ${res.absent} absent · ${res.alertsSent} alert(s) sent`,
      );
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-navy-2">
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => router.push(`/attendance/${classId}?date=${e.target.value}`)}
            className="border-border-2 bg-bg rounded-md border px-3 py-2 text-sm text-navy outline-none focus:border-gold"
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={allPresent}
            className="border-border-2 bg-surface rounded-md border px-3 py-2 text-sm font-semibold text-navy hover:bg-gold-bg"
          >
            Mark all present
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="text-bg rounded-md bg-navy px-5 py-2 text-sm font-semibold transition-colors hover:bg-navy-deep disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save register"}
          </button>
        </div>
      </div>

      {result && (
        <p className="mb-3 rounded-md bg-green-bg px-3 py-2 text-sm text-green">
          {result}
        </p>
      )}
      {error && <p className="mb-3 text-sm text-terra">{error}</p>}

      <div className="bg-surface overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-bg border-b border-border text-left text-xs uppercase tracking-wide text-navy-3">
            <tr>
              <th className="px-4 py-3 font-semibold">Student</th>
              <th className="px-4 py-3 font-semibold">Mark</th>
              <th className="px-4 py-3 font-semibold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {roster.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2.5">
                  <div className="font-medium text-navy">{r.name}</div>
                  <div className="font-mono text-xs text-navy-3">{r.code}</div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-1">
                    {OPTS.map((o) => (
                      <button
                        key={o.v}
                        onClick={() => set(r.id, o.v)}
                        title={o.v}
                        className={cn(
                          "h-8 w-8 rounded-md text-xs font-bold transition-colors",
                          statuses[r.id] === o.v
                            ? o.on
                            : "bg-bg text-navy-3 hover:bg-gold-bg",
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right">
                  {r.recordId && <RequestCorrection recordId={r.recordId} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-navy-3">
        P present · A absent · L late · E excused · M medical. Absences notify the primary
        guardian by SMS on save.
      </p>
    </div>
  );
}

function RequestCorrection({ recordId }: { recordId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("PRESENT");
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
    <div className="flex items-center justify-end gap-1.5">
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value as Status)}
        className="border-border-2 bg-bg rounded border px-1.5 py-1 text-xs"
      >
        {OPTS.map((o) => (
          <option key={o.v} value={o.v}>
            {o.v.charAt(0) + o.v.slice(1).toLowerCase()}
          </option>
        ))}
      </select>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="reason"
        className="border-border-2 bg-bg w-28 rounded border px-1.5 py-1 text-xs"
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
    </div>
  );
}
