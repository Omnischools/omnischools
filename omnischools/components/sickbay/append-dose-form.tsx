"use client";
/**
 * The shared append-dose form (SHS module 4.4 / INCR-24b) — used by BOTH the rounds `Record` affordance
 * (§3.4) and the visit-MAR `Add dose` (§4.1). One form, two entry points (the surface map's own design).
 * Plain client shape only; it calls the `recordMedAdmin` Server Action — no DB, no `*-reads` import.
 *
 * 🔴 The witness/override affordance surfaces when a CONTROLLED stock item is selected and the dose is
 * GIVEN (R174). `is_controlled` is re-resolved on the server from the stock item, so this client hint is
 * a UX convenience — a forged flag cannot escape the gate (R172). The override input carries the R169
 * soft-validation advisory (Administrators can read the register; do not type a student's name).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordMedAdmin } from "@/lib/actions/sickbay-med-admin";
import { MED_STATUS_LABEL, type MedSource, type MedStatus } from "@/lib/sickbay/med-admin";

export interface DosePickers {
  witnesses: { id: string; name: string }[];
  stockItems: { id: string; drugName: string; isControlled: boolean }[];
  standingOrders: { id: string; complaint: string }[];
  consults?: { id: string; label: string }[];
}

export interface RoundPrefill {
  chronicMedId: string;
  slotId: string;
  studentId: string;
  studentName: string;
  drugName: string;
  doseLabel: string;
}

const STATUSES: MedStatus[] = ["GIVEN", "REFUSED", "HELD", "OMITTED"];
const SOURCES: { value: MedSource; label: string }[] = [
  { value: "CHRONIC", label: "Chronic" },
  { value: "STANDING_ORDER", label: "Standing order" },
  { value: "DOCTOR_ORDERED", label: "Doctor-ordered" },
  { value: "AD_HOC", label: "Ad-hoc" },
];

const FIELD = "w-full rounded-[5px] border border-border bg-surface px-[10px] py-[7px] text-[12px] text-navy";
const LABEL = "mb-[3px] block text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3";

export function AppendDoseForm({
  pickers,
  round,
  visitId,
  correctsAdminId,
  onDone,
}: {
  pickers: DosePickers;
  round?: RoundPrefill;
  visitId?: string;
  /** When set, this is a CORRECTION of an existing row — an amendment note is required (R146). */
  correctsAdminId?: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [source, setSource] = useState<MedSource>(round ? "CHRONIC" : "STANDING_ORDER");
  const [status, setStatus] = useState<MedStatus>("GIVEN");
  const [drugName, setDrugName] = useState(round?.drugName ?? "");
  const [doseLabel, setDoseLabel] = useState(round?.doseLabel ?? "");
  const [route, setRoute] = useState("");
  const [stockItemId, setStockItemId] = useState("");
  const [dispensedQty, setDispensedQty] = useState("");
  const [standingOrderId, setStandingOrderId] = useState("");
  const [consultId, setConsultId] = useState("");
  const [witnessUserId, setWitnessUserId] = useState("");
  const [overrideOn, setOverrideOn] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [notes, setNotes] = useState("");
  const [amendmentNote, setAmendmentNote] = useState("");

  const selectedControlled =
    pickers.stockItems.find((s) => s.id === stockItemId)?.isControlled ?? false;
  const witnessRequired = selectedControlled && status === "GIVEN";

  function submit() {
    setError(null);
    start(async () => {
      const res = await recordMedAdmin({
        source,
        status,
        ...(round
          ? { chronicMedId: round.chronicMedId, slotId: round.slotId, studentId: round.studentId }
          : {}),
        ...(visitId ? { visitId } : {}),
        drugName,
        doseLabel,
        route: route || null,
        stockItemId: stockItemId || null,
        dispensedQty: dispensedQty || null,
        standingOrderId: source === "STANDING_ORDER" ? standingOrderId || null : null,
        consultId: source === "DOCTOR_ORDERED" ? consultId || null : null,
        witnessUserId: witnessUserId || null,
        witnessOverrideReason: overrideOn ? overrideReason || null : null,
        notes: notes || null,
        ...(correctsAdminId ? { correctsAdminId, amendmentNote } : {}),
      });
      if (!res.ok) return setError(res.error ?? "Could not record the dose.");
      onDone();
      router.refresh();
    });
  }

  return (
    <div className="mt-3 rounded-[10px] border border-gold-soft bg-bg p-[16px_18px]">
      {round && (
        <p className="mb-3 text-[12px] text-navy-2">
          <b className="font-semibold text-navy">{round.studentName}</b> · {round.drugName}{" "}
          <span className="font-mono">{round.doseLabel}</span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-[12px]">
        {!round && (
          <div className="col-span-2">
            <span className={LABEL}>Source</span>
            <div className="flex flex-wrap gap-[6px]">
              {SOURCES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSource(s.value)}
                  className={`rounded-full px-[10px] py-[4px] text-[11px] font-semibold ${
                    source === s.value
                      ? "border border-gold bg-gold-bg text-gold"
                      : "border border-border bg-surface text-navy-3"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {!round && (
          <>
            <label className="block">
              <span className={LABEL}>Drug</span>
              <input className={FIELD} value={drugName} onChange={(e) => setDrugName(e.target.value)} />
            </label>
            <label className="block">
              <span className={LABEL}>Dose</span>
              <input className={FIELD} value={doseLabel} onChange={(e) => setDoseLabel(e.target.value)} />
            </label>
          </>
        )}

        <label className="block">
          <span className={LABEL}>Status</span>
          <select className={FIELD} value={status} onChange={(e) => setStatus(e.target.value as MedStatus)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {MED_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={LABEL}>Route</span>
          <input className={FIELD} value={route} onChange={(e) => setRoute(e.target.value)} placeholder="oral, IV…" />
        </label>

        <label className="block">
          <span className={LABEL}>Stock item drawn from</span>
          <select className={FIELD} value={stockItemId} onChange={(e) => setStockItemId(e.target.value)}>
            <option value="">— none (patient&apos;s own supply)</option>
            {pickers.stockItems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.drugName}
                {s.isControlled ? " · controlled" : ""}
              </option>
            ))}
          </select>
        </label>

        {selectedControlled && (
          <label className="block">
            <span className={LABEL}>Dispensed qty</span>
            <input
              className={`${FIELD} font-mono`}
              value={dispensedQty}
              onChange={(e) => setDispensedQty(e.target.value)}
              inputMode="decimal"
            />
          </label>
        )}

        {!round && source === "STANDING_ORDER" && (
          <label className="col-span-2 block">
            <span className={LABEL}>Standing order</span>
            <select className={FIELD} value={standingOrderId} onChange={(e) => setStandingOrderId(e.target.value)}>
              <option value="">— select the order</option>
              {pickers.standingOrders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.complaint}
                </option>
              ))}
            </select>
          </label>
        )}

        {!round && source === "DOCTOR_ORDERED" && (
          <label className="col-span-2 block">
            <span className={LABEL}>Doctor consult</span>
            <select className={FIELD} value={consultId} onChange={(e) => setConsultId(e.target.value)}>
              <option value="">— select the consult</option>
              {(pickers.consults ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {selectedControlled && (
          <div className="col-span-2 rounded-[8px] border border-border bg-surface p-[12px_14px]">
            <p className="mb-[8px] text-[11px] font-semibold text-navy-2">
              {witnessRequired
                ? "A controlled dose given needs a second N&MC clinician as witness — or a recorded override."
                : "Controlled dose — a witness is optional for a non-given entry."}
            </p>
            <label className="block">
              <span className={LABEL}>Witness (N&MC clinician)</span>
              <select
                className={FIELD}
                value={witnessUserId}
                onChange={(e) => setWitnessUserId(e.target.value)}
                disabled={overrideOn}
              >
                <option value="">— select a witness</option>
                {pickers.witnesses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-[8px] flex items-center gap-[6px] text-[11px] text-navy-2">
              <input
                type="checkbox"
                checked={overrideOn}
                onChange={(e) => {
                  setOverrideOn(e.target.checked);
                  if (e.target.checked) setWitnessUserId("");
                }}
              />
              No witness available — record an override reason
            </label>
            {overrideOn && (
              <>
                <textarea
                  className={`${FIELD} mt-[6px]`}
                  rows={2}
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Why no witness was available"
                />
                {/* R169 — soft advisory, not a control: this reason reaches the ADMIN-readable register. */}
                <p className="mt-[4px] text-[10px] italic text-navy-3">
                  Administrators can read this reason — do not enter a student&apos;s name.
                </p>
              </>
            )}
          </div>
        )}

        <label className="col-span-2 block">
          <span className={LABEL}>Notes</span>
          <textarea
            className={FIELD}
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="PRN criteria, own-bottle label/expiry check, prefect assist…"
          />
        </label>

        {correctsAdminId && (
          <label className="col-span-2 block">
            <span className={LABEL}>Amendment note (what this fixes)</span>
            <input className={FIELD} value={amendmentNote} onChange={(e) => setAmendmentNote(e.target.value)} />
          </label>
        )}
      </div>

      {error && <p className="mt-[10px] text-[11px] font-semibold text-terra">{error}</p>}

      <div className="mt-[14px] flex items-center gap-[8px]">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-[5px] border border-gold bg-gold px-[14px] py-[8px] text-[12px] font-bold text-navy disabled:opacity-60"
        >
          {pending ? "Recording…" : correctsAdminId ? "Record amendment" : "Record dose"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-[5px] border border-border-2 bg-surface px-[14px] py-[8px] text-[12px] font-semibold text-navy-3"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
