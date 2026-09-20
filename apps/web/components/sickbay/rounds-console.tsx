"use client";
/**
 * The medication-rounds worklist (SHS module 4.4 / INCR-24b · today §2 · `/senior/sickbay/rounds`).
 * Renders the DERIVED rounds — anchor first, each with its due doses, status, and (MATRON only) a per-dose
 * `Record` affordance that opens the shared append-dose form. Plain client shape; no `*-reads` import.
 *
 * Authored surface (N-DIV-8, no surface source): the overdue pill/fade and the per-dose record control are
 * built from the module's existing token vocabulary (the today-board `.round-row` idiom) — owner sign-off
 * pending at the PR.
 */
import { useState } from "react";
import { AppendDoseForm, type DosePickers } from "./append-dose-form";
import type { MedRoundView, RoundStatus } from "@/lib/sickbay/med-admin";

const PILL: Record<RoundStatus, { text: (r: MedRoundView) => string; cls: string }> = {
  DONE: { text: (r) => (r.lastGivenAtHHMM ? `✓ Done · ${r.lastGivenAtHHMM}` : "✓ Done"), cls: "bg-green-bg text-green" },
  DUE: { text: () => "Due now", cls: "bg-gold-bg text-gold" },
  PENDING: { text: () => "Pending", cls: "border border-border bg-bg text-navy-3" },
  OVERDUE: { text: () => "Overdue", cls: "bg-terra-bg text-terra" },
  NONE_DUE: { text: () => "None due", cls: "border border-border bg-bg text-navy-3" },
};

const FADE: Partial<Record<RoundStatus, string>> = {
  DONE: "bg-[linear-gradient(90deg,var(--green-bg)_0%,transparent_60%)]",
  DUE: "bg-[linear-gradient(90deg,var(--gold-bg)_0%,transparent_60%)]",
  OVERDUE: "bg-[linear-gradient(90deg,var(--terra-bg)_0%,transparent_60%)]",
};

export function RoundsConsole({
  rounds,
  canWrite,
  pickers,
}: {
  rounds: MedRoundView[];
  canWrite: boolean;
  pickers: DosePickers;
}) {
  const [openDose, setOpenDose] = useState<string | null>(null); // chronicMedId of the row being recorded

  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-surface">
      {rounds.map((round) => {
        const pill = PILL[round.status];
        return (
          <div key={round.slotId} className={`border-b border-border last:border-b-0 ${FADE[round.status] ?? ""}`}>
            <div className="grid grid-cols-[110px_1fr_120px] items-start gap-[18px] p-[16px_20px]">
              <div>
                <div className="font-display text-[22px] font-semibold text-navy">{round.startsAt}</div>
                <div className="mt-[2px] text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3">
                  {round.label}
                  {round.isAnchor && <span className="ml-[5px] text-gold">· anchor</span>}
                </div>
              </div>

              <div className="text-[12px] leading-[1.7] text-navy-2">
                {round.doses.length === 0 ? (
                  <span className="italic text-navy-3">Nothing scheduled this weekday.</span>
                ) : (
                  round.doses.map((dose) => (
                    <div key={dose.chronicMedId} className="flex flex-wrap items-baseline gap-x-[8px]">
                      <span className={dose.done ? "text-navy-3 line-through" : "font-semibold text-navy"}>
                        {dose.studentName}
                      </span>
                      <span className="text-navy-3">
                        {dose.drugName} <span className="font-mono">{dose.doseLabel}</span>
                      </span>
                      {dose.done ? (
                        <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-green">
                          {dose.status === "GIVEN" ? "given" : (dose.status ?? "").toLowerCase()}
                        </span>
                      ) : canWrite ? (
                        <button
                          type="button"
                          onClick={() => setOpenDose(openDose === dose.chronicMedId ? null : dose.chronicMedId)}
                          className="rounded-[5px] border border-gold bg-gold px-[9px] py-[3px] text-[10px] font-bold text-navy"
                        >
                          {openDose === dose.chronicMedId ? "Close" : "Record"}
                        </button>
                      ) : null}

                      {openDose === dose.chronicMedId && canWrite && (
                        <div className="w-full">
                          <AppendDoseForm
                            pickers={pickers}
                            round={{
                              chronicMedId: dose.chronicMedId,
                              slotId: round.slotId,
                              studentId: dose.studentId,
                              studentName: dose.studentName,
                              drugName: dose.drugName,
                              doseLabel: dose.doseLabel,
                            }}
                            onDone={() => setOpenDose(null)}
                          />
                        </div>
                      )}
                    </div>
                  ))
                )}
                {round.doses.length > 0 && (
                  <div className="mt-[6px] text-[10px] italic text-navy-3">
                    <b className="font-semibold not-italic text-green">{round.givenCount} given</b>
                    {round.openCount > 0 && ` · ${round.openCount} still due`}
                  </div>
                )}
              </div>

              <div className="text-right">
                <span
                  className={`inline-block rounded-full px-[10px] py-[4px] text-[9px] font-bold uppercase tracking-[0.08em] ${pill.cls}`}
                >
                  {pill.text(round)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
