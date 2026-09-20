"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { issueAllInvoices } from "@/lib/actions/billing";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const ghs = (n: number) =>
  `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Preview = {
  schoolName: string;
  structureName: string;
  items: { description: string; amount: number }[];
  subtotal: number;
};

const STEPS: { numeral: string; title: string; body: string }[] = [
  {
    numeral: "i",
    title: "Each student gets their own invoice",
    body: "Generated from your fee structure, scoped to that student. Apply sibling/scholarship discounts per invoice from the student's Fees page.",
  },
  {
    numeral: "ii",
    title: "Tell guardians when you're ready",
    body: "Send payment reminders by SMS from Billing whenever you choose — issuing the invoices doesn't text anyone automatically.",
  },
  {
    numeral: "iii",
    title: "Payments start arriving",
    body: "As parents pay, Reports and the student Fees pages fill with collection data. Record cash payments anytime.",
  },
];

export function IssueInvoicesCard({
  unInvoiced,
  totalActive,
  termLabel,
  preview,
  classesWithoutStructure = 0,
}: {
  unInvoiced: number;
  totalActive?: number;
  termLabel: string;
  preview: Preview | null;
  classesWithoutStructure?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirmIssue() {
    setBusy(true);
    setError(null);
    const res = await issueAllInvoices();
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      setMsg(
        `Issued ${res.created} · ${res.skipped} already billed${
          res.classesWithoutStructure > 0
            ? ` · ${res.classesWithoutStructure} class${res.classesWithoutStructure === 1 ? "" : "es"} without a structure`
            : ""
        }`,
      );
      router.refresh();
    } else {
      setError(res.error ?? "Could not issue invoices.");
    }
  }

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-1 gap-6 rounded-xl border border-border bg-surface p-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Left — the pitch + actions */}
        <div className="flex flex-col">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
            Ready when you are
          </div>
          <h3 className="mt-2 font-display text-2xl font-semibold text-navy">
            Issue invoices for{" "}
            <em className="not-italic text-gold">{unInvoiced} students</em>
          </h3>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-navy-2">
            All students are loaded and your fee structure is set. Once you issue
            invoices, each student gets their own bill — review the preview before you go
            live.
          </p>

          {totalActive != null && totalActive > 0 && (
            <div className="mt-3 text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">
              {unInvoiced} of {totalActive} active students still to bill
            </div>
          )}

          {classesWithoutStructure > 0 && (
            <p className="mt-3 text-xs text-navy-3">
              {classesWithoutStructure} class
              {classesWithoutStructure === 1 ? " has" : "es have"} no matching fee
              structure for this level and will be skipped.
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setOpen(true)}
              disabled={unInvoiced === 0}
              className="rounded-md bg-gold px-5 py-2.5 text-sm font-semibold text-navy transition-colors hover:bg-gold-soft disabled:opacity-50"
            >
              Issue {unInvoiced} invoices →
            </button>
            <a
              href="#fee-structures"
              className="text-sm font-semibold text-navy-2 transition-colors hover:text-navy"
            >
              Edit fee structure first
            </a>
          </div>

          {msg && <p className="mt-3 text-sm font-medium text-green">{msg}</p>}
          {!open && error && <p className="mt-3 text-sm text-terra">{error}</p>}
        </div>

        {/* Right — mini invoice preview */}
        <div className="rounded-lg border border-border-2 bg-bg p-5">
          {preview ? (
            <>
              <div className="font-display text-base font-semibold text-navy">
                {preview.schoolName}
              </div>
              <div className="text-xs text-navy-3">{termLabel}</div>
              <ul className="mt-4 space-y-1.5 border-t border-border-2 pt-3 text-sm">
                {preview.items.map((it, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="text-navy-2">{it.description}</span>
                    <span className="font-mono text-xs text-navy-3">{ghs(it.amount)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex justify-between border-t border-border-2 pt-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-navy-3">
                  Total billed
                </span>
                <span className="font-display text-base font-semibold text-navy">
                  {ghs(preview.subtotal)}
                </span>
              </div>
            </>
          ) : (
            <p className="text-sm text-navy-3">
              Add at least one line item to a fee structure to preview the bill.
            </p>
          )}
        </div>
      </div>

      {/* "What happens" strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.numeral} className="rounded-xl border border-border bg-surface p-5">
            <div className="font-display text-2xl font-semibold italic text-gold">
              {s.numeral}
            </div>
            <div className="mt-2 font-display text-sm font-semibold text-navy">
              {s.title}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-navy-2">{s.body}</p>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={open}
        title={`Issue ${unInvoiced} invoices?`}
        message="This generates a bill for every un-billed student from your fee structures. You can send payment reminders afterwards."
        confirmLabel={`Issue ${unInvoiced} invoices`}
        busyLabel="Issuing…"
        tone="gold"
        busy={busy}
        error={error}
        onConfirm={confirmIssue}
        onClose={() => setOpen(false)}
      />
    </section>
  );
}
