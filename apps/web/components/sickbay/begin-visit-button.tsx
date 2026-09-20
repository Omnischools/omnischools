"use client";
/**
 * The queue's `Begin visit` control (SHS module 4.4 / INCR-22c).
 *
 * 🔴 It WRITES `started_at` and THEN navigates. A nav-only link to the visit record would leave
 * R33's wait clock running on a student the matron is already treating — and would rank her above a
 * patient nobody has seen. The write is the shipped `beginVisit` action, which re-checks the
 * MATRON-only clinical gate server-side, so rendering this button is an AFFORDANCE filter and never
 * the boundary (a HEADMASTER's row renders, and a hand-crafted POST from one is still refused).
 *
 * The error renders inline under the row and the row does not disappear: a queue that silently
 * loses a student is worse than a queue with a red line on it.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { beginVisit } from "@/lib/actions/sickbay-visit";

export function BeginVisitButton({ visitId }: { visitId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await beginVisit({ visitId });
            if (!res.ok) return setError(res.error ?? "Could not begin the visit.");
            router.push(`/senior/sickbay/visits/${visitId}`);
          })
        }
        className="rounded-[5px] border border-gold bg-gold px-[11px] py-[6px] text-[11px] font-semibold text-navy disabled:opacity-60"
      >
        Begin visit
      </button>
      {error && <p className="mt-1 text-[11px] text-terra">{error}</p>}
    </>
  );
}
