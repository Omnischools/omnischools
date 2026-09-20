import { requireParent } from "@/lib/auth/server";
import { loadParentPortal } from "@/lib/parent/parent-portal-data";
import {
  loadParentBoarding,
  type ParentBoarderChild,
  type ParentBoardingDate,
  type ParentVisitingDay,
  type ParentVisitingPolicy,
} from "@/lib/parent/parent-boarding-data";
import { loadParentExeats, type ParentExeatRow } from "@/lib/parent/parent-exeat-data";
import { relationshipLabel, parentLongDate } from "@/lib/wassce/parent-copy";
import { ParentHeader, ParentNav } from "../parent-chrome";
import { ExeatRequestForm } from "./exeat-request";
import { ExeatWithdrawButton } from "./exeat-withdraw";

/**
 * INCR-BOARD · the parent-portal Boarding tab (lean v1) — a boarder's guardian sees their own child's House/
 * dormitory + prefect badge, the school's visiting days + policy, and resumption/vacation dates. Read-only.
 * Gates on the child being a BOARDER — DAY / DEBOARDINIZED children collapse to a neutral "not a boarder"
 * state, never revealing a removal (the discipline ledger stays parent_deny). Placement is own-child only
 * (the projection never enumerates the dorm roster). No bunk number (owner call), no exeat (phase 2), no
 * gateway/write. URL /boarding; the tab shows only at boarding schools (ParentNav gates on schoolType).
 */
export const dynamic = "force-dynamic";

const longDay = (iso: string): string => parentLongDate(new Date(`${iso}T00:00:00Z`));

export default async function ParentBoardingPage() {
  const { user, school } = await requireParent();
  const [data, boarding, exeats] = await Promise.all([
    loadParentPortal(school.id, user.id),
    loadParentBoarding(school.id, user.id),
    loadParentExeats(school.id, user.id),
  ]);
  const child = data.children[0] ?? null;
  const guardianDisplay = data.guardianName ?? user.name ?? "Parent";
  const relation = data.guardianRelationship ? relationshipLabel(data.guardianRelationship) : "Parent";

  return (
    <div className="mx-auto max-w-[980px]">
      <ParentHeader
        schoolName={school.name}
        childName={child?.fullName ?? null}
        guardianDisplay={guardianDisplay}
        relation={relation}
      />
      <ParentNav active="Boarding" />

      <div className="px-7 pb-9 pt-6">
        {!child ? (
          <NoChild />
        ) : !boarding.hasBoarder ? (
          <NotABoarder firstName={child.firstName} />
        ) : (
          <div className="space-y-6">
            {boarding.boarders.map((b, i) => (
              <PlacementCard key={i} boarder={b} />
            ))}
            <Leave boarders={boarding.boarders} exeats={exeats} />
            <Visiting days={boarding.visitingDays} policy={boarding.visitingPolicy} />
            <TermDates dates={boarding.termDates} />
          </div>
        )}
      </div>
    </div>
  );
}

/** No portal-linked child — a linking issue (mirrors the sibling tabs). */
function NoChild() {
  return (
    <div className="rounded-xl border border-border bg-surface px-6 py-8 text-center text-[13px] leading-relaxed text-navy-2">
      No student is linked to this portal yet. Please contact the school office.
    </div>
  );
}

/** Neutral not-a-boarder state — DAY and (silently) DEBOARDINIZED both land here; no removal is ever shown. */
function NotABoarder({ firstName }: { firstName: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-6 py-8 text-center">
      <div className="font-display text-base font-medium text-navy">{firstName} is a day student.</div>
      <div className="mt-1.5 text-[13px] leading-relaxed text-navy-2">
        Boarding information appears here for boarders.
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── placement ── */

function PlacementCard({ boarder }: { boarder: ParentBoarderChild }) {
  if (boarder.state === "AWAITING") {
    return (
      <section className="rounded-xl border border-border bg-surface px-[26px] py-[22px]">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-navy-3">
          Boarding placement
        </div>
        <p className="text-[13px] leading-relaxed text-navy-2">
          {boarder.firstName}&apos;s bunk hasn&apos;t been assigned yet. The House will place {boarder.firstName}{" "}
          at resumption.
        </p>
      </section>
    );
  }
  return (
    <section
      className="rounded-xl border border-gold-soft px-[26px] py-[22px]"
      style={{ background: "linear-gradient(135deg,#F5EBDC 0%,#FAF7F2 100%)" }}
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-navy-3">
        Boarding placement
      </div>
      <h2 className="font-display text-xl font-medium leading-snug text-navy">
        {boarder.firstName} boards in <em className="text-gold">{boarder.houseName}</em>.
      </h2>
      {boarder.dormName && (
        <p className="mt-1 font-mono text-[13px] text-navy-2">{boarder.dormName}</p>
      )}
      {boarder.prefectLabel && (
        <div className="mt-3">
          <span className="inline-flex items-center rounded-pill bg-gold px-2.5 py-[3px] text-[11px] font-semibold text-navy">
            {boarder.prefectLabel}
          </span>
          <p className="mt-1.5 text-xs leading-relaxed text-navy-3">
            An honour role in {boarder.houseName}. Well done, {boarder.firstName}.
          </p>
        </div>
      )}
    </section>
  );
}

/* ─────────────────────────────────────────────────────────── leave / exeat ── */

/** The "Leave / exeat" section — the request form + the child's exeat status list (own child only). */
function Leave({ boarders, exeats }: { boarders: ParentBoarderChild[]; exeats: ParentExeatRow[] }) {
  const hasOpenRequest = exeats.some((e) => e.isOpen);
  // Only an ACTIVE boarder can request leave (the fn refuses a non-active student — A5). A withdrawn-but-
  // still-BOARDER ward simply isn't offered the form (never revealing why); the status list still shows below.
  const activeWards = boarders.filter((b) => b.isActive);
  return (
    <div className="space-y-4">
      {activeWards.length > 0 && (
        <ExeatRequestForm
          wards={activeWards.map((b) => ({ studentId: b.studentId, firstName: b.firstName }))}
          hasOpenRequest={hasOpenRequest}
        />
      )}
      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border bg-bg px-6 py-[18px]">
          <h3 className="font-display text-base font-medium text-navy">Leave requests</h3>
          <div className="text-[11px] text-navy-3">Your ward&apos;s exeats</div>
        </div>
        {exeats.length === 0 ? (
          <div className="px-6 py-6 text-[13px] leading-relaxed text-navy-2">No leave requests yet.</div>
        ) : (
          exeats.map((e) => <ExeatRow key={e.id} exeat={e} />)
        )}
      </section>
    </div>
  );
}

function ExeatRow({ exeat }: { exeat: ParentExeatRow }) {
  return (
    <div className="border-b border-border px-6 py-4 last:border-b-0">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-display text-[15px] font-medium text-navy">{exeat.statusLabel}</span>
        <span className="text-right font-mono text-[11px] text-navy-3">{exeat.refCode}</span>
      </div>
      <div className="mt-1 text-[13px] leading-relaxed text-navy-2">{exeat.detail}</div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-navy-3">
        {exeat.houseName && <span>{exeat.houseName}</span>}
        {exeat.milestones.map((m, i) => (
          <span key={i}>
            {m.label}: <span className="font-mono text-navy-2">{m.value}</span>
          </span>
        ))}
      </div>
      {/* Phase 3-A: the card PDF is offered only for a download-eligible row (cardReady mirrors the fn's
          eligibility gate — advisory; the /api route + parent_exeat_card fn are authoritative). */}
      {exeat.cardReady && (
        <a
          href={`/api/parent/exeat-card/${exeat.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2.5 inline-block text-xs font-bold text-gold"
        >
          Download exeat card →
        </a>
      )}
      {/* Phase 3-B: withdraw is offered only on a still-REQUESTED portal request (canWithdraw — advisory;
          parent_withdraw_exeat is authoritative). On success the row flips to the "Withdrawn" label. */}
      {exeat.canWithdraw && <ExeatWithdrawButton exeatId={exeat.id} />}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── visiting ── */

function Visiting({
  days,
  policy,
}: {
  days: ParentVisitingDay[];
  policy: ParentVisitingPolicy | null;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border bg-bg px-6 py-[18px]">
        <h3 className="font-display text-base font-medium text-navy">Visiting days</h3>
        <div className="text-[11px] text-navy-3">Approved visitors only</div>
      </div>
      {days.length === 0 ? (
        <div className="px-6 py-6 text-[13px] leading-relaxed text-navy-2">
          No visiting days have been published for this term yet.
        </div>
      ) : (
        days.map((d, i) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-border px-6 py-4 last:border-b-0"
          >
            <span className="font-display text-[15px] font-medium text-navy">{d.label}</span>
            <span className="text-right font-mono text-[13px] text-navy-2">{longDay(d.date)}</span>
          </div>
        ))
      )}
      {policy && (
        <div className="border-t border-border bg-bg px-6 py-4">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-navy-3">
            Visiting policy
          </div>
          <dl className="space-y-1.5 text-[13px]">
            <PolicyRow label="Cadence" value={policy.cadence} />
            <PolicyRow label="Hours" value={policy.hours} />
            <PolicyRow label="Lunch served" value={policy.lunch} />
            <PolicyRow label="Dormitories" value={policy.dormitories} />
            <PolicyRow label="Who may visit" value={policy.approvedVisitors} />
          </dl>
        </div>
      )}
    </section>
  );
}

function PolicyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-navy-3">{label}</dt>
      <dd className="text-right font-medium text-navy-2">{value}</dd>
    </div>
  );
}

/* ────────────────────────────────────────────────────── resumption/vacation ── */

function TermDates({ dates }: { dates: ParentBoardingDate[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border bg-bg px-6 py-[18px]">
        <h3 className="font-display text-base font-medium text-navy">Resumption &amp; vacation</h3>
        <div className="text-[11px] text-navy-3">Boarding term dates</div>
      </div>
      {dates.length === 0 ? (
        <div className="px-6 py-6 text-[13px] leading-relaxed text-navy-2">
          Your school hasn&apos;t published its boarding term dates yet.
        </div>
      ) : (
        dates.map((d, i) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-border px-6 py-4 last:border-b-0"
          >
            <span className="text-[15px] text-navy">{d.label}</span>
            <span className="text-right font-mono text-[13px] text-navy-2">{longDay(d.date)}</span>
          </div>
        ))
      )}
    </section>
  );
}
