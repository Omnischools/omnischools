"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideCorrection } from "@/lib/actions/attendance";

export function CorrectionActions({ correctionId }: { correctionId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function decide(approve: boolean) {
    startTransition(async () => {
      await decideCorrection({ correctionId, approve });
      router.refresh();
    });
  }
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => decide(true)}
        disabled={pending}
        className="rounded-md bg-green px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        Approve
      </button>
      <button
        onClick={() => decide(false)}
        disabled={pending}
        className="border-border-2 rounded-md border px-3 py-1.5 text-xs font-semibold text-terra hover:bg-terra-bg disabled:opacity-50"
      >
        Reject
      </button>
    </div>
  );
}
