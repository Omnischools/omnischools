import { requireParent } from "@/lib/auth/server";
import { loadParentPortal } from "@/lib/parent/parent-portal-data";
import {
  loadParentBilling,
  type BillStatus,
  type ParentBillingChild,
  type ParentBillingInvoice,
  type ParentBillingReceipt,
} from "@/lib/parent/parent-billing-data";
import { relationshipLabel } from "@/lib/wassce/parent-copy";
import { ParentHeader, ParentNav } from "../parent-chrome";

/**
 * INCR-BILL · the parent-portal Billing ("Fees") tab — a parent's read of their OWN children's fee status
 * (reader is parent-billing-data, the column-guard projection). Same PARENT session gate; children resolved
 * from the SESSION. READ-ONLY — no gateway, no "pay now"; a calm offline how-to-pay note instead. Every
 * figure derives from real invoices (R90): no fabricated GHS 0 hero; DRAFT/VOIDED invoices excluded; the
 * discount shows only as a net scalar (never the sibling-rank mechanic). URL /statement (staff own /fees + /billing).
 */
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<BillStatus, string> = {
  Paid: "bg-green-bg text-green",
  "Partly paid": "bg-gold-bg text-navy",
  Unpaid: "bg-warn-bg text-warn",
  Overdue: "bg-terra-bg text-terra",
  Covered: "bg-bg text-navy-3",
};

export default async function ParentStatementPage() {
  const { user, school } = await requireParent();
  const [data, billing] = await Promise.all([
    loadParentPortal(school.id, user.id),
    loadParentBilling(school.id, user.id),
  ]);
  const headerChild = data.children[0] ?? null;
  const guardianDisplay = data.guardianName ?? user.name ?? "Parent";
  const relation = data.guardianRelationship ? relationshipLabel(data.guardianRelationship) : "Parent";

  const children = billing.children;
  const multi = children.length > 1;

  return (
    <div className="mx-auto max-w-[980px]">
      <ParentHeader
        schoolName={school.name}
        childName={headerChild?.fullName ?? null}
        guardianDisplay={guardianDisplay}
        relation={relation}
      />
      <ParentNav active="Fees" />

      <div className="px-7 pb-9 pt-6">
        {children.length === 0 ? (
          <NoChild />
        ) : (
          <div className="space-y-7">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-gold">
                {school.name} · Fees
              </div>
              <h2 className="mt-1 font-display text-2xl font-medium tracking-[-0.018em] text-navy">
                Your <em className="text-gold">fee statement</em>
              </h2>
            </div>

            {multi && (
              <section className="rounded-xl border border-gold-soft bg-gold-bg px-6 py-[18px]">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-navy-3">
                  Across your children
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-[11px] text-navy-2">Total outstanding</span>
                  <span
                    className={
                      "font-display text-[26px] font-semibold " +
                      (billing.totalOutstandingValue > 0 ? "text-terra" : "text-green")
                    }
                  >
                    {billing.totalOutstanding}
                  </span>
                </div>
              </section>
            )}

            {children.map((c, i) => (
              <ChildBlock key={i} child={c} showName={multi} />
            ))}

            <HowToPay />
          </div>
        )}
      </div>
    </div>
  );
}

/** No portal-linked child — a linking issue, not a fee fact (mirrors the sibling tabs). */
function NoChild() {
  return (
    <div className="rounded-xl border border-border bg-surface px-6 py-8 text-center text-[13px] leading-relaxed text-navy-2">
      No student is linked to this portal yet. Please contact the school office.
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── per-child block ── */

function ChildBlock({ child, showName }: { child: ParentBillingChild; showName: boolean }) {
  const owes = child.outstandingValue > 0;
  return (
    <section className="space-y-4">
      {showName && (
        <h3 className="font-display text-lg font-medium text-navy">{child.name}</h3>
      )}

      {/* balance triad */}
      <div className="grid grid-cols-3 gap-3">
        <Tile label="Billed" value={child.billed} />
        <Tile label="Paid" value={child.paid} />
        <Tile
          label="Outstanding"
          value={owes ? child.outstanding : "GHS 0.00 — paid up"}
          valueClass={owes ? "text-terra" : "text-green"}
        />
      </div>

      {child.invoices.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-6 py-6 text-center text-[13px] leading-relaxed text-navy-2">
          The school hasn&apos;t issued any fees for {child.name.split(" ")[0]} yet. Bills and balance will
          appear here once it does.
        </div>
      ) : (
        <div className="space-y-3">
          {child.invoices.map((inv, i) => (
            <InvoiceCard key={i} inv={inv} />
          ))}
        </div>
      )}

      {child.receipts.length > 0 && <Receipts receipts={child.receipts} />}
    </section>
  );
}

function Tile({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-navy-3">{label}</div>
      <div className={"mt-1 font-display text-[19px] font-semibold " + (valueClass ?? "text-navy")}>
        {value}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── invoice card ── */

function InvoiceCard({ inv }: { inv: ParentBillingInvoice }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-start justify-between gap-3 border-b border-border bg-bg px-5 py-3.5">
        <div>
          <div className="font-display text-[15px] font-medium text-navy">
            {inv.termLabel ? `${inv.termLabel} · ${inv.academicYear}` : inv.academicYear}
          </div>
          <div className="font-mono text-[11px] text-navy-3">
            {inv.invoiceNumber}
            {inv.dueLabel ? ` · due ${inv.dueLabel}` : ""}
          </div>
        </div>
        <span
          className={
            "inline-flex items-center rounded-pill px-2.5 py-[3px] text-[11px] font-semibold " +
            STATUS_TONE[inv.status]
          }
        >
          {inv.status}
        </span>
      </div>

      {inv.lineItems.length > 0 && (
        <div className="divide-y divide-border px-5">
          {inv.lineItems.map((li, i) => (
            <div key={i} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
              <span className="text-navy-2">
                {li.description}
                {li.isOptional && (
                  <span className="ml-2 rounded-pill bg-bg px-1.5 py-[1px] text-[10px] text-navy-3">
                    optional
                  </span>
                )}
              </span>
              <span className="font-mono text-navy-2">{li.amount}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 border-t border-border px-5 py-3 text-center">
        <Mini label="Billed" value={inv.billed} />
        <Mini label="Paid" value={inv.paid} />
        <Mini label="Balance" value={inv.outstanding} valueClass="font-semibold text-navy" />
      </div>
      {inv.discount && (
        <div className="border-t border-border bg-bg px-5 py-2 text-right text-[11px] text-navy-3">
          Discount applied <span className="font-mono text-green">−{inv.discount}</span>
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-navy-3">{label}</div>
      <div className={"font-mono text-[13px] " + (valueClass ?? "text-navy-2")}>{value}</div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── receipts list ── */

function Receipts({ receipts }: { receipts: ParentBillingReceipt[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border bg-bg px-5 py-3">
        <h4 className="font-display text-sm font-medium text-navy">Payments &amp; receipts</h4>
      </div>
      {receipts.map((r, i) => (
        <div
          key={i}
          className={
            "grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-border px-5 py-3 last:border-b-0 " +
            (r.voided ? "opacity-60" : "")
          }
        >
          <span className="font-mono text-[11px] text-navy-3">{r.date}</span>
          <div>
            <div className="text-[13px] font-medium text-navy">{r.amount}</div>
            <div className="text-[11px] text-navy-3">
              {r.method}
              {r.voidLabel ? ` · ${r.voidLabel}` : ""}
            </div>
          </div>
          {r.receiptLink ? (
            <a
              href={r.receiptLink}
              className="font-mono text-[11px] font-semibold text-gold hover:underline"
            >
              {r.receiptNumber} →
            </a>
          ) : (
            <span className="font-mono text-[11px] text-navy-3">{r.receiptNumber}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── how to pay ── */

function HowToPay() {
  return (
    <section className="rounded-xl border border-border bg-surface px-[26px] py-[22px]">
      <h3 className="font-display text-base font-medium text-navy">How to pay</h3>
      <p className="mt-2 text-[13px] leading-relaxed text-navy-2">
        You can pay by Mobile Money, bank transfer, or in person at the school office. When the school records
        your payment, your receipt appears here.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-navy-3">
        Bring your child&apos;s name and student number when you pay at the office.
      </p>
    </section>
  );
}
