"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { voidPayment } from "@/lib/actions/fees";

export function VoidPaymentButton({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function doVoid() {
    startTransition(async () => {
      await voidPayment({ paymentId });
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-xs font-semibold text-navy-3 hover:text-terra"
      >
        Void
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <button
        onClick={doVoid}
        disabled={pending}
        className="font-semibold text-terra hover:underline disabled:opacity-50"
      >
        {pending ? "Voiding…" : "Confirm void"}
      </button>
      <button
        onClick={() => setConfirming(false)}
        className="text-navy-3 hover:text-navy"
      >
        cancel
      </button>
    </span>
  );
}
