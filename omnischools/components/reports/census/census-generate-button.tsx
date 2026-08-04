"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveCensusReturn } from "@/lib/actions/census";

/**
 * GOV-8 · the drawer's foot action. "Generate census" composes the snapshot server-side and saves a DRAFT
 * `census_return` (the school id is the session's, resolved in the action — never passed from here). No PDF is
 * produced in GOV-8 (that is GOV-9); on success we show the frozen-draft confirmation. Cancel returns to
 * /reports. Passes only the cadence + optional period — the durable snapshot is re-read server-side.
 */
export function CensusGenerateButton({
  cadence,
  periodId,
}: {
  cadence: "MID_YEAR" | "ANNUAL";
  periodId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const onGenerate = () => {
    setMsg(null);
    startTransition(async () => {
      const res = await saveCensusReturn({ cadence, periodId: periodId ?? undefined });
      if (res.ok) {
        setMsg({ ok: true, text: `Draft saved · ${res.academicYear} ${cadence === "MID_YEAR" ? "mid-year" : "annual"} census` });
        router.refresh();
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      {msg && (
        <div
          className={`text-[11px] font-semibold ${msg.ok ? "text-green" : "text-terra"}`}
          role="status"
        >
          {msg.text}
        </div>
      )}
      <div className="flex items-center gap-2.5">
        <a
          href="/reports"
          className="rounded-md border border-border-2 bg-surface px-4 py-2.5 text-xs font-semibold text-navy"
        >
          Cancel
        </a>
        <button
          type="button"
          onClick={onGenerate}
          disabled={pending}
          className="rounded-md border border-navy bg-navy px-4 py-2.5 text-xs font-bold text-bg disabled:opacity-60"
        >
          {pending ? "Generating…" : "Generate census →"}
        </button>
      </div>
    </div>
  );
}
