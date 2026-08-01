import { requireParent } from "@/lib/auth/server";
import { loadParentPortal } from "@/lib/parent/parent-portal-data";
import {
  loadParentPta,
  type ParentPtaAttendance,
  type ParentPtaAttendanceStatus,
  type ParentPtaDue,
  type ParentPtaMembership,
  type ParentPtaTier,
} from "@/lib/parent/parent-pta-data";
import { relationshipLabel } from "@/lib/wassce/parent-copy";
import { ParentHeader, ParentNav } from "../parent-chrome";

/**
 * INCR-55a · the parent-portal PTA tab — the PARTICIPATION slice (Your PTAs · Your dues · Your
 * attendance). Same PARENT session gate as the other (parent) routes; the child is resolved from the
 * SESSION (never a URL id). Every section is an honest known-zero empty (no fabricated PTA / amount /
 * meeting) — the reader (parent-pta-data) is the column guard. Read-only by construction (no server
 * action). The composition is left OPEN below for 55b to append Officers + Adopted minutes.
 */
export const dynamic = "force-dynamic";

const CARD_GRADIENT = "linear-gradient(135deg,#F5EBDC 0%,#FAF7F2 100%)";

const TIER_CHIP: Record<ParentPtaTier, string> = {
  FORM: "bg-navy text-bg",
  HOUSE: "bg-gold-bg text-navy",
  GENERAL: "bg-gold text-navy",
};
const TIER_LABEL: Record<ParentPtaTier, string> = {
  FORM: "Form",
  HOUSE: "House",
  GENERAL: "General",
};

export default async function ParentPtaPage() {
  const { user, school } = await requireParent();
  const [data, pta] = await Promise.all([
    loadParentPortal(school.id, user.id),
    loadParentPta(school.id, user.id),
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
      <ParentNav active="PTA" />

      <div className="px-7 pb-9 pt-6">
        {!child ? (
          <NoChild />
        ) : (
          <div className="space-y-6">
            <Memberships memberships={pta.memberships} />
            <Dues dues={pta.dues} />
            <Attendance attendance={pta.attendance} />
            {/* 55b appends: Officers (membership-scoped matrix) + Adopted minutes here. */}
          </div>
        )}
      </div>
    </div>
  );
}

/** No portal-linked child — a linking issue, not a PTA fact (mirrors the WASSCE/Sickbay tabs). */
function NoChild() {
  return (
    <div className="rounded-xl border border-border bg-surface px-6 py-8 text-center text-[13px] leading-relaxed text-navy-2">
      No student is linked to this portal yet. Please contact the school office.
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────── Your PTAs ── */

function Memberships({ memberships }: { memberships: ParentPtaMembership[] }) {
  return (
    <section
      className="rounded-xl border border-gold-soft px-6 py-[22px]"
      style={{ background: CARD_GRADIENT }}
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-navy-3">
        Your parent association
      </div>
      <div className="font-display text-[20px] font-medium leading-tight text-navy">Your PTAs</div>
      {memberships.length === 0 ? (
        <p className="mt-3.5 border-t border-gold-soft pt-3.5 text-[13px] leading-relaxed text-navy-2">
          You&apos;re not a member of any active PTA yet. Your PTAs will appear here once the school sets
          them up.
        </p>
      ) : (
        <div className="mt-3.5 flex flex-col gap-2.5 border-t border-gold-soft pt-3.5">
          {memberships.map((m, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <div className="font-display text-[15px] font-medium text-navy">{m.ptaName}</div>
              <span
                className={
                  "inline-flex items-center rounded-pill px-2.5 py-[3px] text-[11px] font-semibold " +
                  TIER_CHIP[m.tier]
                }
              >
                {TIER_LABEL[m.tier]}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────── Your dues ── */

function Dues({ dues }: { dues: ParentPtaDue[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border bg-bg px-6 py-[18px]">
        <h3 className="font-display text-base font-medium text-navy">Your dues</h3>
        <div className="text-[11px] text-navy-3">What the PTA has billed for your family</div>
      </div>
      {dues.length === 0 ? (
        <div className="px-6 py-6 text-[13px] leading-relaxed text-navy-2">
          No PTA dues have been billed to you yet.
        </div>
      ) : (
        <>
          {dues.map((d, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-border px-6 py-4 last:border-b-0"
            >
              <div>
                <div className="mb-0.5 font-display text-[15px] font-medium text-navy">{d.ptaName}</div>
                <div className="text-xs text-navy-3">{d.periodLabel}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[15px] font-semibold text-navy">{d.amountBilled}</span>
                <span className="inline-flex items-center rounded-pill border border-border bg-bg px-2.5 py-[3px] text-[11px] font-semibold text-navy-3">
                  Billed
                </span>
              </div>
            </div>
          ))}
          <div className="border-t border-border bg-bg px-6 py-3.5 text-[11px] leading-relaxed text-navy-3">
            You&apos;ll get a receipt link by SMS when a dues payment is recorded.
          </div>
        </>
      )}
    </section>
  );
}

/* ───────────────────────────────────────────────────────────── Your attendance ── */

const STATUS_PILL: Record<ParentPtaAttendanceStatus, string> = {
  Present: "bg-green-bg text-green",
  Late: "bg-gold text-navy",
  Absent: "bg-terra-bg text-terra",
};

function Attendance({ attendance }: { attendance: ParentPtaAttendance[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border bg-bg px-6 py-[18px]">
        <h3 className="font-display text-base font-medium text-navy">Your attendance</h3>
        <div className="text-[11px] text-navy-3">Meetings that have closed · your own attendance only</div>
      </div>
      {attendance.length === 0 ? (
        <div className="px-6 py-6 text-[13px] leading-relaxed text-navy-2">
          No closed PTA meetings yet. Once a meeting closes, your attendance will show here.
        </div>
      ) : (
        attendance.map((a, i) => (
          <div
            key={i}
            className="grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-border px-6 py-4 last:border-b-0"
          >
            <div className="font-mono text-xs font-semibold text-navy-3">{a.meetingDateLabel}</div>
            <div>
              <div className="font-display text-[15px] font-medium text-navy">{a.meetingLabel}</div>
              <div className="text-xs text-navy-3">{a.ptaName}</div>
            </div>
            <span
              className={
                "inline-flex items-center rounded-pill px-[11px] py-[5px] text-[11px] font-semibold " +
                STATUS_PILL[a.status]
              }
            >
              {a.status}
            </span>
          </div>
        ))
      )}
    </section>
  );
}
