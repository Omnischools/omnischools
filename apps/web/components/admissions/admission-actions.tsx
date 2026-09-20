"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideApplication } from "@/lib/actions/admissions";

export function AdmissionActions({
  applicationId,
  decided,
}: {
  applicationId: string;
  decided: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function decide(decision: "ACCEPTED" | "REJECTED" | "WAITLISTED") {
    setError(null);
    startTransition(async () => {
      const res = await decideApplication({ applicationId, decision });
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  if (decided) return null;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => decide("ACCEPTED")}
        disabled={pending}
        className="rounded-md bg-green px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        Accept
      </button>
      <button
        onClick={() => decide("WAITLISTED")}
        disabled={pending}
        className="rounded-md bg-warn-bg px-3 py-1.5 text-xs font-semibold text-warn transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        Waitlist
      </button>
      <button
        onClick={() => decide("REJECTED")}
        disabled={pending}
        className="border-border-2 rounded-md border px-3 py-1.5 text-xs font-semibold text-terra transition-colors hover:bg-terra-bg disabled:opacity-50"
      >
        Reject
      </button>
      {error && <span className="text-xs text-terra">{error}</span>}
    </div>
  );
}
