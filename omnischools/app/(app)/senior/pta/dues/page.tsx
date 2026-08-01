import { redirect } from "next/navigation";
import { requireSchool } from "@/lib/auth/server";
import { FINANCE_ROLES, hasAnyRole, isStaff, PTA_CONFIG_WRITE_ROLES } from "@/lib/access";
import {
  getDuesGenerateOptions,
  getDuesReport,
  resolveDuesAccess,
  type DuesAccent,
  type DuesAgedRow,
  type DuesTierReport,
} from "@/lib/pta/dues-data";
import { RecordPaymentForm } from "@/components/fees/record-payment-form";
import { GenerateDuesCard } from "@/components/pta/generate-dues-card";

export const dynamic = "force-dynamic";

/**
 * `/senior/pta/dues` — the PTA dues collection report (SHS module 4.7 / INCR-54a). The Treasurer's
 * daily-use view: Expected / Collected / Outstanding / Aged, per tier + per PTA instance, with the aged
 * (>30d) escalation queue. READ gate (R469): management reads school-wide, a Treasurer reads their OWN
 * PTAs (resolveDuesAccess, re-checked here — the layout only toggles the tab). Cash-only recording reuses
 * RecordPaymentForm (admin/bursar-gated); generation is admin-only. NO SMS, NO MoMo float, NO Excel (54b).
 */
export default async function PtaDuesPage() {
  const { school, user } = await requireSchool();
  if (school.schoolType === "BASIC") redirect("/dashboard");
  if (!isStaff(user.roles)) redirect("/dashboard");

  const access = await resolveDuesAccess(school.id, { userId: user.id, roles: user.roles });
  if (!access.canView) redirect("/senior/pta/meetings");

  const report = await getDuesReport(school.id, access);
  const canManage = hasAnyRole(user.roles, PTA_CONFIG_WRITE_ROLES);
  // Recording is a finance/admin action (R466 resolved: bursar/admin only). The server boundary is
  // recordPayment's own staff gate; this only decides whether the affordance renders.
  const canRecordPayment = hasAnyRole(user.roles, [...FINANCE_ROLES, ...PTA_CONFIG_WRITE_ROLES]);
  const genOptions = canManage ? await getDuesGenerateOptions(school.id) : null;

  const s = report.summary;

  return (
    <div className="pb-20">
      <header className="mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">
          Billing · PTA · Dues
        </div>
        <h1 className="mt-1 font-display text-4xl font-medium leading-tight text-navy">
          Who&apos;s paid, <em className="italic text-gold">who hasn&apos;t</em>
        </h1>
        <div className="mb-3 mt-4 h-0.5 w-16 bg-gold" />
        <p className="max-w-3xl text-sm leading-relaxed text-navy-3">
          PTA dues live in their own fee category — collected on dedicated invoices, tracked apart from
          tuition, boarding and feeding. This is the collection report:{" "}
          {access.schoolWide ? "every tier, school-wide" : "your PTAs"} · expected vs collected · who to
          chase. A live snapshot that updates with every payment.
        </p>
      </header>

      {genOptions && (
        <div className="mb-8">
          <GenerateDuesCard options={genOptions} />
        </div>
      )}

      {!report.hasData ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
            No dues billed yet
          </div>
          <p className="mx-auto mt-1 max-w-md text-sm text-navy-3">
            No PTA dues invoices have been generated for {access.schoolWide ? "this school" : "your PTAs"}.
            {canManage
              ? " Enable dues on a tier in Setup, then issue them above."
              : " Ask an administrator to issue dues once configured."}
          </p>
        </div>
      ) : (
        <>
          {/* ── Summary strip · 4 cards (Expected featured, Collected, Outstanding, Aged) ── */}
          <div className="mb-8 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <SumCard
              featured
              label="Expected"
              value={s.expected}
              detail={`Across ${countInstances(report.tiers)} PTAs`}
            />
            <SumCard
              label="Collected to date"
              value={s.collected}
              detail={`${s.collectedPct}% of expected`}
              tone="green"
            />
            <SumCard
              label="Outstanding"
              value={s.outstanding}
              detail="Still to collect"
              tone="terra"
            />
            <SumCard
              label="Aged · over 30 days"
              value={s.aged}
              detail={`${report.aged.length} ${report.aged.length === 1 ? "family" : "families"} · escalate`}
              tone="warn"
            />
          </div>

          {/* ── Per-tier collection cards ── */}
          <div className="space-y-5">
            {report.tiers.map((t) => (
              <TierCard key={t.tierType} tier={t} />
            ))}
          </div>

          {/* ── Aged escalation queue ── */}
          {report.aged.length > 0 && (
            <section className="mt-8 rounded-2xl border border-terra bg-terra-bg p-6">
              <div className="mb-4 border-b border-terra pb-3">
                <h3 className="font-display text-lg font-semibold text-navy">
                  Aged <em className="italic text-terra">over 30 days</em> · escalation queue
                </h3>
                <p className="mt-1 text-[12px] text-navy-2">
                  {report.aged.length} {report.aged.length === 1 ? "family" : "families"} ·{" "}
                  <b className="text-terra">{ghs(s.aged)}</b> outstanding · oldest{" "}
                  {Math.max(...report.aged.map((a) => a.ageDays))} days.
                </p>
              </div>
              <div className="space-y-2.5">
                {report.aged.map((a) => (
                  <AgedRow key={a.duesInvoiceId} row={a} canRecordPayment={canRecordPayment} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

const ACCENT_ICON: Record<DuesAccent, string> = {
  navy: "bg-navy text-bg",
  gold: "bg-gold text-navy",
  green: "bg-green text-bg",
  terra: "bg-terra text-bg",
};

function ghs(n: number): string {
  return `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function countInstances(tiers: DuesTierReport[]): number {
  return tiers.reduce((n, t) => n + t.instances.length, 0);
}

/** One summary tile. Featured = navy (no-alpha discipline: gold-soft label, white/10 rules). */
function SumCard({
  label,
  value,
  detail,
  featured = false,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  featured?: boolean;
  tone?: "green" | "terra" | "warn";
}) {
  if (featured) {
    return (
      <div className="rounded-xl border border-navy bg-navy p-5">
        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-gold-soft">{label}</div>
        <div className="mt-1.5 font-display text-2xl font-semibold text-bg">{ghs(value)}</div>
        <div className="mt-1 text-[11px] text-[rgba(232,212,184,0.65)]">{detail}</div>
      </div>
    );
  }
  const valueTone =
    tone === "terra" ? "text-terra" : tone === "warn" ? "text-warn" : "text-navy";
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">{label}</div>
      <div className={`mt-1.5 font-display text-2xl font-semibold ${valueTone}`}>{ghs(value)}</div>
      <div className="mt-1 text-[11px] text-navy-3">{detail}</div>
    </div>
  );
}

/** A collection status pill — reuses the InvoicesTable vocabulary (PAID green / PARTIAL warn / UNPAID terra). */
function Bar({ pct, tone }: { pct: number; tone: "green" | "warn" | "terra" }) {
  const fill = tone === "green" ? "bg-green" : tone === "warn" ? "bg-warn" : "bg-terra";
  return (
    <div className="h-2 w-full overflow-hidden rounded-pill bg-border">
      <div className={`h-full rounded-pill ${fill}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}
function barTone(pct: number): "green" | "warn" | "terra" {
  return pct >= 85 ? "green" : pct >= 60 ? "warn" : "terra";
}

function TierCard({ tier }: { tier: DuesTierReport }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="grid grid-cols-1 items-center gap-4 border-b border-border bg-bg px-6 py-4 sm:grid-cols-[auto_1fr_auto_180px]">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg font-display text-sm font-bold ${ACCENT_ICON[tier.accent]}`}>
          {tier.label.split(" ").map((w) => w[0]).join("").slice(0, 2)}
        </div>
        <div>
          <h4 className="font-display text-lg font-semibold text-navy">
            {tier.label} <em className="italic text-gold">dues</em>
          </h4>
          <div className="mt-0.5 text-[11px] text-navy-3">
            <b className="text-navy">{tier.instances.length}</b>{" "}
            {tier.kind === "buckets" ? "PTA" : tier.instances.length === 1 ? "PTA" : "PTAs"} ·{" "}
            <b className="text-navy">{tier.charges}</b> charges · expected{" "}
            <b className="text-navy">{ghs(tier.expected)}</b>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">Collected</div>
          <div className="font-display text-lg font-semibold text-navy">{ghs(tier.collected)}</div>
        </div>
        <div>
          <Bar pct={tier.collectedPct} tone={barTone(tier.collectedPct)} />
          <div className="mt-1 text-right text-[10px] font-semibold text-navy-3">
            <b className="text-navy">{tier.collectedPct}%</b> · {ghs(tier.outstanding)} outstanding
          </div>
        </div>
      </div>

      {tier.kind === "buckets" ? (
        <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-3">
          <BucketCell label="Paid in full" count={tier.paidCount} tone="green" />
          <BucketCell label="Partial" count={tier.partialCount} tone="warn" />
          <BucketCell label="Unpaid" count={tier.unpaidCount} tone="terra" />
        </div>
      ) : (
        <div className="divide-y divide-border">
          {tier.instances.map((inst) => (
            <div
              key={inst.ptaId}
              className="grid grid-cols-1 items-center gap-3 px-6 py-3 sm:grid-cols-[180px_1fr_120px_120px]"
            >
              <div className="font-display text-[13px] font-semibold text-navy">{inst.label}</div>
              <Bar pct={inst.collectedPct} tone={barTone(inst.collectedPct)} />
              <div className="text-right">
                <div className="font-mono text-[13px] font-semibold text-green">{ghs(inst.collected)}</div>
                <div className="text-[9px] uppercase tracking-[0.08em] text-navy-3">
                  Collected · {inst.collectedPct}%
                </div>
              </div>
              <div className="text-right">
                <div className={`font-mono text-[13px] font-semibold ${inst.outstanding > 0 ? "text-terra" : "text-navy-3"}`}>
                  {inst.outstanding > 0 ? ghs(inst.outstanding) : "—"}
                </div>
                <div className="text-[9px] uppercase tracking-[0.08em] text-navy-3">
                  {inst.unpaidCount + inst.partialCount} owing
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BucketCell({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "green" | "warn" | "terra";
}) {
  const valueTone = tone === "green" ? "text-green" : tone === "warn" ? "text-warn" : "text-terra";
  return (
    <div className="bg-surface px-6 py-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">{label}</div>
      <div className={`mt-1 font-display text-2xl font-semibold ${valueTone}`}>{count}</div>
      <div className="text-[10px] text-navy-3">{count === 1 ? "family" : "families"}</div>
    </div>
  );
}

function AgedRow({ row, canRecordPayment }: { row: DuesAgedRow; canRecordPayment: boolean }) {
  return (
    <div className="rounded-lg border border-terra bg-surface px-4 py-3">
      <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[1fr_auto_auto]">
        <div>
          <div className="text-[13px] font-semibold text-navy">
            {row.studentName} <span className="font-normal text-navy-3">· {row.ptaLabel}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-navy-3">
            {row.tierLabel} dues · invoice <span className="font-mono">{row.invoiceNumber}</span>
            {row.hasOtherArrears && (
              <span className="ml-2 rounded-pill border border-terra bg-terra-bg px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] text-terra">
                Also owes elsewhere
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[13px] font-semibold text-terra">{ghs(row.outstanding)}</div>
          <div className="text-[10px] text-navy-3">{row.ageDays} days old</div>
        </div>
        {canRecordPayment && (
          <RecordPaymentForm
            studentId={row.subjectStudentId}
            outstanding={[
              { id: row.duesInvoiceId, invoiceNumber: row.invoiceNumber, balance: row.outstanding },
            ]}
          />
        )}
      </div>
    </div>
  );
}
