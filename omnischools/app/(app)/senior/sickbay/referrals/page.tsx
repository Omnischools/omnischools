import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import {
  hasAnyRole,
  SICKBAY_CLINICAL_READ_ROLES,
  SICKBAY_CLINICAL_WRITE_ROLES,
  SICKBAY_RECON_READ_ROLES,
  SICKBAY_ROLES,
} from "@/lib/access";
import { getActiveReferrals, type ActiveReferralRow } from "@/lib/sickbay/referral-reads";
import { ClinicalRestricted } from "@/components/sickbay/clinical-restricted";
import { MarkReturnedButton } from "@/components/sickbay/referral-actions";
import { ReferralNav } from "@/components/sickbay/referral-nav";

// B15 — wall-clock derivations are computed SERVER-SIDE at request time and rendered as static strings.
export const dynamic = "force-dynamic";

/**
 * `/senior/sickbay/referrals` — referral-log §01, active referrals (SHS module 4.4 / INCR-25b).
 *
 * 🔴 TWO gates, the split is the point (R195 · owner D2):
 *   • MODULE access is `SICKBAY_ROLES` — ADMIN reaches the route, is NOT 404'd.
 *   • CLINICAL read is `SICKBAY_CLINICAL_READ_ROLES` = [HEADMASTER, MATRON]; ADMIN gets NO fetch (the
 *     referral renders diagnosis/handoff/menses/NHIS — the acute graph has no grant mechanism, R166).
 *   • CLINICAL write is `SICKBAY_CLINICAL_WRITE_ROLES` = [MATRON]; a HEADMASTER reads and sees no CTA.
 */
export default async function ReferralsPage() {
  const { school, user } = await requireSchoolRole(SICKBAY_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  if (!hasAnyRole(roles, SICKBAY_CLINICAL_READ_ROLES)) return <ClinicalRestricted label="Referrals" />;

  const now = new Date();
  const { rows, stats } = await getActiveReferrals(school.id, now);
  const canWrite = hasAnyRole(roles, SICKBAY_CLINICAL_WRITE_ROLES);

  const n = stats.activeCount;
  // A2 — names beside "referred out" only to a clinical reader, only at low n (the "no names above one" ladder).
  const namesClause = n > 0 && n <= 4 ? ` ${stats.activeNames.join(" · ")}.` : "";

  return (
    <div className="mx-auto max-w-page px-6 pb-16 pt-6 md:px-9">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-3">
        <a href="/senior/sickbay/today" className="text-gold no-underline">
          Sickbay
        </a>{" "}
        · Referrals · Active
      </div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-medium leading-[1.1] tracking-[-0.018em] text-navy">
            Referrals <em className="font-normal italic text-gold">log.</em>
          </h1>
          <p className="mt-1 max-w-[720px] text-[13px] text-navy-3">
            {n === 0 ? (
              "No students out right now."
            ) : (
              <>
                <b className="font-semibold text-navy-2">
                  {n} student{n === 1 ? "" : "s"} out right now.
                </b>
                {namesClause}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* §03 (INCR-26) — today's parent-notifications day view, reachable from the referral log. */}
          <Link
            href="/senior/sickbay/referrals/notifications"
            className="rounded-[5px] border border-border-2 bg-surface px-[14px] py-[8px] text-[12px] font-semibold text-navy no-underline"
          >
            Today&apos;s notifications
          </Link>
          {canWrite && (
            <Link
              href="/senior/sickbay/referrals/new"
              className="rounded-[5px] border border-navy bg-navy px-[14px] py-[8px] text-[12px] font-bold text-bg no-underline"
            >
              + New referral
            </Link>
          )}
        </div>
      </div>

      <ReferralNav
        active="active"
        showHistory
        showReconciliation={hasAnyRole(roles, SICKBAY_RECON_READ_ROLES)}
      />

      {/* Stats strip — 3 tiles (tile 4 "Outstanding cost" omitted at 25, Y4/D6). */}
      <div className="mb-6 grid gap-[14px] sm:grid-cols-3">
        <Stat label="Active right now" value={String(n)} unit="students" trend={n > 0 ? stats.activeNames.join(" · ") : null} active />
        <Stat
          label="This week"
          value={String(stats.weekTotal)}
          unit="total"
          trend={stats.weekTotal > 0 ? `${stats.weekReturned} returned · ${stats.weekOpen} out` : null}
        />
        <Stat label="This semester" value={String(stats.semesterTotal)} unit="total" trend={null} />
      </div>

      {rows.length === 0 ? (
        <p className="rounded-[14px] border border-dashed border-border-2 bg-bg p-[18px_20px] text-[13px] italic text-navy-3">
          No students out right now. When the matron refers a student to a hospital, they appear here
          until they are marked returned.
        </p>
      ) : (
        <div className="grid gap-[18px] lg:grid-cols-2">
          {rows.map((r) => (
            <ReferralCard key={r.id} r={r} canWrite={canWrite} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  trend,
  active,
}: {
  label: string;
  value: string;
  unit: string;
  trend: string | null;
  active?: boolean;
}) {
  return (
    <div
      className={`rounded-[10px] p-[14px_16px] ${
        active
          ? "border border-terra bg-[linear-gradient(135deg,var(--terra-bg)_0%,var(--surface)_100%)]"
          : "border border-border bg-surface"
      }`}
    >
      <div className="mb-[6px] text-[9px] font-bold uppercase tracking-[0.16em] text-navy-3">{label}</div>
      <div className={`font-display text-[28px] font-medium leading-none tracking-[-0.02em] ${active ? "text-terra" : "text-navy"}`}>
        {value}
        <span className="ml-[5px] text-[13px] font-medium not-italic text-navy-3">{unit}</span>
      </div>
      {trend && <div className="mt-[5px] text-[10px] font-medium text-navy-3">{trend}</div>}
    </div>
  );
}

const STATUS_PILL: Record<string, string> = {
  REFERRED: "bg-navy text-bg",
  INPATIENT: "bg-terra text-bg",
  RETURNING: "bg-warn text-surface",
  RETURNED: "bg-green-bg text-green",
};
const CARD_BORDER: Record<string, string> = {
  REFERRED: "border border-border",
  INPATIENT: "border-[1.5px] border-terra",
  RETURNING: "border-[1.5px] border-warn",
  RETURNED: "border border-border",
};

function ReferralCard({ r, canWrite }: { r: ActiveReferralRow; canWrite: boolean }) {
  return (
    <div className={`flex flex-col overflow-hidden rounded-[14px] bg-surface ${CARD_BORDER[r.status]}`}>
      {/* head */}
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-[14px] bg-[linear-gradient(135deg,var(--navy)_0%,var(--navy-2)_100%)] p-[16px_20px] text-bg">
        <span className="flex size-12 items-center justify-center rounded-full bg-gold font-display text-[16px] font-semibold text-navy">
          {r.initials}
        </span>
        <div className="min-w-0">
          <div className="font-display text-[18px] font-medium tracking-[-0.01em]">
            {r.firstName.charAt(0)}. <em className="font-normal italic text-gold">{r.lastName}</em>
          </div>
          <div className="text-[11px] text-gold-soft">
            {r.formLabel}
            {r.houseName ? ` · ${r.houseName} House` : ""} · ID {r.studentCode}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`rounded-full px-[10px] py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${STATUS_PILL[r.status]}`}>
            {r.status.toLowerCase()}
          </span>
          <span className="font-mono text-[9px] font-semibold tracking-[0.08em] text-gold-soft">{r.dayLabel}</span>
        </div>
      </div>

      {/* body — the seven-line pattern (required-field set) */}
      <div className="flex-1 p-[18px_20px]">
        {/* 🔴 the "Diagnosis" line — LIVE from the visit's working_impression, clinical-read only (R190). */}
        <Line label="Diagnosis" value={r.workingImpression ?? "—"} strong />
        <Line label="Hospital" value={r.hospitalName} sub={[r.hospitalWard, r.hospitalBed && `bed ${r.hospitalBed}`, r.attendingClinicianName].filter(Boolean).join(" · ") || null} strong />
        <Line label="Transport" value={r.transportMode ?? "—"} sub={r.accompaniedByName ? `${r.accompaniedByName} accompanied` : null} />
        <Line
          label="NHIS"
          value={r.nhisCardNumber ?? "No card on file"}
          mono={!!r.nhisCardNumber}
          sub={r.nhisCardNumber ? (r.nhisValid ? "Card presented at ER · valid" : "Card on file · check validity") : null}
        />
        <Line
          label="Parent"
          value={r.primaryGuardian ? `${r.primaryGuardian.relationship} — ${r.primaryGuardian.name}` : "—"}
        />
        {r.latestUpdate && <Line label="Status" value={r.latestUpdate} />}
        {(r.expectedReturnAt || r.returnNote) && (
          <Line label="Expected back" value={r.returnNote ?? (r.expectedReturnAt ? new Date(r.expectedReturnAt).toISOString().slice(0, 16).replace("T", " ") : "—")} />
        )}
      </div>

      {/* foot */}
      <div className="flex items-center gap-2 border-t border-border bg-bg p-[12px_20px]">
        <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">Actions</span>
        <Link
          href={`/senior/sickbay/referrals/${r.id}`}
          className="rounded-md border border-navy bg-navy px-[11px] py-[6px] text-[10px] font-bold text-bg no-underline"
        >
          Open case detail
        </Link>
        {canWrite && r.status !== "RETURNED" && <MarkReturnedButton referralId={r.id} />}
      </div>
    </div>
  );
}

function Line({
  label,
  value,
  sub,
  strong,
  mono,
}: {
  label: string;
  value: string;
  sub?: string | null;
  strong?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-start gap-[14px] border-b border-border py-2 last:border-b-0">
      <div className="pt-[2px] text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">{label}</div>
      <div className="text-[12px] leading-[1.5] text-navy-2">
        <span className={`${mono ? "font-mono text-[11px]" : ""} ${strong ? "font-semibold text-navy" : ""}`}>{value}</span>
        {sub && <span className="mt-[2px] block text-[11px] italic text-navy-3">{sub}</span>}
      </div>
    </div>
  );
}
