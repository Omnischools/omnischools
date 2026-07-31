"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generatePtas } from "@/lib/actions/pta";

/**
 * The foot bar (surface `.foot-bar`) with the explicit, idempotent "Generate PTAs now" primary button.
 * Generation is NOT cron ("tomorrow morning" in the surface is presentation only, R411) — it runs
 * exactly when the admin clicks, and re-running is a safe no-op ("Already up to date").
 */
export function GenerateBar({
  provenance,
}: {
  provenance: { at: string; byName: string } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  function run() {
    setMsg(null);
    startTransition(async () => {
      const res = await generatePtas();
      setIsError(!res.ok);
      setMsg(res.error ?? (res.ok ? "Done." : "Could not generate."));
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-bg px-6 py-4">
      <div className="text-[11px] italic text-navy-3">
        {provenance ? (
          <>
            PTA structure last edited · {provenance.at} by{" "}
            <b className="font-semibold not-italic text-navy-2">{provenance.byName}</b>
          </>
        ) : (
          "Not yet configured · set the tiers above, then generate."
        )}
      </div>
      <div className="flex items-center gap-3">
        {msg && (
          <p className={`text-xs font-semibold ${isError ? "text-terra" : "text-green"}`}>{msg}</p>
        )}
        <button
          onClick={run}
          disabled={pending}
          className="rounded-md bg-navy px-4 py-2 text-xs font-bold text-bg hover:bg-navy-deep disabled:opacity-50"
        >
          {pending ? "Generating…" : "Generate PTAs now"}
        </button>
      </div>
    </div>
  );
}
