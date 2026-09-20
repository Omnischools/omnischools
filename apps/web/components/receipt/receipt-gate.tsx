"use client";
import { useState } from "react";
import { openReceipt } from "@/lib/actions/public-receipt";

type Ready = { url: string; filename: string; receiptNumber: string; amount: string };

/**
 * Parent-facing receipt gate. The unguessable token is in the URL; the parent enters the
 * student's ID to unlock the PDF (returned as bytes from the server only after the code
 * matches, then turned into a local blob URL — nothing sensitive renders before that).
 */
export function ReceiptGate({ token, schoolName }: { token: string; schoolName: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<Ready | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await openReceipt({ token, code });
    setBusy(false);
    if (res.ok) {
      const bytes = Uint8Array.from(atob(res.pdfBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      setReady({
        url,
        filename: res.filename,
        receiptNumber: res.receiptNumber,
        amount: res.amount,
      });
    } else setError(res.error);
  }

  if (ready) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-7 text-center shadow-sm">
        <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-gold">
          Receipt {ready.receiptNumber}
        </div>
        <div className="font-display text-3xl font-semibold text-navy">{ready.amount}</div>
        <p className="mt-2 text-sm text-navy-3">Verified. Your receipt is ready.</p>
        <div className="mt-5 flex flex-col gap-2.5">
          <a
            href={ready.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep"
          >
            Open receipt (PDF)
          </a>
          <a
            href={ready.url}
            download={ready.filename}
            className="rounded-md border border-border-2 px-5 py-2.5 text-sm font-semibold text-navy-2 transition-colors hover:bg-bg"
          >
            Download
          </a>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-border bg-surface p-7 shadow-sm"
    >
      <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-gold">
        {schoolName}
      </div>
      <h1 className="font-display text-2xl font-semibold text-navy">View your receipt</h1>
      <p className="mt-1.5 text-sm text-navy-3">
        For privacy, enter the student&apos;s ID to open this receipt. You&apos;ll find it on
        any invoice or report card.
      </p>

      <label className="mt-5 block text-xs font-semibold text-navy-2" htmlFor="code">
        Student ID
      </label>
      <input
        id="code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoComplete="off"
        placeholder="e.g. CTK-2024-018"
        className="mt-1.5 w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface"
      />

      {error && <p className="mt-3 text-sm text-terra">{error}</p>}

      <button
        type="submit"
        disabled={busy || code.trim() === ""}
        className="mt-5 w-full rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
      >
        {busy ? "Checking…" : "View receipt"}
      </button>
    </form>
  );
}
