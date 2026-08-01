import { requireParent } from "@/lib/auth/server";
import { loadParentPortal } from "@/lib/parent/parent-portal-data";
import {
  loadParentPta,
  type ParentPtaActionItem,
  type ParentPtaAgendaItem,
  type ParentPtaAttendance,
  type ParentPtaAttendanceStatus,
  type ParentPtaClassification,
  type ParentPtaDue,
  type ParentPtaMembership,
  type ParentPtaMinutes,
  type ParentPtaOfficer,
  type ParentPtaResolution,
  type ParentPtaTier,
} from "@/lib/parent/parent-pta-data";
import { relationshipLabel } from "@/lib/wassce/parent-copy";
import { ParentHeader, ParentNav } from "../parent-chrome";

/**
 * INCR-55a/b · the parent-portal PTA tab — participation (Your PTAs · Your dues · Your attendance) +
 * records & directory (PTA officers · Adopted minutes, 55b). Same PARENT session gate as the other
 * (parent) routes; the child is resolved from the SESSION (never a URL id). Every section is an honest
 * known-zero empty (no fabricated PTA / officer / minutes) — the reader (parent-pta-data) is the column
 * guard. Read-only by construction (no server action). The 55b records sections are omitted when the
 * parent belongs to no PTA (the Memberships empty already tells that story — no stacked "no PTA" copy).
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
            {pta.memberships.length > 0 && (
              <>
                <Officers officers={pta.officers} />
                <AdoptedMinutes minutes={pta.minutes} />
              </>
            )}
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

/* ───────────────────────────────────────────────────────────── PTA officers ── */
/* 55b · Section A — current holders of the parent's OWN PTAs, grouped by PTA (Lucy A). */

const PILL = "inline-flex items-center rounded-pill px-2.5 py-[3px] text-[11px] font-semibold ";

function Officers({ officers }: { officers: ParentPtaOfficer[] }) {
  // The reader emits officers already sorted (tier → PTA → office). Group consecutive rows by PTA.
  const groups: { ptaName: string; tier: ParentPtaTier; rows: ParentPtaOfficer[] }[] = [];
  for (const o of officers) {
    const last = groups[groups.length - 1];
    if (last && last.ptaName === o.ptaName && last.tier === o.tier) last.rows.push(o);
    else groups.push({ ptaName: o.ptaName, tier: o.tier, rows: [o] });
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border bg-bg px-6 py-[18px]">
        <h3 className="font-display text-base font-medium text-navy">PTA officers</h3>
        <div className="text-[11px] text-navy-3">Who leads the PTAs your family belongs to</div>
      </div>
      {officers.length === 0 ? (
        <div className="px-6 py-6 text-[13px] leading-relaxed text-navy-2">
          No PTA officers have been recorded for your PTAs yet.
        </div>
      ) : (
        groups.map((g, gi) => (
          <div key={gi} className={gi > 0 ? "border-t border-border" : ""}>
            <div className="flex items-center justify-between gap-3 px-6 pb-2 pt-4">
              <div className="font-display text-[15px] font-medium text-navy">{g.ptaName}</div>
              <span className={PILL + TIER_CHIP[g.tier]}>{TIER_LABEL[g.tier]}</span>
            </div>
            {g.rows.map((o, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-border px-6 py-3.5 last:border-b-0"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-display text-[15px] font-medium text-navy">{o.office}</span>
                    {o.isYou && <span className={PILL + "bg-gold text-navy"}>You</span>}
                  </div>
                  <div className="text-xs text-navy-3">{o.holderName}</div>
                </div>
                <div className="font-mono text-xs text-navy-3">{o.term}</div>
              </div>
            ))}
          </div>
        ))
      )}
    </section>
  );
}

/* ─────────────────────────────────────────────────────────── Adopted minutes ── */
/* 55b · Section B — ADOPTED minutes of the parent's PTAs + subtree (Lucy B). Public record only. */

const CLASSIFICATION_CHIP: Record<ParentPtaClassification, string> = {
  Discussion: "bg-navy text-bg",
  Action: "bg-warn text-bg",
  Resolution: "bg-green text-bg",
};

function AdoptedMinutes({ minutes }: { minutes: ParentPtaMinutes[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border bg-bg px-6 py-[18px]">
        <h3 className="font-display text-base font-medium text-navy">Adopted minutes</h3>
        <div className="text-[11px] text-navy-3">Decisions from meetings of your PTAs, once adopted</div>
      </div>
      {minutes.length === 0 ? (
        <div className="px-6 py-6 text-[13px] leading-relaxed text-navy-2">
          No adopted PTA minutes yet. Once minutes from a meeting are adopted, they&apos;ll appear here.
        </div>
      ) : (
        minutes.map((m, i) => <MinutesBlock key={i} m={m} />)
      )}
    </section>
  );
}

function MinutesBlock({ m }: { m: ParentPtaMinutes }) {
  return (
    <div className="space-y-4 border-b border-border px-6 py-5 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-[15px] font-medium text-navy">{m.meetingLabel}</div>
          <div className="text-xs text-navy-3">{m.ptaName}</div>
          <div className="mt-0.5 font-mono text-xs text-navy-3">{m.meetingDateLabel}</div>
        </div>
        <span className={PILL + (m.quorumMet ? "bg-green-bg text-green" : "bg-warn-bg text-warn")}>
          {m.quorumMet ? "Quorum met" : "Quorum not met"}
        </span>
      </div>

      {m.agendaItems.length > 0 && (
        <div className="space-y-2.5">
          {m.agendaItems.map((a, i) => (
            <AgendaItem key={i} a={a} />
          ))}
        </div>
      )}

      {m.actionItems.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-navy-3">
            Action items
          </div>
          {m.actionItems.map((a, i) => (
            <ActionItem key={i} a={a} />
          ))}
        </div>
      )}

      {m.resolutions.map((r, i) => (
        <Resolution key={i} r={r} />
      ))}
    </div>
  );
}

function AgendaItem({ a }: { a: ParentPtaAgendaItem }) {
  return (
    <div className="rounded-lg border border-border bg-bg px-5 py-4">
      <div className="flex items-center gap-3">
        <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md bg-navy font-display text-[11px] font-bold text-bg">
          {a.order}
        </div>
        <div className="font-display text-[15px] font-medium text-navy">{a.title}</div>
        <span
          className={
            "ml-auto rounded-pill px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.04em] " +
            CLASSIFICATION_CHIP[a.classification]
          }
        >
          {a.classification}
        </span>
      </div>
      {a.narrative && (
        <p className="mt-2.5 text-[13px] leading-relaxed text-navy-2">{a.narrative}</p>
      )}
    </div>
  );
}

function ActionItem({ a }: { a: ParentPtaActionItem }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-bg px-4 py-3">
      <div>
        <div className="text-[13px] leading-relaxed text-navy">{a.description}</div>
        <div className="mt-0.5 text-xs text-navy-3">{a.owner}</div>
      </div>
      <span
        className={PILL + (a.status === "Completed" ? "bg-green-bg text-green" : "bg-gold-bg text-gold")}
      >
        {a.status}
      </span>
    </div>
  );
}

function Resolution({ r }: { r: ParentPtaResolution }) {
  const passed = r.result === "PASSED";
  return (
    <div className="space-y-3 rounded-xl border-[1.5px] border-green bg-green-bg px-6 py-5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-green">
          {r.resolutionNo}
        </div>
        {r.binding && (
          <span className="rounded-pill bg-green px-2.5 py-1 text-[9px] font-bold tracking-[0.06em] text-bg">
            Binding
          </span>
        )}
      </div>
      <div className="font-display text-base font-semibold text-navy">{r.title}</div>
      <div className="rounded-r-lg border-l-[3px] border-green bg-surface px-3.5 py-3 text-[13px] leading-relaxed text-navy-2">
        {r.body}
      </div>
      <div className="grid grid-cols-2 gap-3 border-t border-green pt-3 sm:grid-cols-4">
        <VoteTile label="In favour" value={r.votesFor} valueClass="text-green" />
        <VoteTile label="Against" value={r.votesAgainst} valueClass="text-terra" />
        <VoteTile label="Abstain" value={r.votesAbstain} valueClass="text-navy-3" />
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">Result</div>
          <div className={"font-display italic " + (passed ? "text-green" : "text-terra")}>
            {passed ? "PASSED" : "NOT PASSED"}
          </div>
        </div>
      </div>
    </div>
  );
}

function VoteTile({ label, value, valueClass }: { label: string; value: number; valueClass: string }) {
  return (
    <div>
      <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">{label}</div>
      <div className={"font-display text-xl font-semibold " + valueClass}>{value}</div>
    </div>
  );
}
