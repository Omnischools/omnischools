"use client";
import { useState } from "react";
import type { SenPendingRecord } from "@/lib/sen/register-data";
import { SEN_CATEGORY_ORDER, SEN_CATEGORY_LABEL, SEN_CATEGORY_PILL } from "@/lib/sen/vocab";
import { SenDetailForm } from "./sen-detail-form";

/**
 * GOV-10b · pending-consent panel (R440). Lists the children counted in the census but awaiting written
 * consent (student + category only — no detail, R410). Recording consent (PENDING→GRANTED) unlocks the full
 * record; the census total is unchanged (the child was already counted).
 */
export function SenConsentPanel({ pending }: { pending: SenPendingRecord[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (pending.length === 0) return null;

  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-5">
      <div>
        <h2 className="font-display text-lg font-semibold text-navy">Pending consent</h2>
        <p className="text-sm text-navy-3">
          {pending.length} student{pending.length === 1 ? "" : "s"} counted in the census but awaiting written
          consent before support detail is recorded. Record consent to unlock the full record.
        </p>
      </div>
      <div className="divide-y divide-border rounded-lg border border-border">
        {pending.map((p) => (
          <div key={p.recordId} className="p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-navy">{p.studentName}</span>
                <span className="text-[11px] text-navy-3">{p.className ?? "—"}</span>
                <span
                  className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${SEN_CATEGORY_PILL[p.category]}`}
                  title="Primary (census) category"
                >
                  {SEN_CATEGORY_LABEL[p.category]}
                </span>
                {SEN_CATEGORY_ORDER.filter((c) => p.secondaryCategories.includes(c)).map((c) => (
                  <span
                    key={c}
                    title="Additional category"
                    className="inline-flex items-center rounded-pill border border-border bg-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-navy-3"
                  >
                    {SEN_CATEGORY_LABEL[c]}
                  </span>
                ))}
              </div>
              {openId !== p.recordId && (
                <button
                  type="button"
                  onClick={() => setOpenId(p.recordId)}
                  className="rounded-md border border-border-2 bg-surface px-3 py-1.5 text-[12px] font-semibold text-navy hover:bg-gold-bg"
                >
                  Record consent
                </button>
              )}
            </div>
            {openId === p.recordId && (
              <SenDetailForm
                mode="consent"
                recordId={p.recordId}
                category={p.category}
                onDone={() => setOpenId(null)}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
