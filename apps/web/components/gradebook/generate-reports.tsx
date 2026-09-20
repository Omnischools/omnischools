"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { generateReportCards } from "@/lib/actions/gradebook";

export function GenerateReports({
  classId,
  periodId,
}: {
  classId: string;
  periodId: string;
}) {
  const router = useRouter();
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setMsg(null);
    const res = await generateReportCards({ classId, periodId, remark });
    setBusy(false);
    if (res.ok) {
      setMsg(`Generated ${res.generated} report card${res.generated === 1 ? "" : "s"}.`);
      router.refresh();
    } else setError(res.error);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={remark}
        onChange={(e) => setRemark(e.target.value)}
        placeholder="Optional class remark"
        className="border-border-2 bg-bg grow rounded-md border px-3 py-2 text-sm text-navy outline-none focus:border-gold"
      />
      <button
        onClick={run}
        disabled={busy}
        className="text-bg rounded-md bg-navy px-5 py-2 text-sm font-semibold hover:bg-navy-deep disabled:opacity-60"
      >
        {busy ? "Generating…" : "Generate term reports"}
      </button>
      {msg && <span className="w-full text-sm text-green">{msg}</span>}
      {error && <span className="w-full text-sm text-terra">{error}</span>}
    </div>
  );
}
