"use client";
/**
 * New-referral form (SHS module 4.4 / INCR-25b · W1). Client component — PLAIN SERIALIZABLE props
 * only (never a `*-reads` module). The referral hangs off a chosen REFER-disposition visit; the NHIS
 * snapshot is taken server-side from the student's card (no input here). Write affordances exist only
 * for the MATRON (the page renders this only when `canWrite`); the action re-checks the gate.
 *
 * Token discipline (`no-alpha-token-opacity`): solid tokens / `-bg` tints only, zero slash-opacity.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordReferral } from "@/lib/actions/sickbay-referral";

interface VisitOption {
  visitId: string;
  studentName: string;
  studentCode: string;
  formLabel: string;
  houseName: string | null;
  workingImpression: string | null;
}
interface StaffOption {
  id: string;
  name: string;
}
interface HospitalOption {
  id: string;
  name: string;
  acceptsNhis: boolean;
}

const FIELD =
  "w-full rounded-md border border-border-2 bg-surface px-2.5 py-1.5 text-[12px] text-navy outline-none focus:border-gold";

export function ReferralNewForm({
  visits,
  hospitals,
  headmasters,
  matrons,
}: {
  visits: VisitOption[];
  hospitals: HospitalOption[];
  headmasters: StaffOption[];
  matrons: StaffOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [visitId, setVisitId] = useState(visits[0]?.visitId ?? "");
  const [hospitalId, setHospitalId] = useState(hospitals.find((h) => h.acceptsNhis)?.id ?? hospitals[0]?.id ?? "");
  const [hmId, setHmId] = useState(headmasters[0]?.id ?? "");
  const [accompaniedById, setAccompaniedById] = useState("");
  const [transportMode, setTransportMode] = useState("");
  const [ward, setWard] = useState("");
  const [bed, setBed] = useState("");
  const [attending, setAttending] = useState("");
  const [reason, setReason] = useState("");
  const [preCare, setPreCare] = useState("");
  const [labs, setLabs] = useState("");
  const [lastMeal, setLastMeal] = useState("");
  const [menses, setMenses] = useState("");
  const [travel, setTravel] = useState("");

  const chosen = visits.find((v) => v.visitId === visitId) ?? null;

  function submit() {
    setError(null);
    if (!visitId) return setError("Pick a referred visit.");
    if (!hospitalId) return setError("Pick a referral hospital.");
    if (!hmId) return setError("Pick the authorising Headmaster.");
    if (!reason.trim()) return setError("Record the reason for referral.");
    start(async () => {
      const res = await recordReferral({
        visitId,
        hospitalId,
        hmAuthorisedByUserId: hmId,
        accompaniedByUserId: accompaniedById || null,
        transportMode: transportMode || null,
        hospitalWard: ward || null,
        hospitalBed: bed || null,
        attendingClinicianName: attending || null,
        reasonReferredOut: reason.trim(),
        preReferralCare: preCare || null,
        handoffLabs: labs || null,
        lastMeal: lastMeal || null,
        mensesNote: menses || null,
        travelNote: travel || null,
      });
      if (!res.ok || !res.id) {
        setError(res.error ?? "Could not record the referral.");
        return;
      }
      router.push(`/senior/sickbay/referrals/${res.id}`);
    });
  }

  if (visits.length === 0) {
    return (
      <div className="rounded-[14px] border border-dashed border-border-2 bg-bg p-[18px_20px] text-[13px] leading-[1.65] text-navy-2">
        No referred visit is waiting to be logged as a referral. A referral hangs off a visit whose
        disposition is <b className="font-semibold text-navy">Referred</b> — refer a visit from the
        sickbay board first, then log where they were sent.
      </div>
    );
  }

  return (
    <div className="rounded-[14px] border border-border bg-surface p-[18px_22px]">
      {error && (
        <div className="mb-3 rounded-lg border border-terra bg-terra-bg px-4 py-2.5 text-[12px] font-semibold text-terra">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Referred visit">
          <select className={FIELD} value={visitId} onChange={(e) => setVisitId(e.target.value)}>
            {visits.map((v) => (
              <option key={v.visitId} value={v.visitId}>
                {v.studentName} · {v.formLabel} · {v.studentCode}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Referral hospital">
          <select className={FIELD} value={hospitalId} onChange={(e) => setHospitalId(e.target.value)}>
            {hospitals.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
                {h.acceptsNhis ? " · NHIS accepted" : " · private · cost"}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* 🔴 The live working_impression carries through as the "Diagnosis" line — never re-typed here (R190). */}
      {chosen?.workingImpression && (
        <p className="mt-2 text-[11px] italic text-navy-3">
          Working impression on the visit: <b className="not-italic font-semibold text-navy-2">{chosen.workingImpression}</b>
        </p>
      )}

      <h4 className="mt-5 mb-2 text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
        ER handoff at admission — frozen once saved
      </h4>
      <Field label="Reason referred out (required)">
        <textarea
          className={`${FIELD} min-h-[64px]`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Cannot retain oral meds · needs IV antimalarial · beyond matron-only scope"
        />
      </Field>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Pre-referral care">
          <textarea className={`${FIELD} min-h-[48px]`} value={preCare} onChange={(e) => setPreCare(e.target.value)} />
        </Field>
        <Field label="Handoff labs / vitals">
          <textarea className={`${FIELD} min-h-[48px]`} value={labs} onChange={(e) => setLabs(e.target.value)} />
        </Field>
        <Field label="Last meal">
          <input className={FIELD} value={lastMeal} onChange={(e) => setLastMeal(e.target.value)} />
        </Field>
        <Field label="Menses note (recorded only where relevant)">
          <input className={FIELD} value={menses} onChange={(e) => setMenses(e.target.value)} />
        </Field>
        <Field label="Travel note">
          <input className={FIELD} value={travel} onChange={(e) => setTravel(e.target.value)} />
        </Field>
      </div>

      <h4 className="mt-5 mb-2 text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">Logistics & authorisation</h4>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Transport">
          <input className={FIELD} value={transportMode} onChange={(e) => setTransportMode(e.target.value)} placeholder="School van" />
        </Field>
        <Field label="Attending clinician (external — text)">
          <input className={FIELD} value={attending} onChange={(e) => setAttending(e.target.value)} placeholder="Dr K. Mensah" />
        </Field>
        <Field label="Ward">
          <input className={FIELD} value={ward} onChange={(e) => setWard(e.target.value)} />
        </Field>
        <Field label="Bed">
          <input className={FIELD} value={bed} onChange={(e) => setBed(e.target.value)} />
        </Field>
        <Field label="Accompanied by (matron)">
          <select className={FIELD} value={accompaniedById} onChange={(e) => setAccompaniedById(e.target.value)}>
            <option value="">Not recorded</option>
            {matrons.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Authorised by (Headmaster co-sign)">
          <select className={FIELD} value={hmId} onChange={(e) => setHmId(e.target.value)}>
            <option value="">Pick the Headmaster</option>
            {headmasters.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="rounded-md border border-navy bg-navy px-4 py-2 text-[12px] font-bold text-bg disabled:opacity-50"
        >
          {pending ? "Logging…" : "Log referral"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/senior/sickbay/referrals")}
          className="rounded-md border border-border-2 bg-surface px-4 py-2 text-[12px] font-semibold text-navy"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-navy-3">{label}</span>
      {children}
    </label>
  );
}
