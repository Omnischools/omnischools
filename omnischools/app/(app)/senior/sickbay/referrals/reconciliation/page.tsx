import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import {
  hasAnyRole,
  SICKBAY_CLINICAL_READ_ROLES,
  SICKBAY_RECON_READ_ROLES,
} from "@/lib/access";
import { getNhisReconciliation, type ReconOutstandingRow } from "@/lib/sickbay/referral-reads";
import { type NhisTriState } from "@/lib/sickbay/referrals";
import { ReferralNav } from "@/components/sickbay/referral-nav";

export const dynamic = "force-dynamic";

const ghs = (n: number) => `GHS ${n.toFixed(2)}`;

/**
 * `/senior/sickbay/referrals/reconciliation` — referral-log §05, the outstanding NHIS reconciliation
 * (SHS module 4.4 / INCR-27 · R219/R220). FINANCE-gated (SICKBAY_RECON_READ_ROLES = ACCOUNTANT /
 * BURSAR / MATRON) and reachable by a finance-only Bursar (the one sickbay path on FINANCE_SECTIONS).
 *
 * 🔴 STRUCTURALLY clinical-free: `getNhisReconciliation` reads only the diagnosis-free cost lines —
 * no visit join, no working_impression, no surveillance_category. A BURSAR reading §05 is incapable of
 * seeing a condition (Risk-4, A12); the surface's condition fragments on the outstanding rows are
 * dropped. 🔴 NO invoice write (billing_line_item_id stays NULL, D6); NO SMS. 🚫 The school-wide NHIS
 * card-health matrix (R182) is ABSENT — no shell, no badge, no anchor.
 */
export default async function ReconciliationPage() {
  const { school, user } = await requireSchoolRole(SICKBAY_RECON_READ_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  const canViewCase = hasAnyRole(roles, SICKBAY_CLINICAL_READ_ROLES);

  const now = new Date();
  const r = await getNhisReconciliation(school.id, now);

  return (
    <div className="mx-auto max-w-page px-6 pb-16 pt-6 md:px-9">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-3">
        <a href="/senior/sickbay/today" className="text-gold no-underline">
          Sickbay
        </a>{" "}
        · Referrals · Reconciliation
      </div>
      <div className="mb-4">
        <h1 className="font-display text-[28px] font-medium leading-[1.1] tracking-[-0.018em] text-navy">
          Outstanding <em className="font-normal italic text-gold">reconciliation.</em>
        </h1>
        <p className="mt-1 max-w-[720px] text-[13px] text-navy-3">
          {r.totalOutstanding === 0 ? (
            "No outstanding balances — every referral this window was NHIS-covered."
          ) : (
            <>
              <b className="font-semibold text-navy-2">
                {r.familyCount} famil{r.familyCount === 1 ? "y carries" : "ies carry"}
              </b>{" "}
              referral-related balances. <b className="font-semibold text-navy-2">{ghs(r.totalOutstanding)} total.</b>{" "}
              {r.overThirtyCount > 0
                ? `${r.overThirtyCount} over 30 days and on the Bursar's chase list. `
                : ""}
              NHIS-covered items don&apos;t show here — only the gaps NHIS doesn&apos;t fill.
            </>
          )}
        </p>
      </div>

      <ReferralNav active="reconciliation" showHistory={canViewCase} showReconciliation />

      {/* ═══ recon strip — 3 cards. The cedi "NHIS-covered GHS 2,180" tile is OMITTED (no covered-amount
          column); it is replaced by the derivable "N of M covered" COUNT. ═══ */}
      <div className="mb-6 grid gap-[14px] sm:grid-cols-3">
        <ReconCard
          terra
          label="Total outstanding"
          value={ghs(r.totalOutstanding)}
          trend={
            r.totalOutstanding === 0
              ? "Every referral covered · GHS 0.00"
              : `${r.familyCount} famil${r.familyCount === 1 ? "y" : "ies"} · ${r.overThirtyCount} over 30 days · ${r.withinWindowCount} within normal pay window`
          }
        />
        <ReconCard
          label="Fully covered (30d)"
          value={r.referralCount === 0 ? "—" : `${r.coveredCount} of ${r.referralCount}`}
          trend={
            r.referralCount === 0
              ? "No referrals in the last 30 days"
              : "referrals fully covered · no parent gap"
          }
        />
        <ReconCard
          label="Average parent-cost"
          value={r.averageParentCost === null ? "—" : ghs(r.averageParentCost)}
          trend={r.averageParentCost === null ? "No referrals in the last 30 days" : "Per referral · 30-day average"}
        />
      </div>

      {/* ═══ outstanding list ═══ */}
      {r.rows.length === 0 ? (
        <p className="rounded-[14px] border border-dashed border-border-2 bg-bg p-[18px_20px] text-[13px] italic text-navy-3">
          No outstanding balances — every referral this window was NHIS-covered.
        </p>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-border bg-surface">
          {r.rows.map((row, i) => (
            <OutstandingRow key={row.referralId} row={row} canViewCase={canViewCase} last={i === r.rows.length - 1} />
          ))}
        </div>
      )}

      {/* ═══ cross-module handoff card (editorial, rendered honestly — steps 1 & 2 are deferred) ═══ */}
      <div className="mt-6 rounded-[14px] border border-border bg-surface p-[20px_24px]">
        <div className="font-display text-[15px] font-semibold text-navy">
          Cross-module handoff · <em className="font-normal italic text-gold">Sickbay → Billing → Comms</em>
        </div>
        <p className="mt-2 text-[12px] leading-[1.6] text-navy-3">
          The matron does not chase money. When a referral incurs an out-of-pocket cost, the design is
          that three things happen:
        </p>
        <ol className="mt-3 space-y-[10px] text-[12px] leading-[1.55] text-navy-2">
          <HandoffStep n="1" label="Billing module" deferred>
            creates the line item against the student&apos;s account with a &ldquo;sickbay referral&rdquo;
            tag. <i>Parked at 4.4 (D6) — no invoice is written yet; the cost line carries no billing link.</i>
          </HandoffStep>
          <HandoffStep n="2" label="Comms module" deferred>
            sends a one-line SMS to the parent at the moment of incurring. <i>Not built at 4.4 — no
            billing-triggered SMS path exists yet.</i>
          </HandoffStep>
          <HandoffStep n="3" label="Reconciliation surface">
            (here) shows the open balance and age. The Bursar opens this when the over-30 list grows.
          </HandoffStep>
        </ol>
        <p className="mt-3 border-t border-border pt-3 text-[12px] italic leading-[1.55] text-navy-2">
          <b className="not-italic font-semibold text-navy-2">
            Matron, Bursar, parent — three audiences, one source of truth.
          </b>{" "}
          Sickbay creates the cost; billing carries it. The matron never sees billing.
        </p>
      </div>
    </div>
  );
}

function ReconCard({
  label,
  value,
  trend,
  terra,
}: {
  label: string;
  value: string;
  trend: string;
  terra?: boolean;
}) {
  return (
    <div
      className={`rounded-[10px] p-[14px_16px] ${
        terra
          ? "border border-terra bg-[linear-gradient(135deg,var(--terra-bg)_0%,var(--surface)_100%)]"
          : "border border-border bg-surface"
      }`}
    >
      <div className="mb-[6px] text-[9px] font-bold uppercase tracking-[0.16em] text-navy-3">{label}</div>
      <div
        className={`font-display text-[26px] font-medium leading-none tracking-[-0.02em] ${
          terra ? "text-terra" : "text-navy"
        }`}
      >
        {value}
      </div>
      <div className="mt-[6px] text-[10px] font-medium text-navy-3">{trend}</div>
    </div>
  );
}

const AGE_TONE: Record<"over" | "within", string> = {
  over: "text-terra",
  within: "text-green",
};

const NHIS_LINE: Record<NhisTriState, string> = {
  EXPIRED: "NHIS card expired at time of admission",
  PARTIAL: "NHIS active · out-of-pocket items",
  YES: "NHIS active",
};

function OutstandingRow({
  row,
  canViewCase,
  last,
}: {
  row: ReconOutstandingRow;
  canViewCase: boolean;
  last: boolean;
}) {
  const ageLabel =
    row.ageDays === null
      ? "—"
      : row.ageDays === 0
        ? "Today · within window"
        : row.overThirty
          ? `${row.ageDays} days · over 30d`
          : `${row.ageDays} days · within window`;
  return (
    <div
      className={`grid grid-cols-[auto_1fr_auto] items-center gap-[14px] p-[14px_20px] ${
        last ? "" : "border-b border-border"
      }`}
    >
      <span
        className={`flex size-10 items-center justify-center rounded-full font-display text-[13px] font-semibold ${
          row.overThirty ? "bg-terra-bg text-terra" : "bg-warn-bg text-warn"
        }`}
      >
        {row.initials}
      </span>
      <div className="min-w-0">
        <div className="font-display text-[14px] font-semibold text-navy">{row.studentName}</div>
        <div className="text-[10px] text-navy-3">
          {row.formLabel}
          {row.houseName ? ` · ${row.houseName}` : ""}
        </div>
        {/* 🔴 A12 — the cost REASON + a payment-relevant NHIS fact + a generic tag. NEVER the condition. */}
        <div className="mt-[3px] text-[11px] leading-[1.5] text-navy-2">
          {row.itemLabel} · {NHIS_LINE[row.nhis]} · Sickbay referral
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 text-right">
        <div className="font-mono text-[15px] font-semibold text-navy">{ghs(row.outOfPocket)}</div>
        <div className={`text-[10px] font-semibold ${AGE_TONE[row.overThirty ? "over" : "within"]}`}>
          {ageLabel}
        </div>
        {/* View case is clinical-gated — a MATRON drills in, the Bursar cannot (and gets no link). */}
        {canViewCase && (
          <Link
            href={`/senior/sickbay/referrals/${row.referralId}`}
            className="text-[10px] font-semibold text-gold no-underline hover:underline"
          >
            View case →
          </Link>
        )}
      </div>
    </div>
  );
}

function HandoffStep({
  n,
  label,
  deferred,
  children,
}: {
  n: string;
  label: string;
  deferred?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-[24px_1fr] gap-3">
      <span
        className={`flex size-6 items-center justify-center rounded-full text-[11px] font-bold ${
          deferred ? "bg-bg text-navy-3" : "bg-gold text-navy"
        }`}
      >
        {n}
      </span>
      <div>
        <b className="font-semibold text-navy">{label}</b> {children}
      </div>
    </li>
  );
}
