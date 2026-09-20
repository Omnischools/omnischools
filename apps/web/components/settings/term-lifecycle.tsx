"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { closeTerm, reopenTerm } from "@/lib/actions/terms";
import { Modal } from "@/components/ui/modal";

export type LifecycleTerm = {
  periodId: string;
  label: string;
  startsOn: string; // YYYY-MM-DD
  endsOn: string;
  closed: boolean;
  periodNumber: number;
};

const fmt = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

/**
 * Term lifecycle — close a finished term (finalises its scores & attendance as read-only)
 * and reopen it if needed. The first still-open term is the school's active working term.
 */
export function TermLifecycle({ terms }: { terms: LifecycleTerm[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<LifecycleTerm | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeId = terms.find((t) => !t.closed)?.periodId;
  const nextAfter = (t: LifecycleTerm) =>
    terms.find((x) => !x.closed && x.periodNumber > t.periodNumber)?.label ?? null;

  async function run(fn: typeof closeTerm, t: LifecycleTerm) {
    setBusy(t.periodId);
    setError(null);
    const res = await fn({ periodId: t.periodId });
    setBusy(null);
    setConfirm(null);
    if (res.ok) router.refresh();
    else setError(res.error ?? "Something went wrong.");
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <h2 className="font-display text-lg font-semibold text-navy">Term lifecycle</h2>
      <p className="mb-4 mt-0.5 text-sm text-navy-3">
        Close a term when it&apos;s finished — its scores and attendance become read-only and
        the next term becomes your active term. You can reopen a term if you need to make a
        correction.
      </p>

      {error && (
        <p className="mb-3 rounded-md bg-terra-bg px-3 py-2 text-sm text-terra">{error}</p>
      )}

      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {terms.map((t) => {
          const isActive = t.periodId === activeId;
          return (
            <li
              key={t.periodId}
              className={`flex flex-wrap items-center gap-3 px-4 py-3.5 ${
                t.closed ? "bg-bg" : ""
              }`}
            >
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-[13px] font-semibold ${
                  t.closed
                    ? "border-[1.5px] border-border-2 bg-bg text-navy-3"
                    : isActive
                      ? "border-[1.5px] border-gold bg-gold text-navy"
                      : "border-[1.5px] border-border-2 bg-surface text-navy-3"
                }`}
              >
                {t.periodNumber}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`font-medium ${t.closed ? "text-navy-3" : "text-navy"}`}
                  >
                    {t.label}
                  </span>
                  {isActive && (
                    <span className="rounded-pill bg-gold-bg px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-gold">
                      Active
                    </span>
                  )}
                </div>
                <div className="text-xs text-navy-3">
                  {fmt(t.startsOn)} – {fmt(t.endsOn)}
                </div>
              </div>

              {t.closed ? (
                <div className="flex items-center gap-3">
                  <span className="rounded-pill border border-border px-2.5 py-0.5 text-[11px] font-semibold text-navy-3">
                    Closed
                  </span>
                  <button
                    type="button"
                    onClick={() => run(reopenTerm, t)}
                    disabled={busy === t.periodId}
                    className="text-sm font-semibold text-gold transition-colors hover:underline disabled:opacity-50"
                  >
                    {busy === t.periodId ? "Reopening…" : "Reopen"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirm(t)}
                  disabled={busy === t.periodId}
                  className="rounded-md border border-navy bg-navy px-3.5 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
                >
                  Close term
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <Modal
        open={confirm != null}
        onClose={busy ? () => {} : () => setConfirm(null)}
        title={confirm ? `Close ${confirm.label}?` : "Close term"}
      >
        {confirm && (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-navy-2">
              Closing <b className="text-navy">{confirm.label}</b> finalises it: its gradebook
              scores and attendance become <b className="text-navy">read-only</b>.
              {nextAfter(confirm)
                ? ` ${nextAfter(confirm)} becomes your active term.`
                : ""}{" "}
              You can reopen it later if you need to make a correction.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                disabled={busy != null}
                className="text-sm font-semibold text-navy-2 transition-colors hover:text-navy disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => run(closeTerm, confirm)}
                disabled={busy != null}
                className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
              >
                {busy != null ? "Closing…" : `Close ${confirm.label}`}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
