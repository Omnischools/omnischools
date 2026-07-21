"use client";
/**
 * The visit record — visit-record §01 (identity + vitals timeline) · §02 (assessment + consult) ·
 * §04 (disposition + criteria), ported 1:1 via docs/senior/sickbay-visit-surface-map.md (SHS module
 * 4.4 / INCR-22a). §03 (meds) and §05 (comms) are ABSENT ENTIRELY — no shell, no badge, no anchor.
 *
 * Plain serialisable props only — never a DB row, never a `*-data`/`*-reads` import (those are
 * server-only). Times arrive pre-resolved as ISO or as request-time strings (B15: no ticking client
 * clock). The pure, DB-free libs (vitals.ts / visits.ts) ARE imported here — they carry the severity
 * ladder and trend arithmetic, so the client renders exactly what the tests assert.
 *
 * 🔒 The 11 adjacency leaks bind here: NO chronic flag, NO SCD banner, NO NHIS flag, NO `bed S-12-B`
 * dorm-bunk fragment. Diagnosis stays inside the module; this surface prints an impression to a
 * clinical reader only, and the page trims the whole payload for anyone else (Z2).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addConsult,
  addVitals,
  admitPatient,
  assessVisit,
  beginVisit,
  dischargeFromWard,
  disposeVisit,
  voidVisit,
} from "@/lib/actions/sickbay-visit";
import {
  ASSESSMENT_ROW_LABELS,
  CLUSTER_NOTE_TAIL,
  COMPLAINT_LABEL,
  DISPOSITION_EYEBROW,
  DISPOSITION_FIELD_LABELS,
  EXPECTED_DISCHARGE_SUB,
  STATUS_TILE_LABELS,
  VITALS_COLUMNS,
} from "@/lib/sickbay/visit-copy";
import {
  painLevel,
  painTrend,
  vitalSeverity,
  vitalTrend,
  type VitalReading,
} from "@/lib/sickbay/vitals";

// ── plain client shapes (ISO strings, no DB rows) ──────────────────────────
export interface VitalRow {
  id: string;
  takenAt: string;
  tempC: number | null;
  systolic: number | null;
  diastolic: number | null;
  pulseBpm: number | null;
  spo2Pct: number | null;
  painScore: number | null;
  context: string | null;
  takenByName: string | null;
}
export interface ConsultRow {
  id: string;
  occurredAt: string;
  mode: "PHONE" | "IN_PERSON";
  clinicianName: string;
  clinicianAffiliation: string | null;
  note: string;
  recordedByName: string | null;
}
export interface AdmissionView {
  id: string;
  bedNumber: number;
  isIsolation: boolean;
  admittedAt: string;
  admittedByName: string | null;
  expectedDischargeAt: string | null;
  dischargeCriteria: string | null;
  overnightPlan: string | null;
  dischargedAt: string | null;
}
export interface BedOption {
  id: string;
  bedNumber: number;
  isIsolation: boolean;
}
export interface VisitView {
  id: string;
  student: {
    name: string;
    firstName: string;
    lastName: string;
    initials: string;
    studentCode: string;
    ageYears: number | null;
    formLabel: string;
    houseName: string | null;
    primaryGuardian: { name: string; relationship: string } | null;
  };
  presentedAtHHMM: string;
  presentedAtLong: string; // "Wed 14 May 2026"
  presentingComplaint: string;
  intakeReportedBy: string | null;
  recordedByName: string | null;
  started: boolean;
  attendingName: string | null;
  attendingNmcLicence: string | null;
  assessment: {
    workingImpression: string | null;
    redFlagsScreened: string | null;
    hydrationStatus: string | null;
    plan: string | null;
    escalationTriggers: string | null;
    recordedAtHHMM: string | null;
  };
  disposition: "DISCHARGE" | "ADMIT" | "REFER" | null;
  voided: boolean;
  voidReason: string | null;
  vitals: VitalRow[];
  consults: ConsultRow[];
  admission: AdmissionView | null;
  timeOnWard: string | null; // request-time "05h 31m", admitted & not discharged
}

const hhmm = (iso: string) => {
  const d = new Date(iso);
  // Accra is UTC+0 all year — the UTC wall-clock IS the civil time, and it is hydration-stable.
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

const DISPOSITION_TITLE: Record<string, string> = {
  DISCHARGE: "Discharged",
  ADMIT: "Admitted",
  REFER: "Referred",
};

export function VisitRecordConsole({
  visit,
  canWrite,
  capabilities,
  availableBeds,
}: {
  visit: VisitView;
  canWrite: boolean;
  capabilities: { admissions: boolean; visitingDoctor: boolean };
  /** OPTIONAL and ABSENT in Mode C (R55): a referral-only school's flight payload carries no bed
   *  key at all — not an empty array, which would still be a bed reference in the DOM. */
  availableBeds?: BedOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<null | "vitals" | "assess" | "consult" | "admit" | "refer">(null);

  const isClosedOrVoid = visit.disposition !== null || visit.voided;
  const canAct = canWrite && !isClosedOrVoid;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "Could not save.");
      setOpen(null);
      router.refresh();
    });
  }

  const readings: VitalReading[] = visit.vitals.map((v) => ({
    takenAt: new Date(v.takenAt),
    tempC: v.tempC,
    systolic: v.systolic,
    diastolic: v.diastolic,
    pulseBpm: v.pulseBpm,
    spo2Pct: v.spo2Pct,
    painScore: v.painScore,
    context: v.context,
    takenByName: v.takenByName,
  }));
  const pain = painTrend(readings);
  const trend = vitalTrend(readings);
  const adm = visit.admission;
  const dispositionOpen = !isClosedOrVoid && visit.started;

  // The lede is fully derived and mode/disposition-dependent (Lucy V1.1). The surface only ever
  // draws the admitted case; the non-admitted variant is AUTHORED.
  const lede =
    adm && !adm.dischargedAt
      ? `Admitted ${hhmm(adm.admittedAt)} · ${visit.presentedAtLong} · Bed ${adm.bedNumber}${
          visit.attendingName ? ` · Attending ${visit.attendingName}` : ""
        }`
      : `Seen ${visit.presentedAtHHMM} · ${visit.presentedAtLong}${
          visit.attendingName ? ` · Attending ${visit.attendingName}` : ""
        }`;

  return (
    <div className="mx-auto max-w-page px-6 pb-16 pt-6 md:px-9">
      {/* ═══ page head ═══ */}
      <div className="mb-6">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-3">
          <a href="/senior/sickbay/setup" className="text-gold no-underline">
            Sickbay
          </a>{" "}
          · Visit {visit.id.slice(0, 8)}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-[28px] font-medium leading-[1.1] tracking-[-0.018em] text-navy">
              Visit <em className="font-normal italic text-gold">record.</em>
            </h1>
            <div className="mt-1 max-w-[720px] text-[13px] text-navy-3">{lede}</div>
          </div>
          <div className="flex items-center gap-2">
            {canAct && (
              <button
                onClick={() => setOpen(open === "vitals" ? null : "vitals")}
                className="rounded-[5px] border border-navy bg-navy px-[14px] py-[8px] text-[12px] font-bold text-bg"
              >
                Update vitals
              </button>
            )}
            {canAct && !visit.started && (
              <button
                onClick={() => run(() => beginVisit({ visitId: visit.id }))}
                disabled={pending}
                className="rounded-[5px] border border-gold bg-gold px-[14px] py-[8px] text-[12px] font-bold text-navy"
              >
                Begin visit
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-terra bg-terra-bg px-4 py-2 text-[12px] font-semibold text-terra">
          {error}
        </div>
      )}
      {visit.voided && (
        <div className="mb-4 rounded-md border border-navy-3 bg-bg px-4 py-2 text-[12px] italic text-navy-3">
          This visit was voided{visit.voidReason ? ` — ${visit.voidReason}` : ""}. It is retained as a
          record and cannot be changed.
        </div>
      )}

      {/* ═══════════════════════ §01 · patient, presentation & vitals ═══════════════════════ */}
      <section className="mb-8">
        {/* patient header */}
        <div className="relative mb-6 grid grid-cols-[auto_1fr_auto] items-center gap-6 overflow-hidden rounded-[14px] bg-[linear-gradient(135deg,var(--navy)_0%,var(--navy-2)_100%)] p-[24px_28px]">
          <span
            aria-hidden
            className="absolute -right-[40px] -top-[40px] size-[160px] rounded-full bg-[rgba(200,151,91,0.08)]"
          />
          <div className="relative grid size-[72px] place-items-center rounded-full bg-gold font-display text-[24px] font-semibold text-navy">
            {visit.student.initials}
          </div>
          <div className="relative">
            <div className="font-display text-[26px] font-medium leading-[1.1] tracking-[-0.018em] text-bg">
              {visit.student.firstName}{" "}
              <em className="font-normal italic text-gold">{visit.student.lastName}</em>
            </div>
            <div className="mt-1 flex flex-wrap gap-4 text-[12px] text-gold-soft">
              <span>
                <b className="font-semibold text-bg">{visit.student.formLabel}</b>
                {visit.student.ageYears !== null ? ` · age ${visit.student.ageYears}` : ""}
              </span>
              {visit.student.houseName && (
                <>
                  <span className="text-gold">·</span>
                  <span>
                    <b className="font-semibold text-bg">{visit.student.houseName}</b> House
                  </span>
                </>
              )}
              {visit.student.primaryGuardian && (
                <>
                  <span className="text-gold">·</span>
                  <span>
                    {visit.student.primaryGuardian.relationship}{" "}
                    <b className="font-semibold text-bg">{visit.student.primaryGuardian.name}</b> ·
                    primary contact
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="relative flex flex-col items-end gap-2">
            {/* NO chronic-flag, NO nhis-flag (A1–A4/Y1/Y9). Only the non-clinical id-flag. */}
            <div className="font-mono text-[10px] font-medium text-gold-soft">
              {visit.student.studentCode}
            </div>
          </div>
        </div>

        {/* status strip */}
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatusTile
            gold
            lbl={STATUS_TILE_LABELS[0]}
            val={
              <em className="font-normal italic text-gold">
                {visit.disposition ? DISPOSITION_TITLE[visit.disposition] : "Open"}
              </em>
            }
            sub={
              adm && !adm.dischargedAt
                ? `${adm.isIsolation ? "isolation" : "general"} ward · bed ${adm.bedNumber}`
                : visit.started
                  ? "in progress"
                  : "in queue"
            }
          />
          {adm && !adm.dischargedAt && visit.timeOnWard && (
            <StatusTile
              lbl={STATUS_TILE_LABELS[1]}
              val={<span className="font-mono text-[13px] text-navy-2">{visit.timeOnWard}</span>}
              sub={`from ${hhmm(adm.admittedAt)}`}
            />
          )}
          {pain && (
            <StatusTile
              lbl={STATUS_TILE_LABELS[2]}
              val={
                <span className="font-mono text-[13px] text-navy-2">
                  {pain.current}/10 {pain.arrow && <em className="not-italic text-gold">{pain.arrow}</em>}
                </span>
              }
              sub={pain.first !== null ? `was ${pain.first}/10 on arrival` : "single reading"}
            />
          )}
          {adm && !adm.dischargedAt && adm.expectedDischargeAt && (
            <StatusTile
              lbl={STATUS_TILE_LABELS[3]}
              val={<span className="font-mono text-[13px] text-navy-2">{hhmm(adm.expectedDischargeAt)}</span>}
              sub={EXPECTED_DISCHARGE_SUB}
            />
          )}
        </div>

        {/* vitals card */}
        <div className="mb-[18px] overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex items-baseline justify-between border-b border-border p-[14px_20px_12px]">
            <div className="font-display text-[16px] font-semibold tracking-[-0.005em] text-navy">
              Vitals <em className="font-normal italic text-gold">timeline</em>
            </div>
            <div className="text-[10px] font-semibold tracking-[0.06em] text-navy-3">
              {visit.vitals.length === 0
                ? "no readings"
                : `${visit.vitals.length} reading${visit.vitals.length === 1 ? "" : "s"} · last ${hhmm(
                    visit.vitals[visit.vitals.length - 1].takenAt,
                  )}`}
            </div>
          </div>
          <div className="p-[16px_20px_20px]">
            {visit.vitals.length === 0 ? (
              <p className="text-[12px] italic text-navy-3">No readings yet.</p>
            ) : (
              <>
                {/* trend strip */}
                <div className="mb-[18px] grid grid-cols-2 gap-[14px] rounded-[10px] border border-dashed border-border-2 bg-bg p-[18px_20px] md:grid-cols-5">
                  {trend.map((t) => (
                    <div key={t.key}>
                      <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
                        {t.label}
                      </div>
                      <div className="mb-[3px] font-display text-[22px] font-semibold leading-none text-navy">
                        {t.emphasised ? (
                          <em className="font-normal italic text-gold">{t.value}</em>
                        ) : (
                          t.value
                        )}
                        {t.unit && <span className="font-mono text-[11px] font-medium text-navy-3">{t.unit}</span>}
                      </div>
                      {t.delta && (
                        <div
                          className={`text-[10px] font-bold ${
                            t.tone === "improving"
                              ? "text-green"
                              : t.tone === "worsening"
                                ? "text-terra"
                                : "text-navy-3"
                          }`}
                        >
                          {t.delta}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        {VITALS_COLUMNS.slice(0, 6).map((h, i) => (
                          <th
                            key={h}
                            className={`border-b border-border-2 bg-bg p-[9px_12px] text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3 ${
                              i === 0 ? "text-left" : "text-center"
                            }`}
                          >
                            {h}
                          </th>
                        ))}
                        <th className="border-b border-border-2 bg-bg p-[9px_12px] text-right text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
                          {VITALS_COLUMNS[6]}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visit.vitals.map((v, i) => {
                        const isNow = i === visit.vitals.length - 1;
                        return (
                          <VitalsRow key={v.id} v={v} isNow={isNow} />
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {canWrite && !visit.voided && (
              <div className="mt-4">
                <button
                  onClick={() => setOpen(open === "vitals" ? null : "vitals")}
                  className="text-[12px] font-semibold text-gold"
                >
                  {open === "vitals" ? "Cancel" : "Update vitals"}
                </button>
                {open === "vitals" && <VitalsForm pending={pending} onSubmit={(d) => run(() => addVitals({ visitId: visit.id, ...d }))} />}
              </div>
            )}
          </div>
        </div>

        {/* presenting complaint */}
        <div className="rounded-[10px] border border-border bg-bg p-[18px_20px]">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
            {COMPLAINT_LABEL}
          </div>
          <div className="mt-2 font-display text-[15px] italic leading-[1.55] text-navy-2">
            &ldquo;{visit.presentingComplaint}&rdquo;
          </div>
          {(visit.intakeReportedBy || visit.recordedByName) && (
            <div className="mt-[10px] text-[10px] italic text-navy-3">
              Recorded by{" "}
              <b className="not-italic font-semibold text-navy-2">
                {visit.intakeReportedBy ?? visit.recordedByName}
              </b>
              {visit.intakeReportedBy && visit.recordedByName ? ` · keyed by ${visit.recordedByName}` : ""} at
              intake {visit.presentedAtHHMM}
            </div>
          )}
        </div>
      </section>

      {/* ═══════════════════════ §02 · assessment & consult ═══════════════════════ */}
      <section id="assessment" className="mb-8">
        <h2 className="mb-3 font-display text-[22px] font-medium tracking-[-0.018em] text-navy">
          Assessment &amp; <em className="font-normal italic text-gold">consult.</em>
        </h2>

        {visit.assessment.workingImpression ? (
          <div className="mb-[14px] overflow-hidden rounded-xl border border-border bg-surface">
            <div className="flex items-baseline justify-between border-b border-border p-[14px_20px_12px]">
              <div className="font-display text-[16px] font-semibold text-navy">
                Matron&rsquo;s <em className="font-normal italic text-gold">assessment</em>
              </div>
              <div className="text-[10px] font-semibold tracking-[0.06em] text-navy-3">
                {visit.assessment.recordedAtHHMM ? `recorded ${visit.assessment.recordedAtHHMM}` : ""}
                {visit.attendingName ? ` · ${visit.attendingName}` : ""}
                {visit.attendingNmcLicence ? ` · N&MC #${visit.attendingNmcLicence}` : ""}
              </div>
            </div>
            <div className="p-[16px_20px_20px]">
              <AssessRow lbl={ASSESSMENT_ROW_LABELS[0]} val={visit.assessment.workingImpression} />
              {visit.assessment.redFlagsScreened && (
                <AssessRow lbl={ASSESSMENT_ROW_LABELS[1]} val={visit.assessment.redFlagsScreened} />
              )}
              {visit.assessment.hydrationStatus && (
                <AssessRow lbl={ASSESSMENT_ROW_LABELS[2]} val={visit.assessment.hydrationStatus} />
              )}
              {visit.assessment.plan && <AssessRow lbl={ASSESSMENT_ROW_LABELS[3]} val={visit.assessment.plan} />}
              {visit.assessment.escalationTriggers && (
                <AssessRow lbl={ASSESSMENT_ROW_LABELS[4]} val={visit.assessment.escalationTriggers} last />
              )}
            </div>
          </div>
        ) : (
          canAct &&
          visit.started &&
          open !== "assess" && (
            <button onClick={() => setOpen("assess")} className="mb-[14px] text-[12px] font-semibold text-gold">
              Record assessment
            </button>
          )
        )}

        {canAct && visit.started && (
          <div className="mb-[14px]">
            {visit.assessment.workingImpression && open !== "assess" && (
              <button onClick={() => setOpen("assess")} className="text-[12px] font-semibold text-gold">
                Edit assessment
              </button>
            )}
            {open === "assess" && (
              <AssessForm
                pending={pending}
                initial={visit.assessment}
                onCancel={() => setOpen(null)}
                onSubmit={(d) => run(() => assessVisit({ visitId: visit.id, ...d }))}
              />
            )}
          </div>
        )}

        {/* doctor consults */}
        <ConsultList consults={visit.consults} />
        {canAct && capabilities.visitingDoctor && (
          <div className="mt-2">
            <button
              onClick={() => setOpen(open === "consult" ? null : "consult")}
              className="text-[12px] font-semibold text-gold"
            >
              {open === "consult" ? "Cancel" : "Add consult"}
            </button>
            {open === "consult" && (
              <ConsultForm
                pending={pending}
                onSubmit={(d) => run(() => addConsult({ visitId: visit.id, ...d }))}
              />
            )}
          </div>
        )}
      </section>

      {/* ═══════════════════════ §04 · disposition & discharge ═══════════════════════ */}
      <section id="disposition" className="mb-8">
        <h2 className="mb-3 font-display text-[22px] font-medium tracking-[-0.018em] text-navy">
          Disposition <em className="font-normal italic text-gold">&amp; discharge.</em>
        </h2>

        {(visit.disposition || adm) && (
          <div className="mb-5 rounded-[14px] border-2 border-gold bg-[linear-gradient(135deg,var(--gold-bg)_0%,var(--surface)_100%)] p-[22px_26px]">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold">{DISPOSITION_EYEBROW}</div>
            <div className="font-display text-[22px] font-medium leading-[1.15] tracking-[-0.018em] text-navy">
              {visit.disposition ? DISPOSITION_TITLE[visit.disposition] : "Open"}
              {adm && (
                <>
                  {" "}
                  ·{" "}
                  <em className="font-normal italic text-gold">
                    {adm.isIsolation ? "isolation" : "general"} ward, bed {adm.bedNumber}
                  </em>
                </>
              )}
            </div>
            {adm && (
              <div className="mt-[14px] grid grid-cols-1 gap-[18px] border-t border-gold-soft pt-[14px] md:grid-cols-3">
                <DispField lbl={DISPOSITION_FIELD_LABELS[0]} val={hhmm(adm.admittedAt)} />
                {adm.expectedDischargeAt && (
                  <DispField lbl={DISPOSITION_FIELD_LABELS[1]} em val={hhmm(adm.expectedDischargeAt)} />
                )}
                {adm.overnightPlan && <DispField lbl={DISPOSITION_FIELD_LABELS[2]} val={adm.overnightPlan} />}
                {adm.dischargedAt && <DispField lbl="Discharged from ward" val={hhmm(adm.dischargedAt)} />}
              </div>
            )}
          </div>
        )}

        {/* discharge criteria — FREE TEXT at 22 (R63); NO 4-row checklist, NO `3 of 4 met` */}
        {adm?.dischargeCriteria && (
          <div className="mb-[18px] overflow-hidden rounded-xl border border-border bg-surface">
            <div className="border-b border-border p-[14px_20px_12px] font-display text-[16px] font-semibold text-navy">
              Discharge <em className="font-normal italic text-gold">criteria</em>
            </div>
            <div className="whitespace-pre-wrap p-[16px_20px_20px] text-[13px] leading-[1.55] text-navy-2">
              {adm.dischargeCriteria}
            </div>
          </div>
        )}

        {/* cluster note (trimmed at 22 — the parent/task clauses restore at INCR-26) */}
        {adm && !adm.dischargedAt && (
          <div className="mt-4 rounded-[10px] border border-dashed border-border-2 bg-bg p-[14px_18px] text-[12px] italic text-navy-3">
            The reassessment is on the incoming shift&rsquo;s handover. Either criterion-pass writes the
            discharge stamp; either criterion-fail extends admission.{" "}
            <b className="not-italic font-semibold text-navy-2">{CLUSTER_NOTE_TAIL}</b>
          </div>
        )}

        {/* disposition write controls (open, started, not closed) */}
        {dispositionOpen && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => run(() => disposeVisit({ visitId: visit.id, disposition: "DISCHARGE" }))}
              disabled={pending}
              className="rounded-[5px] border border-green bg-green-bg px-[14px] py-[8px] text-[12px] font-semibold text-green"
            >
              Discharge (walk-in)
            </button>
            <button
              onClick={() => setOpen(open === "refer" ? null : "refer")}
              className="rounded-[5px] border border-terra bg-terra-bg px-[14px] py-[8px] text-[12px] font-semibold text-terra"
            >
              Refer
            </button>
            {/* R55 — Admit is ABSENT in Mode C (capabilities.admissions === false) and, if forged,
                rejected at the action. The bed picker never enters a Mode-C DOM. */}
            {capabilities.admissions && (
              <button
                onClick={() => setOpen(open === "admit" ? null : "admit")}
                className="rounded-[5px] border border-gold bg-gold px-[14px] py-[8px] text-[12px] font-bold text-navy"
              >
                Admit patient
              </button>
            )}
          </div>
        )}
        {open === "refer" && dispositionOpen && (
          <ReferForm pending={pending} onSubmit={(note) => run(() => disposeVisit({ visitId: visit.id, disposition: "REFER", dispositionNote: note }))} />
        )}
        {open === "admit" && dispositionOpen && capabilities.admissions && (
          <AdmitForm
            pending={pending}
            beds={availableBeds ?? []}
            onSubmit={(d) => run(() => admitPatient({ visitId: visit.id, ...d }))}
          />
        )}

        {/* discharge from ward (an open admission) */}
        {canWrite && adm && !adm.dischargedAt && (
          <div className="mt-4">
            <button
              onClick={() => run(() => dischargeFromWard({ admissionId: adm.id }))}
              disabled={pending}
              className="rounded-[5px] border border-green bg-green-bg px-[14px] py-[8px] text-[12px] font-semibold text-green"
            >
              Discharge from ward
            </button>
          </div>
        )}
      </section>

      {/* void — legal only while open (R37) */}
      {canWrite && !isClosedOrVoid && (
        <VoidControl pending={pending} onSubmit={(reason) => run(() => voidVisit({ visitId: visit.id, reason }))} />
      )}
    </div>
  );
}

// ── small presentational sub-components ─────────────────────────────────────

function StatusTile({
  lbl,
  val,
  sub,
  gold,
}: {
  lbl: string;
  val: React.ReactNode;
  sub: string;
  gold?: boolean;
}) {
  return (
    <div
      className={`rounded-[10px] border p-[14px_16px] ${
        gold
          ? "border-[1.5px] border-gold bg-[linear-gradient(180deg,var(--surface)_0%,var(--gold-bg)_100%)]"
          : "border-border bg-surface"
      }`}
    >
      <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">{lbl}</div>
      <div className="mt-1 font-display text-[18px] font-semibold leading-[1.15] tracking-[-0.01em] text-navy">
        {val}
      </div>
      <div className="mt-0.5 text-[10px] italic text-navy-3">{sub}</div>
    </div>
  );
}

function VitalsRow({ v, isNow }: { v: VitalRow; isNow: boolean }) {
  const cell = (metric: "tempC" | "pulseBpm" | "spo2Pct", value: number | null, text: string) => {
    const sev = vitalSeverity(metric, value, isNow);
    const cls =
      sev === "elevated"
        ? "text-terra font-bold"
        : sev === "warn"
          ? "text-warn font-semibold"
          : sev === "normal"
            ? "text-green font-semibold"
            : sev === "ok"
              ? "text-navy-2"
              : "text-navy-3";
    return <td className={`border-b border-border p-[11px_12px] text-center font-mono text-[11px] ${cls}`}>{value === null ? "" : text}</td>;
  };
  const painCls = v.painScore === null ? "" : {
    min: "bg-green-bg text-green",
    low: "bg-gold-bg text-gold",
    mod: "bg-warn text-surface",
    high: "bg-terra text-surface",
  }[painLevel(v.painScore)];
  return (
    <tr className={isNow ? "bg-gold-bg" : ""}>
      <td className={`border-b border-border p-[11px_12px] font-mono text-[11px] font-semibold ${isNow ? "text-navy" : "text-navy-2"}`}>
        {hhmm(v.takenAt)}
        {v.context && <span className="mt-px block text-[9px] font-medium text-navy-3">{v.context}</span>}
      </td>
      {cell("tempC", v.tempC, v.tempC === null ? "" : `${v.tempC.toFixed(1)}°C`)}
      <td className="border-b border-border p-[11px_12px] text-center font-mono text-[11px] text-navy-2">
        {v.systolic !== null && v.diastolic !== null ? `${v.systolic}/${v.diastolic}` : ""}
      </td>
      {cell("pulseBpm", v.pulseBpm, v.pulseBpm === null ? "" : String(v.pulseBpm))}
      {cell("spo2Pct", v.spo2Pct, v.spo2Pct === null ? "" : `${v.spo2Pct}%`)}
      <td className="border-b border-border p-[11px_12px] text-center">
        {v.painScore !== null && (
          <span className={`inline-block rounded-full px-[7px] py-[2px] font-mono text-[10px] font-bold ${painCls}`}>
            {v.painScore}/10
          </span>
        )}
      </td>
      <td className="border-b border-border p-[11px_12px] text-right text-[12px] text-navy-2">{v.takenByName ?? ""}</td>
    </tr>
  );
}

function AssessRow({ lbl, val, last }: { lbl: string; val: string; last?: boolean }) {
  return (
    <div className={`grid grid-cols-1 gap-[18px] py-3 md:grid-cols-[140px_1fr] ${last ? "" : "border-b border-border"}`}>
      <div className="pt-[2px] text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">{lbl}</div>
      <div className="whitespace-pre-wrap text-[13px] leading-[1.55] text-navy-2">{val}</div>
    </div>
  );
}

function DispField({ lbl, val, em }: { lbl: string; val: string; em?: boolean }) {
  return (
    <div>
      <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">{lbl}</div>
      <div className="text-[13px] font-semibold text-navy">
        {em ? <em className="font-mono text-[11px] italic text-gold">{val}</em> : val}
      </div>
    </div>
  );
}

/**
 * Stored consults render in EVERY mode — a mode change is an affordance filter, never a data filter
 * (R3). Only the `Add consult` control is capability-gated. R60: a consult authorises nothing, so
 * there is no signature, no approval and no state that depends on one existing.
 */
function ConsultList({ consults }: { consults: ConsultRow[] }) {
  if (consults.length === 0) return null;
  return (
    <div className="space-y-[14px]">
      {consults.map((c) => (
        <div key={c.id} className="rounded-[10px] border border-border-2 border-l-[3px] border-l-gold bg-surface p-[16px_20px]">
          <div className="flex items-baseline justify-between">
            <div className="font-display text-[14px] font-semibold text-navy">
              {c.clinicianName}
              {c.clinicianAffiliation ? ` · ${c.clinicianAffiliation}` : ""}
              <span className="ml-2 rounded-full bg-gold-bg px-2 py-[2px] text-[9px] font-bold uppercase tracking-[0.1em] text-gold">
                {c.mode === "PHONE" ? "phone consult" : "in-person consult"}
              </span>
            </div>
            <div className="font-mono text-[10px] font-semibold text-navy-3">{hhmm(c.occurredAt)}</div>
          </div>
          <div className="mt-2 whitespace-pre-wrap text-[12px] leading-[1.55] text-navy-2">{c.note}</div>
          {c.recordedByName && (
            <div className="mt-2 text-[10px] italic text-navy-3">recorded by {c.recordedByName}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── write forms ─────────────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-[13px] text-navy-2 outline-none focus:border-gold";
const textareaCls =
  "w-full rounded-[10px] border border-border bg-bg px-4 py-3 text-[13px] leading-[1.55] text-navy-2 outline-none focus:border-gold";
const labelCls = "mb-1 block text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3";
const primaryBtn =
  "rounded-[5px] border border-navy bg-navy px-[16px] py-[9px] text-[12px] font-bold text-bg disabled:opacity-60";

function VitalsForm({ pending, onSubmit }: { pending: boolean; onSubmit: (d: Record<string, unknown>) => void }) {
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const numOrNull = (k: string) => (f[k]?.trim() ? Number(f[k]) : null);
  return (
    <div className="mt-3 rounded-[10px] border border-border bg-surface p-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {[
          ["tempC", "Temp °C", "0.1"],
          ["systolic", "Systolic", "1"],
          ["diastolic", "Diastolic", "1"],
          ["pulseBpm", "Heart rate", "1"],
          ["spo2Pct", "SpO₂ %", "1"],
          ["painScore", "Pain 0–10", "1"],
        ].map(([k, lbl, step]) => (
          <div key={k}>
            <label className={labelCls}>{lbl}</label>
            <input type="number" step={step} inputMode="decimal" value={f[k] ?? ""} onChange={set(k)} className={inputCls} />
          </div>
        ))}
      </div>
      <div className="mt-3">
        <label className={labelCls}>Context note (optional)</label>
        <input value={f.context ?? ""} onChange={set("context")} maxLength={32} placeholder="e.g. 2h obs, post-meds" className={inputCls} />
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          onSubmit({
            tempC: numOrNull("tempC"),
            systolic: numOrNull("systolic"),
            diastolic: numOrNull("diastolic"),
            pulseBpm: numOrNull("pulseBpm"),
            spo2Pct: numOrNull("spo2Pct"),
            painScore: numOrNull("painScore"),
            context: f.context?.trim() || null,
          })
        }
        className={`mt-4 ${primaryBtn}`}
      >
        {pending ? "Saving…" : "Save reading"}
      </button>
    </div>
  );
}

function AssessForm({
  pending,
  initial,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  initial: VisitView["assessment"];
  onCancel: () => void;
  onSubmit: (d: Record<string, unknown>) => void;
}) {
  const [f, setF] = useState({
    workingImpression: initial.workingImpression ?? "",
    redFlagsScreened: initial.redFlagsScreened ?? "",
    hydrationStatus: initial.hydrationStatus ?? "",
    plan: initial.plan ?? "",
    escalationTriggers: initial.escalationTriggers ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const rows: [keyof typeof f, string][] = [
    ["workingImpression", "Working impression (required)"],
    ["redFlagsScreened", "Red flags screened"],
    ["hydrationStatus", "Hydration status"],
    ["plan", "Plan"],
    ["escalationTriggers", "Escalation triggers"],
  ];
  return (
    <div className="mt-3 rounded-[10px] border border-border bg-surface p-4">
      {rows.map(([k, lbl]) => (
        <div key={k} className="mb-3">
          <label className={labelCls}>{lbl}</label>
          <textarea rows={k === "workingImpression" ? 3 : 2} value={f[k]} onChange={set(k)} className={textareaCls} />
        </div>
      ))}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            onSubmit({
              workingImpression: f.workingImpression.trim(),
              redFlagsScreened: f.redFlagsScreened.trim() || null,
              hydrationStatus: f.hydrationStatus.trim() || null,
              plan: f.plan.trim() || null,
              escalationTriggers: f.escalationTriggers.trim() || null,
            })
          }
          className={primaryBtn}
        >
          {pending ? "Saving…" : "Save assessment"}
        </button>
        <button type="button" onClick={onCancel} className="text-[12px] font-semibold text-navy-3">
          Cancel
        </button>
      </div>
    </div>
  );
}

function ConsultForm({ pending, onSubmit }: { pending: boolean; onSubmit: (d: Record<string, unknown>) => void }) {
  const [f, setF] = useState({ clinicianName: "", clinicianAffiliation: "", mode: "PHONE", note: "" });
  return (
    <div className="mt-3 rounded-[10px] border border-border bg-surface p-4">
      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className={labelCls}>Clinician name</label>
          <input value={f.clinicianName} onChange={(e) => setF((p) => ({ ...p, clinicianName: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Affiliation (optional)</label>
          <input value={f.clinicianAffiliation} onChange={(e) => setF((p) => ({ ...p, clinicianAffiliation: e.target.value }))} className={inputCls} />
        </div>
      </div>
      <div className="mb-3">
        <label className={labelCls}>Mode</label>
        <select value={f.mode} onChange={(e) => setF((p) => ({ ...p, mode: e.target.value }))} className={inputCls}>
          <option value="PHONE">Phone consult</option>
          <option value="IN_PERSON">In-person consult</option>
        </select>
      </div>
      <div className="mb-3">
        <label className={labelCls}>What was said</label>
        <textarea rows={3} value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} className={textareaCls} />
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          onSubmit({
            clinicianName: f.clinicianName.trim(),
            clinicianAffiliation: f.clinicianAffiliation.trim() || null,
            mode: f.mode,
            note: f.note.trim(),
          })
        }
        className={primaryBtn}
      >
        {pending ? "Logging…" : "Log consult"}
      </button>
    </div>
  );
}

function ReferForm({ pending, onSubmit }: { pending: boolean; onSubmit: (note: string | null) => void }) {
  const [note, setNote] = useState("");
  return (
    <div className="mt-3 rounded-[10px] border border-border bg-surface p-4">
      <label className={labelCls}>Referral note (optional)</label>
      <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={textareaCls} />
      <button type="button" disabled={pending} onClick={() => onSubmit(note.trim() || null)} className={`mt-3 ${primaryBtn}`}>
        {pending ? "Referring…" : "Refer"}
      </button>
    </div>
  );
}

function AdmitForm({
  pending,
  beds,
  onSubmit,
}: {
  pending: boolean;
  beds: BedOption[];
  onSubmit: (d: Record<string, unknown>) => void;
}) {
  const [pool, setPool] = useState<"general" | "isolation">("general");
  const [bedId, setBedId] = useState<string | null>(null);
  const [expected, setExpected] = useState("");
  const [criteria, setCriteria] = useState("");
  const [overnight, setOvernight] = useState("");
  const poolBeds = beds.filter((b) => b.isIsolation === (pool === "isolation"));
  return (
    <div className="mt-3 rounded-[10px] border border-gold bg-surface p-4">
      <div className="mb-3 flex gap-2">
        {(["general", "isolation"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              setPool(p);
              setBedId(null);
            }}
            className={`rounded-[5px] border px-3 py-1.5 text-[12px] font-semibold ${
              pool === p ? "border-gold bg-gold-bg text-gold" : "border-border-2 text-navy-3"
            }`}
          >
            {p === "general" ? "General" : "Isolation"} pool
          </button>
        ))}
      </div>
      <label className={labelCls}>Bed</label>
      {poolBeds.length === 0 ? (
        <p className="mb-3 text-[12px] italic text-terra">No free {pool} bed.</p>
      ) : (
        <div className="mb-3 flex flex-wrap gap-2">
          {poolBeds.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBedId(b.id)}
              className={`rounded-md border px-3 py-1.5 font-mono text-[11px] font-bold ${
                bedId === b.id ? "border-gold bg-gold-bg text-navy" : "border-border-2 text-navy-2"
              }`}
            >
              Bed {String(b.bedNumber).padStart(2, "0")}
            </button>
          ))}
        </div>
      )}
      <div className="mb-3">
        <label className={labelCls}>Target discharge (optional)</label>
        <input type="datetime-local" value={expected} onChange={(e) => setExpected(e.target.value)} className={inputCls} />
      </div>
      <div className="mb-3">
        <label className={labelCls}>Discharge criteria (free text, optional)</label>
        <textarea rows={2} value={criteria} onChange={(e) => setCriteria(e.target.value)} className={textareaCls} />
      </div>
      <div className="mb-3">
        <label className={labelCls}>Overnight plan (required — no silent overnight stays)</label>
        <textarea rows={2} value={overnight} onChange={(e) => setOvernight(e.target.value)} className={textareaCls} />
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          onSubmit({
            bedId,
            isIsolation: pool === "isolation",
            expectedDischargeAt: expected ? new Date(expected).toISOString() : null,
            dischargeCriteria: criteria.trim() || null,
            overnightPlan: overnight.trim(),
          })
        }
        className={primaryBtn}
      >
        {pending ? "Admitting…" : "Admit to bed"}
      </button>
    </div>
  );
}

function VoidControl({ pending, onSubmit }: { pending: boolean; onSubmit: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="text-[11px] font-semibold text-navy-3 underline">
        Void this visit
      </button>
    );
  return (
    <div className="mt-2 rounded-[10px] border border-terra bg-terra-bg p-4">
      <label className={labelCls}>Reason for voiding (required)</label>
      <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending || !reason.trim()}
          onClick={() => onSubmit(reason.trim())}
          className="rounded-[5px] border border-terra bg-terra px-[14px] py-[8px] text-[12px] font-bold text-bg disabled:opacity-60"
        >
          Void visit
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-[12px] font-semibold text-navy-3">
          Cancel
        </button>
      </div>
    </div>
  );
}
