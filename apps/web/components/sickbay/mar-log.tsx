"use client";
/**
 * The visit-record §3 MAR (SHS module 4.4 / INCR-24b · visit-record §3) — the append-only administration
 * log for ONE visit, a correction rendered as a footnoted amendment (R176). Plain client shape; it calls
 * `recordMedAdmin` through the shared append-dose form. No DB, no `*-reads` import (server-only).
 *
 * 🔴 Append-only: nothing is edited or removed. A correction is a NEW row (`corrects_admin_id`) rendered
 * immediately after its byte-unchanged original, tied by a left gold border; the original gains a small
 * `amended ↓` chip. Nothing is ever greyed to "voided" — a visible correction beside its intact original
 * is the whole point.
 *
 * Authored surface (N-DIV-8, no surface source): the amendment cluster + the Doctor-ordered tag are built
 * from the visit-record token vocabulary — owner sign-off pending at the PR.
 */
import { useState } from "react";
import {
  medSourceTag,
  MED_STATUS_LABEL,
  type MarRowView,
  type MedSource,
} from "@/lib/sickbay/med-admin";
import { AppendDoseForm, type DosePickers } from "./append-dose-form";

const TAG: Record<MedSource, string> = {
  STANDING_ORDER: "bg-gold-bg text-gold",
  CHRONIC: "bg-green-bg text-green",
  DOCTOR_ORDERED: "bg-navy-2 text-bg",
  AD_HOC: "border border-border bg-bg text-navy-2",
};

export function MarLog({
  rows,
  canWrite,
  visitId,
  pickers,
  consultTimeById,
}: {
  rows: MarRowView[];
  canWrite: boolean;
  visitId: string;
  pickers: DosePickers;
  /** consultId → "HH:MM" of the recorded consult, so a Doctor-ordered row is traceable (R143). */
  consultTimeById: Record<string, string>;
}) {
  const [adding, setAdding] = useState(false);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const byId = new Map(rows.map((r) => [r.id, r]));

  return (
    <section id="medications" className="mt-8 overflow-hidden rounded-[14px] border border-border bg-surface">
      <div className="flex items-end justify-between gap-[14px] border-b border-border bg-[linear-gradient(180deg,var(--bg)_0%,var(--surface)_100%)] p-[18px_22px_16px]">
        <div>
          <h3 className="font-display text-[20px] font-semibold tracking-[-0.01em] text-navy">
            Medications <em className="font-normal italic text-gold">administered.</em>
          </h3>
          <p className="mt-[3px] text-[12px] text-navy-3">
            {rows.length} entr{rows.length === 1 ? "y" : "ies"} this visit · every dose, the route, who gave it, and its source.
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="shrink-0 rounded-[5px] border border-gold bg-gold px-[14px] py-[8px] text-[12px] font-bold text-navy"
          >
            {adding ? "Close" : "Add dose"}
          </button>
        )}
      </div>

      {adding && canWrite && (
        <div className="border-b border-border p-[16px_22px]">
          <AppendDoseForm pickers={pickers} visitId={visitId} onDone={() => setAdding(false)} />
        </div>
      )}

      {rows.length === 0 ? (
        <p className="p-[18px_22px] text-[12px] italic text-navy-3">No medications recorded for this visit.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["Time", "Drug", "Dose · route", "Source", "Administered by"].map((h, i) => (
                <th
                  key={h}
                  className={`border-b border-border-2 bg-bg p-[9px_12px] text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3 ${
                    i === 4 ? "text-right" : "text-left"
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const amendment = r.correctsAdminId ? byId.get(r.correctsAdminId) ?? null : null;
              return (
                <tr
                  key={r.id}
                  className={`align-middle text-[12px] ${amendment ? "border-l-[3px] border-l-gold bg-gold-bg" : ""}`}
                >
                  <td className="border-b border-border p-[10px_12px] font-mono text-[11px] font-semibold text-navy-2 whitespace-nowrap">
                    {r.administeredAtHHMM}
                    {r.amended && (
                      <span className="ml-[6px] text-[9px] font-bold uppercase tracking-[0.08em] text-gold">
                        amended ↓
                      </span>
                    )}
                  </td>
                  <td className="border-b border-border p-[10px_12px]">
                    {amendment && (
                      <span className="mb-[2px] block text-[9px] font-bold uppercase tracking-[0.08em] text-gold">
                        Amendment
                      </span>
                    )}
                    <b className="font-semibold text-navy">{r.drugName}</b>
                    {r.notes && <span className="mt-px block text-[10px] italic text-navy-3">{r.notes}</span>}
                    {amendment && (
                      <span className="mt-[3px] block text-[10px] italic text-navy-2">
                        Amends the {amendment.administeredAtHHMM} {amendment.drugName} entry — {r.amendmentNote}. Original retained.
                      </span>
                    )}
                  </td>
                  <td className="border-b border-border p-[10px_12px] font-mono font-medium text-navy-2">
                    {r.doseLabel}
                    {r.route ? ` · ${r.route}` : ""}
                  </td>
                  <td className="border-b border-border p-[10px_12px]">
                    <span className={`inline-block rounded-full px-[7px] py-[2px] text-[9px] font-bold uppercase tracking-[0.06em] ${TAG[r.source]}`}>
                      {medSourceTag(r.source, r.standingComplaint)}
                    </span>
                    {r.status !== "GIVEN" && (
                      <span className="ml-[6px] text-[10px] font-semibold text-terra">{MED_STATUS_LABEL[r.status]}</span>
                    )}
                    {r.source === "DOCTOR_ORDERED" && r.consultId && consultTimeById[r.consultId] && (
                      <a
                        href="#consult"
                        className="ml-[6px] font-mono text-[10px] text-gold no-underline"
                        title="Recorded by the Matron · see the consult in the assessment section"
                      >
                        {consultTimeById[r.consultId]}
                      </a>
                    )}
                  </td>
                  <td className="border-b border-border p-[10px_12px] text-right">
                    <span className="text-[12px] text-navy-2">{r.administeredByName ?? "—"}</span>
                    {r.isControlled && r.status === "GIVEN" && (
                      <span className="mt-px block text-[10px] italic text-navy-3">
                        {r.witnessName
                          ? <>witnessed by <b className="font-semibold not-italic text-navy-2">{r.witnessName}</b></>
                          : r.witnessOverrideReason
                            ? <>no witness — <b className="font-semibold not-italic text-navy-2">{r.witnessOverrideReason}</b></>
                            : null}
                      </span>
                    )}
                    {canWrite && !r.amended && (
                      <button
                        type="button"
                        onClick={() => setCorrecting(correcting === r.id ? null : r.id)}
                        className="mt-[4px] block text-[10px] font-semibold text-gold"
                      >
                        {correcting === r.id ? "Cancel" : "Correct"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {correcting && canWrite && (
        <div className="border-t border-border p-[16px_22px]">
          <AppendDoseForm
            pickers={pickers}
            visitId={visitId}
            correctsAdminId={correcting}
            onDone={() => setCorrecting(null)}
          />
        </div>
      )}

      {/* R146 — the append-only note, sentence 1 verbatim; the witness clause re-authored (§4.7). */}
      <div className="border-t border-border bg-gold-bg p-[14px_22px] text-[12px] italic text-navy-2">
        <b className="not-italic font-semibold">Append-only log.</b> Once a dose is recorded it cannot be deleted —
        only corrected with a footnoted amendment. The <b className="not-italic font-semibold">witness</b> column is
        required for a controlled substance given — a second N&MC-licensed clinician, or a recorded override reason.
        Non-controlled doses need no witness.
      </div>
    </section>
  );
}
