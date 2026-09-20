"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { enableSenRegister } from "@/lib/actions/sen";

/** GOV-10 · the explicit opt-in (R413). Enabling writes the adoption marker so the annual census §5 flips to
 *  AUTO (adopted → FULL, even at a captured zero). Admin-gated by the action. */
export function EnableSenButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onEnable() {
    setBusy(true);
    setError(null);
    const res = await enableSenRegister();
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(res.error);
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onEnable}
        disabled={busy}
        className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
      >
        {busy ? "Enabling…" : "Enable the SEN register"}
      </button>
      {error && <p className="text-sm text-terra">{error}</p>}
    </div>
  );
}
