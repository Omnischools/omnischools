import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { BOARDING_ROLES } from "@/lib/access";
import { getVisitingBoard, type IndicatedArrival, type HouseRsvpCard, type ZoneCard } from "@/lib/boarding/visiting-data";
import type { ListMatchKind } from "@/lib/boarding/visiting";
import { HeaderActions, GateCheckPanel, VisitRowActions, ApprovedVisitorEditor } from "@/components/boarding/visiting-console";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function VisitingDayPage(props: {
  searchParams: Promise<{ date?: string; eventId?: string; student?: string }>;
}) {
  const searchParams = await props.searchParams;
  const { school, user } = await requireSchoolRole(BOARDING_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  const userId = current?.id ?? user.id;

  const dateIso = searchParams.date && DATE_RE.test(searchParams.date) ? searchParams.date : undefined;
  const eventId = searchParams.eventId && UUID_RE.test(searchParams.eventId) ? searchParams.eventId : undefined;
  const studentId = searchParams.student && UUID_RE.test(searchParams.student) ? searchParams.student : undefined;

  const board = await getVisitingBoard(school.id, roles, userId, { dateIso, eventId, studentId });
  const query = { eventId: board.eventId ?? undefined, date: dateIso };

  const daysLabel =
    board.daysAway == null
      ? ""
      : board.daysAway === 0
        ? "today · live"
        : board.daysAway > 0
          ? `in ${board.daysAway} day${board.daysAway === 1 ? "" : "s"}`
          : `${Math.abs(board.daysAway)} day${Math.abs(board.daysAway) === 1 ? "" : "s"} ago`;

  return (
    <div className="mx-auto max-w-page pb-16">
      <div className="mb-5">
        <Link
          href="/senior/boarding"
          className="text-[11px] font-semibold uppercase tracking-[0.16em] text-navy-3 hover:text-navy"
        >
          ← Boarding · Houses
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
          Boarding · Operations · Visiting Sunday
        </div>
        <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
          Visiting Sunday ·{" "}
          <em className="italic text-gold">the school&apos;s front door, opened monthly.</em>
        </h1>
        <div className="mb-3 mt-2 h-0.5 w-16 bg-gold" />
        <p className="max-w-2xl text-sm text-navy-3">
          Once a month — the {board.policy.cadence} — the gates open to parents and guardians from{" "}
          <b className="text-navy-2">{board.windowLabel}</b>. Lunch moves earlier ({board.policy.lunchTime}) to clear
          the dining hall; dormitories remain <b className="text-navy-2">{board.policy.dormitoriesRule.toLowerCase()}</b>.
          The Senior Housemaster runs this from the digital Visitor&apos;s Book — a replacement for the paper register the
          Student on Duty has held for sixty years. The gate is a <b className="text-navy-2">list-check, not a list-record</b>.
        </p>
      </div>

      {/* Context + actions */}
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-bg px-4 py-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">Visiting event</span>
        <span className="text-[11px] text-navy-3">
          {board.hasEvent ? <b className="font-bold text-navy-2">{board.dayLabel}</b> : "No visiting Sunday scheduled"}
          {board.hasEvent ? ` · ${daysLabel}` : ""}
          {board.formScopeLabel ? <> · <b className="font-bold text-gold">{board.formScopeLabel}</b></> : ""}
          {" · "}
          {board.policy.cadence}
        </span>
        <div className="ml-auto">
          <HeaderActions eventId={board.eventId} live={board.live} />
        </div>
      </div>

      {/* Countdown strip (gold) */}
      <div className="grid grid-cols-1 items-center gap-6 rounded-xl border border-gold-soft bg-gold-bg p-6 md:grid-cols-[auto_1fr_auto]">
        <div className="flex h-24 w-24 flex-col items-center justify-center rounded-2xl border-2 border-gold bg-surface">
          <div className="font-mono text-[9px] font-bold tracking-[0.16em] text-gold">{board.cal.day}</div>
          <div className="my-0.5 font-display text-[34px] font-semibold leading-none text-navy">{board.cal.num}</div>
          <div className="font-mono text-[10px] font-bold text-gold">{board.cal.mon}</div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
            Visiting Sunday · {daysLabel || "not scheduled"} · {board.windowLabel} window
          </div>
          <h3 className="mt-1 font-display text-2xl font-semibold leading-tight text-navy">
            {board.schoolName} opens its gate ·{" "}
            <em className="italic text-gold">{board.windowLabel}</em>
          </h3>
          <div className="mt-1 text-[12px] text-navy-2">
            <b className="font-bold text-navy">Lunch served {board.policy.lunchTime}</b> · visiting begins {board.policy.hoursStart}{" "}
            · supervised time in visitor zones · gate-close strict at {board.policy.hoursEnd}
          </div>
        </div>
        <div className="md:text-right">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
            {board.live ? "On campus now" : "RSVP'd families so far"}
          </div>
          <div className="mt-1 font-display text-[42px] font-semibold leading-none text-navy">
            <em className="italic text-gold">{board.live ? board.summary.onCampus : board.countdown.rsvpd}</em>
          </div>
          <div className="mt-1.5 text-[11px] text-navy-3">
            {board.live
              ? `${board.summary.arrivedTotal} arrived total · ${board.summary.overstaying} overstaying`
              : `${board.countdown.pctFamilies}% of boarders' families · window ${board.windowLabel}`}
          </div>
        </div>
      </div>

      {!board.hasBoarders ? (
        <div className="mt-6 rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center">
          <h2 className="font-display text-lg font-semibold text-navy">
            {board.hasEvent ? "No boarders you can operate" : "No visiting Sunday scheduled"}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-navy-3">
            {board.hasEvent
              ? "You are not assigned to any House with active boarders, or none are enrolled."
              : "Configure a VISITING calendar event to run the Visitor's Book for a visiting Sunday."}
          </p>
        </div>
      ) : (
        <>
          {/* Summary strip — 5 DERIVED cards */}
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <SumCard
              featured
              lab="Boarders expecting visitors"
              big={String(board.summary.rsvpd)}
              sub={`${board.countdown.pctFamilies}% of ${board.summary.expectedBoarders} in scope · ${board.summary.notRsvpd} not RSVP'd yet`}
            />
            <SumCard
              lab={board.live ? "Visitors on campus" : "RSVPs received"}
              big={String(board.live ? board.summary.onCampus : board.summary.rsvpd)}
              sub={board.live ? `${board.summary.arrivedTotal} arrived · ${board.summary.departed ?? 0} departed` : "Staff-entered · the indicated-arrivals list"}
            />
            <SumCard
              lab="Approved visitor names"
              big={String(board.summary.approvedNames)}
              sub={`${board.summary.avgPerBoarder} per boarder avg · max 6 names per student`}
            />
            <SumCard
              lab="New visitor approvals"
              big={String(board.summary.pendingApprovals)}
              sub="Pending HM review · Dean approves pastoral-sensitive"
            />
            <SumCard
              lab="Visitor zones"
              big={`${board.summary.zoneCount} zones`}
              sub={`${board.zones.map((z) => z.label).join(", ")} · ${board.summary.zoneCapTotal.toLocaleString()} cap total`}
            />
          </div>

          {/* RSVP-by-House */}
          <Section
            eyebrow={`RSVPs by House · running counter${board.formScopeLabel ? ` · ${board.formScopeLabel}` : ""}`}
            title={`${board.houses.length} House${board.houses.length === 1 ? "" : "s"}, ${board.houses.length} counters`}
            meta="Invitation 7 days before · reminder T-3 · T-1 · all derived, no counter stored"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {board.houses.map((h) => (
                <HouseRsvpCell key={h.id} h={h} />
              ))}
            </div>
          </Section>

          {/* Indicated arrivals + gate-check modal */}
          <Section
            eyebrow="Indicated arrivals · per-student · list-CHECK not list-RECORD"
            title="The Visitor's Book · matched to the approved list"
            meta={`${board.arrivals.length} recorded · phones masked · no photo/QR`}
            actions={
              <GateCheckPanel
                eventId={board.eventId}
                boarders={board.boarderOptions}
                approvedByStudent={board.approvedByStudent}
              />
            }
          >
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <div className="grid grid-cols-[1.2fr_1.6fr_90px_130px_auto] gap-3 border-b border-border bg-bg px-5 py-2.5 text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">
                <div>Student</div>
                <div>Visitor (masked)</div>
                <div>Relationship</div>
                <div>List check</div>
                <div className="text-right">Action</div>
              </div>
              {board.arrivals.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-navy-3">
                  No visits recorded yet — use <b>Gate check · record a visitor</b> to run the first list check.
                </p>
              ) : (
                board.arrivals.map((a) => <ArrivalRow key={a.visitId} a={a} query={query} />)
              )}
            </div>
          </Section>

          {/* Approved-visitor detail card + editor */}
          {board.focus && (
            <Section
              eyebrow="Approved visitors · per-student · max 6 · on student record"
              title="The list of names the gate verifies against"
              meta="HM-curated · parents nominate · Dean approves pastoral-sensitive"
            >
              <ApprovedVisitorEditor
                focus={board.focus}
                focusOptions={board.focusOptions}
                canManagePastoral={board.canManagePastoral}
                query={query}
              />
            </Section>
          )}

          {/* Visitor zones + occupancy */}
          <Section
            eyebrow="Visitor zones · where families meet students"
            title={`Three zones · ${board.summary.zoneCapTotal.toLocaleString()} capacity`}
            meta="Dormitories out of bounds · occupancy derived (ARRIVED-not-DEPARTED), never stored"
          >
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
              {board.zones.map((z) => (
                <ZoneCardView key={z.key} z={z} live={board.live} />
              ))}
            </div>
          </Section>

          {/* OOB + overstay reminder */}
          <Section eyebrow="Out of bounds · strict" title="The rule that keeps the day safe" meta="Overstay on-read · 16:15 HM · 16:30 Senior HM">
            <div className="flex flex-col gap-3.5 rounded-xl border-[1.5px] border-terra bg-terra-bg p-5 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-terra font-display text-lg font-semibold text-bg">
                OOB
              </div>
              <div className="flex-1">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-terra">
                  Dormitories &amp; staff quarters · out of bounds · strict
                </div>
                <h4 className="font-display text-[17px] font-semibold leading-tight text-navy">
                  No visitor may enter a dormitory <em className="italic text-terra">· or any staff bungalow</em>
                </h4>
                <p className="mt-1 text-[11px] text-navy-2">
                  Students may not sit in visitors&apos; cars. Beyond {board.policy.hoursEnd}, no visitor may remain on
                  campus. <b className="text-navy">Past 4:15 PM, an overstaying visitor is logged and the HM notified</b>;
                  past 4:30, the Senior HM intervenes. No discipline record is written (a notification, not a penalty).
                </p>
              </div>
            </div>

            {board.overstays.length > 0 && (
              <div className="mt-3 rounded-xl border border-terra bg-surface p-4">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-terra">
                  {board.overstays.length} overstaying now · on-read · HM console SMS
                </div>
                <div className="flex flex-col gap-1.5">
                  {board.overstays.map((o) => (
                    <div
                      key={o.visitId}
                      className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-border bg-bg px-3.5 py-2 text-[11px]"
                    >
                      <span className="text-navy-2">
                        <b className="text-navy">{o.studentName}</b>&apos;s visitor {o.visitorName}
                        {o.zoneLabel ? ` · ${o.zoneLabel}` : ""} · arrived {o.arrivedLabel ?? "—"}
                      </span>
                      <span
                        className={`whitespace-nowrap rounded-pill px-2.5 py-0.5 text-[9px] font-bold ${
                          o.tier === "senior" ? "bg-terra text-bg" : "bg-terra-bg text-terra"
                        }`}
                      >
                        {o.tier === "senior" ? "SENIOR HM · 16:30" : "OVERSTAY · 16:15"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>

          {/* §2 editorial security tenets */}
          <Section eyebrow="Editorial · the front-door problem" title="Why a digital Visitor's Book matters">
            <div className="rounded-2xl border border-border bg-surface p-6 text-[13px] leading-relaxed text-navy-2">
              <p className="mb-3">
                A school&apos;s front door is its <em className="font-display italic text-gold">most important security surface</em>,
                and visiting Sunday is when that door is most open. The paper Visitor&apos;s Book records a name; it never
                cross-references whether this Mrs Mensah is on that student&apos;s approved list.
              </p>
              <p className="mb-3">
                The digital approach reverses it: the student&apos;s approved-visitor list is pulled at sign-in, the
                visitor&apos;s name matched, the relationship verified. If the visitor is not on the list, the gate{" "}
                <b className="text-navy">flags it — sometimes legitimately</b> (an aunt from abroad, never met); the
                resolution is the SoD calling the HM for verbal authorisation, not writing a name without checking.{" "}
                <b className="text-navy">The gate becomes a list-check rather than a list-record.</b>
              </p>
              <p>
                One design decision worth defending: the surface shows <b className="text-navy">no visitor photos or QR
                scanning in front of the parent</b>. The check is done with a tablet, the name spoken aloud, the ID
                checked once, the green tick out of the parent&apos;s sight.{" "}
                <em className="font-display italic text-gold">The technology stays behind the scenes; the warmth stays in front.</em>
              </p>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------

const LIST_MATCH_CLS: Record<ListMatchKind, string> = {
  verified: "bg-green-bg text-green",
  review: "bg-gold-bg text-gold",
  hm: "bg-navy text-bg",
  flagged: "bg-terra-bg text-terra",
};

function ArrivalRow({ a, query }: { a: IndicatedArrival; query: Record<string, string | undefined> }) {
  // Pastoral highlight (terra ROW tint) — DISTINCT from the gate security FLAGGED pill (§2 / Lucy).
  return (
    <div
      className={`grid grid-cols-[1.2fr_1.6fr_90px_130px_auto] items-center gap-3 border-b border-border px-5 py-2.5 text-[12px] last:border-b-0 ${
        a.pastoral ? "bg-terra-bg" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-[10px] font-bold ${
            a.pastoral ? "bg-terra text-bg" : "bg-navy text-gold"
          }`}
        >
          {a.studentInitials}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-bold text-navy">{a.studentName}</span>
            {a.pastoral && (
              <span className="rounded-pill bg-terra px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.06em] text-bg">
                Pastoral
              </span>
            )}
          </div>
          <div className="truncate text-[9px] text-navy-3">{a.studentSub}</div>
        </div>
      </div>
      <div className="min-w-0 text-[11px] text-navy-2">
        <b className="text-navy">{a.visitorName}</b>
        {a.visitorPhoneMasked ? <span className="font-mono text-[10px] text-navy-3"> · {a.visitorPhoneMasked}</span> : ""}
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[9px] text-navy-3">
          <StatusPill status={a.status} />
          {a.overstay !== "none" && (
            <span className="rounded-pill bg-terra px-1.5 py-0.5 font-bold uppercase text-bg">
              {a.overstay === "senior" ? "Senior HM" : "Overstay"}
            </span>
          )}
          {a.arrivedLabel && <span className="font-mono">in {a.arrivedLabel}</span>}
          {a.departedLabel && <span className="font-mono">out {a.departedLabel}</span>}
          {a.zoneLabel && <span>· {a.zoneLabel}</span>}
        </div>
      </div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-navy-3">{a.relationship ?? "—"}</div>
      <div>
        <span className={`rounded-pill px-2 py-0.5 text-[9px] font-bold ${LIST_MATCH_CLS[a.listMatch.kind]}`}>
          {a.listMatch.label}
        </span>
      </div>
      <VisitRowActions
        visitId={a.visitId}
        studentId={a.studentId}
        status={a.status}
        verification={a.verification}
        listMatchKind={a.listMatch.kind}
        query={query}
      />
    </div>
  );
}

function StatusPill({ status }: { status: IndicatedArrival["status"] }) {
  const cls =
    status === "ARRIVED"
      ? "bg-green-bg text-green"
      : status === "DEPARTED"
        ? "bg-bg text-navy-3 border border-border"
        : "bg-gold-bg text-gold";
  return <span className={`rounded-pill px-1.5 py-0.5 font-bold uppercase ${cls}`}>{status}</span>;
}

function HouseRsvpCell({ h }: { h: HouseRsvpCard }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      {/* House band colour = user data (inline style); a light band needs the hairline (no-alpha discipline). */}
      <div
        className="h-1.5"
        style={{ backgroundColor: h.colour ?? "var(--navy)", borderBottom: h.isLight ? "1px solid var(--border-2)" : undefined }}
      />
      <div className="p-5">
        <div className="flex items-baseline justify-between">
          <div className="font-display text-[15px] font-semibold text-navy">
            {h.name} <em className="italic text-gold">House</em>
          </div>
          <div className="font-display text-[15px] font-semibold text-navy">
            <em className="italic text-gold">{h.rsvpd}</em> / {h.expected}
          </div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-border">
          <div className="h-full bg-gold" style={{ width: `${h.pct}%` }} />
        </div>
        <div className="mt-2 text-[10px] text-navy-3">
          <b className="text-navy-2">{h.pct}% RSVP</b>
          {h.byForm.length > 0 ? " · " : ""}
          {h.byForm.map((f) => `${f.rsvpd} F${f.form}`).join(" · ")}
          {h.arrived > 0 ? ` · ${h.arrived} arrived` : ""} · HM {h.hmName ?? "unassigned"}
        </div>
      </div>
    </div>
  );
}

function ZoneCardView({ z, live }: { z: ZoneCard; live: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-gold">{z.label}</div>
      <div className="mt-1 font-display text-[16px] font-semibold text-navy">{z.forWhom}</div>
      <div className="mt-1.5 text-[11px] text-navy-3">{z.where}</div>
      <div className="mt-3 flex items-center justify-between border-t border-dashed border-border pt-2 text-[10px] text-navy-3">
        <span>{live ? "Occupancy" : "Capacity"}</span>
        <span className="font-display font-semibold text-navy">
          {live ? `${z.occupancy} / ~${z.capacity} · ${z.pct}%` : `~${z.capacity}`}
        </span>
      </div>
    </div>
  );
}

function SumCard({ featured, lab, big, sub }: { featured?: boolean; lab: string; big: string; sub: string }) {
  return (
    <div className={`rounded-xl border p-4 ${featured ? "border-navy bg-navy text-bg" : "border-border bg-surface"}`}>
      <div className={`text-[10px] font-bold uppercase tracking-[0.12em] ${featured ? "text-gold-soft" : "text-navy-3"}`}>
        {lab}
      </div>
      <div className="mt-1.5 font-display text-[26px] font-semibold leading-none">
        <em className={`italic ${featured ? "text-gold" : "text-gold"}`}>{big}</em>
      </div>
      <div className={`mt-1.5 text-[11px] leading-snug ${featured ? "text-gold-soft" : "text-navy-3"}`}>{sub}</div>
    </div>
  );
}

function Section({
  eyebrow,
  title,
  meta,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  meta?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">{eyebrow}</div>
          <h3 className="mt-0.5 font-display text-xl font-semibold text-navy">{title}</h3>
        </div>
        <div className="flex items-center gap-3">
          {meta && <span className="text-[11px] text-navy-3">{meta}</span>}
          {actions}
        </div>
      </div>
      {children}
    </section>
  );
}
