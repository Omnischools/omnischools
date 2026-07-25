import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SICKBAY_CLINICAL_READ_ROLES, SICKBAY_CLINICAL_WRITE_ROLES, SICKBAY_ROLES } from "@/lib/access";
import { getReferralDetail, type ReferralUpdateRow } from "@/lib/sickbay/referral-reads";
import { ClinicalRestricted } from "@/components/sickbay/clinical-restricted";
import { ReferralCaseActions } from "@/components/sickbay/referral-actions";

export const dynamic = "force-dynamic";

const hhmm = (d: Date) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

/**
 * `/senior/sickbay/referrals/[ref]` — referral-log §02, case detail (SHS module 4.4 / INCR-25b).
 * Routed by the server-resolved referral id (no-IDOR: RLS + explicit school predicate + re-resolve; a
 * foreign id returns null → notFound). Same two-gate split as §01 — ADMIN gets no clinical fetch.
 *
 * 🔴 R190 — the "Diagnosis" flag is the visit's LIVE `working_impression`, never a stored referral
 * column. 🔴 F5 — the menses note (Class-4 reproductive PII) renders only inside this clinical gate.
 * 🔴 The comms thread (§03, INCR-26), the itemised NHIS render + billing handoff (§05, INCR-27), and
 * the 30-day history are NOT built here.
 */
export default async function ReferralCasePage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const { school, user } = await requireSchoolRole(SICKBAY_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  if (!hasAnyRole(roles, SICKBAY_CLINICAL_READ_ROLES)) return <ClinicalRestricted label="Referrals" />;

  const now = new Date();
  const d = await getReferralDetail(school.id, ref, now);
  if (!d) notFound();

  const canWrite = hasAnyRole(roles, SICKBAY_CLINICAL_WRITE_ROLES);
  const dob = d.student.dateOfBirth ? new Date(d.student.dateOfBirth) : null;
  const age = dob ? Math.floor((now.getTime() - dob.getTime()) / (365.25 * 24 * 3600_000)) : null;
  const totalOop = d.costLines.reduce((s, l) => s + (l.outOfPocketAmount ?? 0), 0);

  return (
    <div className="mx-auto max-w-page px-6 pb-16 pt-6 md:px-9">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-3">
        <a href="/senior/sickbay/today" className="text-gold no-underline">
          Sickbay
        </a>{" "}
        ·{" "}
        <Link href="/senior/sickbay/referrals" className="text-gold no-underline">
          Referrals
        </Link>{" "}
        · {d.student.firstName.charAt(0)}. {d.student.lastName} · case <span className="font-mono">{d.ref}</span>
      </div>
      <h1 className="mb-1 font-display text-[28px] font-medium leading-[1.1] tracking-[-0.018em] text-navy">
        {d.student.firstName.charAt(0)}. {d.student.lastName} ·{" "}
        <em className="font-normal italic text-gold">{d.workingImpression ?? "referral"}.</em>
      </h1>

      {/* R205 — voided banner, mirroring the visit record's treatment (visit-record-console). */}
      {d.voidedAt && (
        <div className="mb-4 mt-3 rounded-md border border-navy-3 bg-bg px-4 py-2 text-[12px] italic text-navy-3">
          This referral was voided{d.voidReason ? ` — ${d.voidReason}` : ""}. It is retained as a record
          and cannot be changed.
        </div>
      )}

      {/* Patient header */}
      <div className="mb-6 mt-4 grid grid-cols-[auto_1fr_auto] items-center gap-6 rounded-[14px] bg-[linear-gradient(135deg,var(--navy)_0%,var(--navy-2)_100%)] p-[24px_28px] text-bg">
        <span className="flex size-[68px] items-center justify-center rounded-full bg-gold font-display text-[22px] font-semibold text-navy">
          {d.student.initials}
        </span>
        <div className="min-w-0">
          <div className="font-display text-[24px] font-medium leading-[1.1] tracking-[-0.018em]">
            {d.student.firstName} <em className="font-normal italic text-gold">{d.student.lastName}</em>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-gold-soft">
            <span>
              <b className="font-semibold text-bg">{d.student.formLabel}</b>
            </span>
            {d.student.houseName && (
              <span>
                <b className="font-semibold text-bg">{d.student.houseName} House</b>
              </span>
            )}
            {age !== null && <span>Age {age}</span>}
            {d.student.hmName && <span>HM {d.student.hmName}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {/* 🔴 the diagnosis flag — LIVE working_impression, clinical-read gated (A1 satisfied by the gate). */}
          {d.workingImpression && (
            <span className="rounded-full bg-terra px-[11px] py-[5px] text-[10px] font-bold uppercase tracking-[0.1em] text-bg">
              {d.workingImpression}
            </span>
          )}
          <span className="rounded-full bg-green-bg px-[10px] py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-green">
            {d.nhisValid ? "NHIS active" : d.nhisCardNumber ? "NHIS on file" : "No NHIS card"}
          </span>
          <span className="font-mono text-[10px] font-medium text-gold-soft">
            {d.student.studentCode}
            {d.nhisCardNumber ? ` · ${d.nhisCardNumber}` : ""}
          </span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div>
          {/* ER handoff at admission — frozen snapshot (N22) */}
          <Card title="ER handoff" em="at admission" meta={d.departedAt ? `${hhmm(d.departedAt)}${d.attendingClinicianName ? ` · Matron → ${d.attendingClinicianName}` : ""}` : null}>
            <div className="grid gap-[14px] md:grid-cols-2">
              <div>
                <H5>Presenting</H5>
                <HRow label="Complaint" value={d.presentingComplaint || "—"} />
                <HRow label="Reason out" value={d.reasonReferredOut} strong />
                <HRow label="Labs / vitals" value={d.handoffLabs} />
              </div>
              <div>
                <H5>Pre-referral care</H5>
                <HRow label="Given" value={d.preReferralCare} />
                <HRow label="Last meal" value={d.lastMeal} />
                {/* 🔴 F5 — reproductive PII, rendered only inside this clinical gate. */}
                <HRow label="Menses" value={d.mensesNote} />
                <HRow label="Travel" value={d.travelNote} />
              </div>
            </div>
            <div className="mt-3 grid gap-[10px] rounded-lg border border-border bg-bg p-3 text-[11px] text-navy-2 md:grid-cols-2">
              <div>
                <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">Hospital</span>
                <div className="mt-0.5 font-semibold text-navy">{d.hospital.name}</div>
                <div className="text-navy-3">
                  {[d.hospitalWard, d.hospitalBed && `bed ${d.hospitalBed}`].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              <div>
                <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">Transport & escort</span>
                <div className="mt-0.5 text-navy-2">{d.transportMode ?? "—"}</div>
                <div className="text-navy-3">{d.accompaniedByName ? `${d.accompaniedByName} accompanied` : "—"}</div>
              </div>
            </div>
            {d.hmAuthorisedByName && (
              <p className="mt-2 text-[11px] italic text-navy-3">
                Off-site referral authorised by <b className="not-italic font-semibold text-navy-2">{d.hmAuthorisedByName}</b>
                {d.hmAuthorisedAt ? ` at ${hhmm(d.hmAuthorisedAt)}` : ""}.
              </p>
            )}
          </Card>

          {/* Hospital updates — append-only external clinical log (N23) */}
          <Card title="Hospital" em="updates" meta={`${d.updates.length} logged`}>
            {d.updates.length === 0 ? (
              <p className="text-[12px] italic text-navy-3">No hospital updates logged yet.</p>
            ) : (
              d.updates.map((u) => <UpdateRow key={u.id} u={u} />)
            )}
          </Card>

          {/* NHIS reconciliation · this case — snapshot identity + per-line coverage (S1/S3). Itemised
              render + billing handoff DEFERRED to INCR-27; the number here is the FROZEN snapshot (R184). */}
          <Card title="NHIS" em="reconciliation" meta={d.nhisCardNumber ? `Card ${d.nhisCardNumber}` : "No card on file"}>
            {d.costLines.length === 0 ? (
              <p className="text-[12px] italic text-navy-3">No cost lines recorded yet.</p>
            ) : (
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="text-left">
                    <Th>Item</Th>
                    <Th>Provider</Th>
                    <Th>Coverage</Th>
                    <Th right>Out-of-pocket</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.costLines.map((c) => (
                    <tr key={c.id} className="border-b border-border">
                      <td className="p-[8px_10px] text-navy-2">{c.itemLabel ?? "—"}</td>
                      <td className="p-[8px_10px] text-navy-3">{c.provider ?? "—"}</td>
                      <td className="p-[8px_10px]">
                        <span
                          className={`inline-block rounded-full px-[7px] py-[2px] text-[9px] font-bold uppercase tracking-[0.08em] ${
                            c.nhisCovered ? "bg-green-bg text-green" : "bg-terra-bg text-terra"
                          }`}
                        >
                          {c.nhisCovered ? "NHIS · covered" : "Out-of-pocket"}
                        </span>
                      </td>
                      <td className="p-[8px_10px] text-right font-mono font-semibold text-navy">
                        {c.nhisCovered || c.outOfPocketAmount == null ? "—" : `GHS ${c.outOfPocketAmount.toFixed(2)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-navy">
                    <td colSpan={3} className="p-[8px_10px] font-bold text-navy">
                      Total parent out-of-pocket
                    </td>
                    <td className="p-[8px_10px] text-right font-mono font-semibold text-navy">GHS {totalOop.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
            {totalOop === 0 && d.costLines.length > 0 && (
              <div className="mt-[14px] rounded-lg border-l-[3px] border-green bg-green-bg p-[12px_16px] text-[12px] text-navy-2">
                <b className="font-semibold text-navy">Clean NHIS case.</b> All items covered. No billing
                module entry. NHIS-covered items don&apos;t touch billing.
              </div>
            )}
          </Card>
        </div>

        <div>
          {canWrite ? (
            <ReferralCaseActions
              referralId={d.id}
              status={d.status}
              voided={d.voidedAt !== null}
              voidReason={d.voidReason}
            />
          ) : (
            <div className="rounded-[12px] border border-border bg-bg p-[16px_20px] text-[12px] italic text-navy-3">
              The Headmaster reads the referral record; the Matron records updates and marks the return.
            </div>
          )}
          {d.returnedAt && (
            <p className="mt-3 text-[12px] text-navy-2">
              Returned {hhmm(d.returnedAt)}
              {d.returnNote ? ` · ${d.returnNote}` : ""}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ title, em, meta, children }: { title: string; em: string; meta: string | null; children: React.ReactNode }) {
  return (
    <div className="mb-4 overflow-hidden rounded-[12px] border border-border bg-surface">
      <div className="flex items-baseline justify-between gap-3 border-b border-border p-[14px_20px_12px]">
        <span className="font-display text-[16px] font-semibold text-navy">
          {title} <em className="font-normal italic text-gold">{em}</em>
        </span>
        {meta && <span className="text-[10px] font-semibold tracking-[0.06em] text-navy-3">{meta}</span>}
      </div>
      <div className="p-[16px_20px_20px]">{children}</div>
    </div>
  );
}

function H5({ children }: { children: React.ReactNode }) {
  return (
    <h5 className="mb-[10px] border-b border-border pb-[6px] text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
      {children}
    </h5>
  );
}

/** A handoff row. An ABSENT clinical reading renders NOTHING (blank), never `—` (§1.4 convention). */
function HRow({ label, value, strong }: { label: string; value: string | null; strong?: boolean }) {
  if (value == null || value === "") return null;
  return (
    <div className="grid grid-cols-[90px_1fr] items-baseline gap-[10px] py-[6px] text-[11px] text-navy-2">
      <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">{label}</span>
      <span className={strong ? "font-semibold text-navy" : ""}>{value}</span>
    </div>
  );
}

function UpdateRow({ u }: { u: ReferralUpdateRow }) {
  return (
    <div className="grid grid-cols-[70px_1fr] gap-[14px] border-b border-border py-[9px] last:border-b-0">
      <div className="font-mono text-[11px] font-semibold text-navy">{hhmm(u.occurredAt)}</div>
      <div className="text-[11px] text-navy-2">
        {u.clinicianName && (
          <b className="font-semibold text-navy">
            {u.clinicianName}
            {u.clinicianAffiliation ? ` · ${u.clinicianAffiliation}` : ""}.{" "}
          </b>
        )}
        {u.body}
        {u.recordedByName && <span className="mt-0.5 block text-[10px] italic text-navy-3">recorded by {u.recordedByName}</span>}
      </div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`border-b border-border-2 bg-bg p-[8px_10px] text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3 ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}
