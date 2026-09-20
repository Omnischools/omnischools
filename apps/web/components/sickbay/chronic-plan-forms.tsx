"use client";
/**
 * The CHRONIC REGISTER authoring surfaces (SHS module 4.4 / INCR-23a) — the `+ Add student` and
 * `Edit plan` forms and the medication-rows editor. The surface draws NONE of these (Lucy §5.9,
 * AUTHORED); they match the visit form's idiom (plain serialisable props, controlled inputs, a server
 * action per submit). Every one is reached ONLY behind the MATRON-only route + the MATRON-only server
 * action — a non-matron never renders them and a hand-crafted call is refused server-side.
 *
 * 🔴 R94 / E20 — MENTAL_HEALTH is a SECURITY DISCRIMINATOR, so the entry form states the consequence
 * AT THE POINT OF CHOICE: choosing it shows E20 ("The Headmaster will not see this entry unless you
 * grant it") and forces the referral-managed / not-on-site-treated flags the DB CHECK also enforces.
 *
 * 🔴 `diagnos` appears NOWHERE — the condition vocabulary is the only structured clinical field; every
 * detail input is free text.
 */
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  createChronicEntry,
  editChronicEntry,
  addChronicMed,
  removeChronicMed,
} from "@/lib/actions/sickbay-chronic";
import type { StudentPick } from "@/lib/sickbay/visit-reads";

const CONDITIONS: { value: string; label: string }[] = [
  { value: "SICKLE_CELL", label: "Sickle cell" },
  { value: "ASTHMA", label: "Asthma" },
  { value: "EPILEPSY", label: "Epilepsy" },
  { value: "ALLERGY", label: "Allergy / anaphylaxis" },
  { value: "MENTAL_HEALTH", label: "Mental health" },
  { value: "DIABETES", label: "Diabetes" },
  { value: "OTHER", label: "Other" },
];
const STATUSES: { value: string; label: string }[] = [
  { value: "STABLE", label: "Stable" },
  { value: "MONITOR", label: "Monitor" },
  { value: "ACTIVE_CRISIS", label: "Active crisis" },
];

/** R94 · E20 — the named ceiling, stated at the point of choice (R116's carve-out is only as good as this). */
const E20_CONSEQUENCE = "The Headmaster will not see this entry unless you grant it.";

/** One round column offered to a scheduled med (MEDICATION_ROUND slots, anchor first). */
export interface RoundOption {
  slotId: string;
  time: string;
  label: string;
}

/** One existing med row — carries the surrogate id the Remove action needs. */
export interface EditMedRow {
  id: string;
  drugName: string;
  doseLabel: string;
  isPrn: boolean;
  slotId: string | null;
  note: string | null;
}

/** The care-plan body values — shared by the create + edit forms. */
export interface PlanFieldValues {
  condition: string;
  conditionLabel: string;
  status: string;
  onSiteTreatable: boolean;
  referralManaged: boolean;
  conditionDetail: string;
  baselineStatus: string;
  careGoals: string;
  emergencyProtocol: string;
  dischargeCriteria: string;
  triggers: string;
  redFlags: string;
  firstAction: string;
  externalClinicalHome: string;
  externalPastoralHome: string;
  externalCareCadence: string;
}

const BLANK: PlanFieldValues = {
  condition: "SICKLE_CELL",
  conditionLabel: "",
  status: "STABLE",
  onSiteTreatable: true,
  referralManaged: false,
  conditionDetail: "",
  baselineStatus: "",
  careGoals: "",
  emergencyProtocol: "",
  dischargeCriteria: "",
  triggers: "",
  redFlags: "",
  firstAction: "",
  externalClinicalHome: "",
  externalPastoralHome: "",
  externalCareCadence: "",
};

/** Coalesce a partial (from the edit route) to fully-populated, controlled values. */
function toValues(v: Partial<PlanFieldValues>): PlanFieldValues {
  return {
    condition: v.condition ?? BLANK.condition,
    conditionLabel: v.conditionLabel ?? BLANK.conditionLabel,
    status: v.status ?? BLANK.status,
    onSiteTreatable: v.onSiteTreatable ?? BLANK.onSiteTreatable,
    referralManaged: v.referralManaged ?? BLANK.referralManaged,
    conditionDetail: v.conditionDetail ?? BLANK.conditionDetail,
    baselineStatus: v.baselineStatus ?? BLANK.baselineStatus,
    careGoals: v.careGoals ?? BLANK.careGoals,
    emergencyProtocol: v.emergencyProtocol ?? BLANK.emergencyProtocol,
    dischargeCriteria: v.dischargeCriteria ?? BLANK.dischargeCriteria,
    triggers: v.triggers ?? BLANK.triggers,
    redFlags: v.redFlags ?? BLANK.redFlags,
    firstAction: v.firstAction ?? BLANK.firstAction,
    externalClinicalHome: v.externalClinicalHome ?? BLANK.externalClinicalHome,
    externalPastoralHome: v.externalPastoralHome ?? BLANK.externalPastoralHome,
    externalCareCadence: v.externalCareCadence ?? BLANK.externalCareCadence,
  };
}

/** Trim the free-text fields and send nullable ones as null when empty. */
function toPayload(v: PlanFieldValues) {
  const t = (s: string) => (s.trim() ? s.trim() : null);
  const mh = v.condition === "MENTAL_HEALTH";
  return {
    condition: v.condition,
    conditionLabel: v.conditionLabel.trim(),
    status: v.status,
    // Mirror the server derivation so the optimistic view matches; the action forces these anyway.
    onSiteTreatable: mh ? false : v.onSiteTreatable,
    referralManaged: mh ? true : v.referralManaged,
    conditionDetail: t(v.conditionDetail),
    baselineStatus: t(v.baselineStatus),
    careGoals: t(v.careGoals),
    emergencyProtocol: t(v.emergencyProtocol),
    dischargeCriteria: t(v.dischargeCriteria),
    triggers: t(v.triggers),
    redFlags: t(v.redFlags),
    firstAction: t(v.firstAction),
    externalClinicalHome: t(v.externalClinicalHome),
    externalPastoralHome: t(v.externalPastoralHome),
    externalCareCadence: t(v.externalCareCadence),
  };
}

// ============================================================================
// Shared field group
// ============================================================================

function Label({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1 block text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-[13px] text-navy-2 outline-none focus:border-gold";
const areaCls =
  "w-full rounded-[10px] border border-border bg-bg px-4 py-3 text-[13px] leading-[1.55] text-navy-2 outline-none focus:border-gold";

function PlanFields({
  v,
  set,
}: {
  v: PlanFieldValues;
  set: (patch: Partial<PlanFieldValues>) => void;
}) {
  const mh = v.condition === "MENTAL_HEALTH";
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Condition</Label>
          <select
            value={v.condition}
            onChange={(e) => set({ condition: e.target.value })}
            className={inputCls}
          >
            {CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Status</Label>
          <select
            value={v.status}
            onChange={(e) => set({ status: e.target.value })}
            className={inputCls}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 🔴 E20 — the consequence, stated at the point of choice (R94/R116). */}
      {mh && (
        <div className="rounded-[10px] border border-navy-2 bg-navy-2 p-[12px_16px] text-[12px] leading-[1.55] text-bg">
          {E20_CONSEQUENCE}
        </div>
      )}

      <div>
        <Label>Condition label · the words on the pill</Label>
        <input
          value={v.conditionLabel}
          onChange={(e) => set({ conditionLabel: e.target.value })}
          placeholder="e.g. Sickle cell disease · HbSS"
          className={inputCls}
        />
      </div>

      {/* R96 — a mental-health plan is referral-managed and not on-site treated, by product policy. */}
      <div className="flex flex-wrap gap-5 text-[12px] text-navy-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={mh ? false : v.onSiteTreatable}
            disabled={mh}
            onChange={(e) => set({ onSiteTreatable: e.target.checked })}
          />
          Treated on site
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={mh ? true : v.referralManaged}
            disabled={mh}
            onChange={(e) => set({ referralManaged: e.target.checked })}
          />
          Referral-managed
        </label>
        {mh && (
          <span className="text-[11px] italic text-navy-3">
            A mental-health condition is always referral-managed and not treated on site.
          </span>
        )}
      </div>

      <Field label="Condition detail" value={v.conditionDetail} onChange={(x) => set({ conditionDetail: x })} />
      <Field label="Baseline status" value={v.baselineStatus} onChange={(x) => set({ baselineStatus: x })} />
      <Field label="Care goals" value={v.careGoals} onChange={(x) => set({ careGoals: x })} />
      {!mh && (
        <Field
          label="Emergency protocol · the matron's own words"
          value={v.emergencyProtocol}
          onChange={(x) => set({ emergencyProtocol: x })}
        />
      )}
      <Field label="Discharge criteria" value={v.dischargeCriteria} onChange={(x) => set({ dischargeCriteria: x })} />
      <Field
        label={mh ? "Sickbay monitoring" : "Crisis triggers"}
        value={v.triggers}
        onChange={(x) => set({ triggers: x })}
      />
      <Field label="Red flags" value={v.redFlags} onChange={(x) => set({ redFlags: x })} />
      {!mh && (
        <Field label="First action · dorm card" value={v.firstAction} onChange={(x) => set({ firstAction: x })} />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>External clinical home</Label>
          <input
            value={v.externalClinicalHome}
            onChange={(e) => set({ externalClinicalHome: e.target.value })}
            className={inputCls}
          />
        </div>
        <div>
          <Label>External pastoral home</Label>
          <input
            value={v.externalPastoralHome}
            onChange={(e) => set({ externalPastoralHome: e.target.value })}
            className={inputCls}
          />
        </div>
      </div>
      <div>
        <Label>External care cadence</Label>
        <input
          value={v.externalCareCadence}
          onChange={(e) => set({ externalCareCadence: e.target.value })}
          className={inputCls}
        />
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} className={areaCls} />
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-[12px] font-semibold text-terra">{error}</p>;
}

const primaryBtn =
  "rounded-[5px] border border-navy bg-navy px-[16px] py-[9px] text-[12px] font-bold text-bg disabled:opacity-60";

// ============================================================================
// + Add student — the new-plan form
// ============================================================================

export function NewChronicPlanForm({ students, query }: { students: StudentPick[]; query: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [v, setV] = useState<PlanFieldValues>(BLANK);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<PlanFieldValues>) => setV((cur) => ({ ...cur, ...patch }));

  function submit() {
    setError(null);
    if (!studentId) return setError("Pick the student first.");
    if (!v.conditionLabel.trim()) return setError("Give the condition a label — the words on the pill.");
    startTransition(async () => {
      const res = await createChronicEntry({ studentId, ...toPayload(v) });
      if (!res.ok) return setError(res.error ?? "Could not open the care plan.");
      router.push(`/senior/sickbay/chronic-register/${studentId}`);
    });
  }

  return (
    <div className="max-w-[820px] rounded-xl border border-border bg-surface p-[16px_20px_20px]">
      <form method="get" className="mb-4 flex gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Search student by name or code"
          className="flex-1 rounded-md border border-border-2 bg-bg px-3 py-2 text-[13px] text-navy-2 outline-none focus:border-gold"
        />
        <button
          type="submit"
          className="rounded-[5px] border border-border-2 bg-surface px-[14px] py-2 text-[12px] font-semibold text-navy-2"
        >
          Search
        </button>
      </form>

      <Label>Student</Label>
      {students.length === 0 ? (
        <p className="py-2 text-[12px] italic text-navy-3">
          {query ? "No active student matches that." : "Type a name or code to find the student."}
        </p>
      ) : (
        <ul className="mb-5 max-h-[240px] overflow-auto rounded-md border border-border">
          {students.map((s) => (
            <li key={s.id}>
              <label className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 text-[12px] last:border-b-0 hover:bg-gold-bg">
                <input
                  type="radio"
                  name="student"
                  checked={studentId === s.id}
                  onChange={() => setStudentId(s.id)}
                />
                <span className="font-semibold text-navy">{s.name}</span>
                <span className="text-navy-3">
                  {s.formLabel}
                  {s.houseName ? ` · ${s.houseName} House` : ""} · {s.studentCode}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <PlanFields v={v} set={set} />

      <div className="mt-5 flex items-center gap-3">
        <button type="button" disabled={pending} onClick={submit} className={primaryBtn}>
          {pending ? "Opening…" : "Open care plan"}
        </button>
        <ErrorLine error={error} />
      </div>
    </div>
  );
}

// ============================================================================
// Edit plan — the edit form + the med editor
// ============================================================================

export function EditChronicPlanForm({
  entryId,
  studentId,
  initial,
  meds,
  rounds,
}: {
  entryId: string;
  studentId: string;
  initial: Partial<PlanFieldValues>;
  meds: EditMedRow[];
  rounds: RoundOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState<PlanFieldValues>(toValues(initial));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<PlanFieldValues>) => setV((cur) => ({ ...cur, ...patch }));

  function submit() {
    setError(null);
    if (!v.conditionLabel.trim()) return setError("Give the condition a label — the words on the pill.");
    startTransition(async () => {
      const res = await editChronicEntry({ entryId, ...toPayload(v) });
      if (!res.ok) return setError(res.error ?? "Could not save the care plan.");
      router.push(`/senior/sickbay/chronic-register/${studentId}`);
    });
  }

  return (
    <div className="grid gap-6">
      <div className="max-w-[820px] rounded-xl border border-border bg-surface p-[20px_24px]">
        <PlanFields v={v} set={set} />
        <div className="mt-5 flex items-center gap-3">
          <button type="button" disabled={pending} onClick={submit} className={primaryBtn}>
            {pending ? "Saving…" : "Save care plan"}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/senior/sickbay/chronic-register/${studentId}`)}
            className="rounded-[5px] border border-border-2 bg-surface px-[14px] py-[9px] text-[12px] font-semibold text-navy-2"
          >
            Cancel
          </button>
          <ErrorLine error={error} />
        </div>
      </div>

      {/* The med rows editor is meaningless on a referral-managed plan (R102 refuses every insert). */}
      {v.condition !== "MENTAL_HEALTH" && v.onSiteTreatable && (
        <MedEditor entryId={entryId} meds={meds} rounds={rounds} />
      )}
    </div>
  );
}

function MedEditor({
  entryId,
  meds: initialMeds,
  rounds,
}: {
  entryId: string;
  meds: EditMedRow[];
  rounds: RoundOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [drugName, setDrugName] = useState("");
  const [doseLabel, setDoseLabel] = useState("");
  // "" = PRN (as needed); otherwise the chosen round's slot id.
  const [slot, setSlot] = useState("");
  const [note, setNote] = useState("");

  function add() {
    setError(null);
    if (!drugName.trim()) return setError("Give the drug name.");
    if (!doseLabel.trim()) return setError("Give the dose.");
    startTransition(async () => {
      const res = await addChronicMed({
        entryId,
        drugName: drugName.trim(),
        doseLabel: doseLabel.trim(),
        isPrn: slot === "",
        slotId: slot === "" ? null : slot,
        note: note.trim() || null,
      });
      if (!res.ok) return setError(res.error ?? "Could not add the medication.");
      setDrugName("");
      setDoseLabel("");
      setSlot("");
      setNote("");
      router.refresh();
    });
  }

  function remove(medId: string) {
    setError(null);
    startTransition(async () => {
      const res = await removeChronicMed({ medId });
      if (!res.ok) return setError(res.error ?? "Could not remove the medication.");
      router.refresh();
    });
  }

  const roundLabel = (slotId: string | null) =>
    slotId ? rounds.find((r) => r.slotId === slotId)?.label ?? "Scheduled round" : "PRN · as needed";

  return (
    <div className="max-w-[820px] rounded-xl border border-border bg-surface p-[20px_24px]">
      <div className="mb-3 font-display text-[16px] font-semibold text-navy">
        Daily <em className="font-normal italic text-gold">medication</em>
      </div>

      {initialMeds.length === 0 ? (
        <p className="mb-4 text-[12px] italic text-navy-3">No scheduled medication on this plan yet.</p>
      ) : (
        <ul className="mb-4 divide-y divide-border rounded-md border border-border">
          {initialMeds.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[12px]">
              <span>
                <b className="font-semibold text-navy">{m.drugName}</b>{" "}
                <span className="text-navy-2">{m.doseLabel}</span>
                <span className="ml-2 text-navy-3">· {roundLabel(m.slotId)}</span>
                {m.note ? <span className="ml-1 text-navy-3">· {m.note}</span> : null}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(m.id)}
                className="rounded-md border border-border-2 bg-surface px-[10px] py-[4px] text-[10px] font-semibold text-terra disabled:opacity-60"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 rounded-[10px] border border-dashed border-border-2 bg-bg p-[14px_16px]">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Drug</Label>
            <input value={drugName} onChange={(e) => setDrugName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <Label>Dose</Label>
            <input
              value={doseLabel}
              onChange={(e) => setDoseLabel(e.target.value)}
              placeholder="e.g. 500mg OD"
              className={inputCls}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Given at</Label>
            <select value={slot} onChange={(e) => setSlot(e.target.value)} className={inputCls}>
              <option value="">PRN · as needed</option>
              {rounds.map((r) => (
                <option key={r.slotId} value={r.slotId}>
                  {r.time} · {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Note · optional</Label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="with food · for pain ≥ 4/10"
              className={inputCls}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" disabled={pending} onClick={add} className={primaryBtn}>
            {pending ? "Adding…" : "Add medication"}
          </button>
          <ErrorLine error={error} />
        </div>
      </div>
    </div>
  );
}
