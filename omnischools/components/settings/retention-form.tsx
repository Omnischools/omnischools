"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateRetentionPolicy } from "@/lib/actions/settings";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1.5 block text-xs font-semibold text-navy-2";

const MONTHS = [
  { v: "", l: "Keep indefinitely" },
  { v: "12", l: "1 year" },
  { v: "24", l: "2 years" },
  { v: "36", l: "3 years" },
  { v: "60", l: "5 years" },
  { v: "120", l: "10 years" },
];

export function RetentionForm({
  initial,
}: {
  initial: { recordRetentionMonths: number | null; auditRetentionMonths: number | null };
}) {
  const router = useRouter();
  const [record, setRecord] = useState(
    initial.recordRetentionMonths != null ? String(initial.recordRetentionMonths) : "",
  );
  const [audit, setAudit] = useState(
    initial.auditRetentionMonths != null ? String(initial.auditRetentionMonths) : "",
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty =
    record !== (initial.recordRetentionMonths != null ? String(initial.recordRetentionMonths) : "") ||
    audit !== (initial.auditRetentionMonths != null ? String(initial.auditRetentionMonths) : "");

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await updateRetentionPolicy({
      recordRetentionMonths: record === "" ? undefined : Number(record),
      auditRetentionMonths: audit === "" ? undefined : Number(audit),
    });
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: "Saved." });
      router.refresh();
    } else setMsg({ ok: false, text: res.error ?? "Could not save." });
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Student &amp; staff records</label>
          <select className={fieldClass} value={record} onChange={(e) => setRecord(e.target.value)}>
            {MONTHS.map((m) => (
              <option key={m.v} value={m.v}>
                {m.l}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-navy-3">
            How long to keep a record after a student or staff member leaves.
          </p>
        </div>
        <div>
          <label className={labelClass}>Audit log</label>
          <select className={fieldClass} value={audit} onChange={(e) => setAudit(e.target.value)}>
            {MONTHS.map((m) => (
              <option key={m.v} value={m.v}>
                {m.l}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-navy-3">
            How long change-history events are retained before pruning.
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save policy"}
        </button>
        {msg && (
          <span className={`text-sm ${msg.ok ? "text-green" : "text-terra"}`}>{msg.text}</span>
        )}
      </div>

      <p className="mt-4 border-t border-border pt-4 text-[11px] text-navy-3">
        These set your retention <b>policy</b>. Automatic purging runs in a later release —
        for now nothing is deleted automatically; the policy is recorded for compliance.
      </p>
    </div>
  );
}
