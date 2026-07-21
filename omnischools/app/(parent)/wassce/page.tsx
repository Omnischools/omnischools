import { requireParent } from "@/lib/auth/server";
import {
  loadParentPortal,
  type ParentPortalChild,
  type ParentPortalPaper,
  type ParentPortalSc,
  type ParentPortalSms,
  type ParentPortalStatement,
} from "@/lib/parent/parent-portal-data";
import { PROGRAMME_TRACKS } from "@/lib/wassce/constants";
import type { FrozenTargetUniversity } from "@/lib/wassce/university-match";
import {
  avatarInitials,
  initialSurname,
  relationshipLabel,
  parentLongDate,
  parentShortDate,
  daysUntil,
  parentSittingLabel,
  paperTimeLine,
  heroHeadline,
  heroBody,
  nextPaperCell,
  targetLine,
  targetGloss,
  targetMetaLine,
  statementTitle,
  statementBody,
  signatureLine,
  scSteps,
  isOpenSc,
  scExplainerBullets,
  SC_EXPLAINER_LEAD,
  SC_PROCESS_TITLE,
  SC_PROCESS_SUBTITLE,
  rejectedDegradeLine,
  multiSchoolNotice,
  scFaqItems,
  EVERGREEN_FAQ,
  AGGREGATE_FAQ,
  STATEMENT_SUBTITLE,
  NOT_ACKNOWLEDGED_NOTE,
  type SittingPillKind,
  type FaqItem,
} from "@/lib/wassce/parent-copy";

export const dynamic = "force-dynamic";

const HERO_GRADIENT = "linear-gradient(135deg,#B84A39 0%,#8B3829 100%)";
const READINESS_GRADIENT = "linear-gradient(135deg,#F5EBDC 0%,#FAF7F2 100%)";
const AVATAR_GRADIENT = "linear-gradient(135deg,#C8975B 0%,#E8D4B8 100%)";
const MISSED_ROW = "#FBEBE7";

export default async function ParentWasscePage() {
  const { user, school } = await requireParent();
  const data = await loadParentPortal(school.id, user.id);
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
      <ParentNav />

      <div className="px-7 pb-9 pt-6">
        {data.hasChildrenAtOtherSchools && (
          <div className="mb-6 rounded-lg border border-gold-soft bg-gold-bg px-5 py-4 text-[13px] leading-relaxed text-navy-2">
            {multiSchoolNotice(school.name)}
          </div>
        )}

        {!child ? (
          <EmptyPortal />
        ) : (
          <ChildPortal child={child} />
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────── chrome ── */

function ParentHeader({
  schoolName,
  childName,
  guardianDisplay,
  relation,
}: {
  schoolName: string;
  childName: string | null;
  guardianDisplay: string;
  relation: string;
}) {
  return (
    <header className="flex items-center gap-3.5 border-b border-border bg-surface px-7 py-[18px]">
      <div className="flex flex-1 items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gold font-display text-sm font-semibold text-navy">
          {schoolName.trim()[0]?.toUpperCase() ?? "S"}
        </div>
        <div>
          <div className="font-display text-[15px] font-medium text-navy">{schoolName}</div>
          <div className="text-[11px] text-navy-3">
            Parent portal{childName ? ` · ${childName}` : ""}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <div className="text-right">
          <div className="text-xs font-semibold text-navy">{initialSurname(guardianDisplay)}</div>
          <div className="text-[10px] text-navy-3">{relation}</div>
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-navy font-display text-[13px] font-semibold text-gold">
          {avatarInitials(guardianDisplay)}
        </div>
      </div>
    </header>
  );
}

/** Six tabs; only WASSCE is built (Lucy §0.6). The unread dot renders on WASSCE only, no faked markers. */
function ParentNav() {
  const tabs = ["WASSCE", "Sickbay", "Communications", "Billing", "Boarding", "School calendar"];
  return (
    <nav className="flex gap-0 overflow-x-auto border-b border-border bg-surface px-7">
      {tabs.map((t, i) => (
        <span
          key={t}
          className={
            i === 0
              ? "whitespace-nowrap border-b-2 border-gold px-4 py-3.5 text-[13px] font-semibold text-navy"
              : "whitespace-nowrap border-b-2 border-transparent px-4 py-3.5 text-[13px] font-medium text-navy-3"
          }
          aria-current={i === 0 ? "page" : undefined}
        >
          {t}
        </span>
      ))}
    </nav>
  );
}

function EmptyPortal() {
  return (
    <div className="rounded-xl border border-border bg-surface px-6 py-8 text-center text-[13px] leading-relaxed text-navy-2">
      No student is linked to this portal yet. Please contact the school office.
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── the child portal ── */

function ChildPortal({ child }: { child: ParentPortalChild }) {
  const cand = child.candidate;
  const today = new Date();

  const openSc = cand?.specialConsiderations.find((sc) => isOpenSc(sc.status)) ?? null;
  const rejectedSc = cand?.specialConsiderations.find((sc) => sc.status === "REJECTED") ?? null;
  const liveSc = openSc; // DRAFT is filtered in the loader; REJECTED degrades (never a live card).
  const scRejected = !!rejectedSc && !openSc;

  // The next paper = the earliest future paper with no sitting and no exemption.
  const papers = cand?.papers ?? [];
  let nextPaperId: string | null = null;
  let nextPaperName: string | null = null;
  let nextPaperDateLabel: string | null = null;
  let nextPaperDays: number | null = null;
  for (const p of papers) {
    if (p.satAt || p.exemptedAt || !p.scheduledDate) continue;
    const d = daysUntil(p.scheduledDate, today);
    if (d == null || d < 0) continue;
    nextPaperId = p.paperId;
    nextPaperName = p.name;
    nextPaperDateLabel = parentShortDate(new Date(`${p.scheduledDate}T00:00:00Z`));
    nextPaperDays = d;
    break;
  }

  const missedCount = papers.filter((p) => p.exemptedAt && !p.satAt).length;
  const statement = cand?.statement ?? null;
  const primaryTarget: FrozenTargetUniversity | null =
    statement?.targets.find((t) => t.isPrimary) ?? statement?.targets[0] ?? null;

  return (
    <>
      {liveSc && (
        <Hero
          childFirst={child.firstName}
          missedCount={missedCount}
          filedTime={liveSc.filedAt ? parentShortDate(liveSc.filedAt) : null}
          acknowledged={!!liveSc.waecAcknowledgedAt}
          makeUpCentre={liveSc.makeUpCentre}
          nextPaperName={nextPaperName}
          nextPaperDate={nextPaperDateLabel}
          nextPaperDays={nextPaperDays}
        />
      )}

      <ChildCard child={child} indexNumber={cand?.indexNumber ?? null} target={primaryTarget} />

      {cand && (
        <div className="mt-6">
          <Schedule
            papers={papers}
            nextPaperId={nextPaperId}
            scRejected={scRejected}
            centreCode={cand.centreCode}
            today={today}
          />
        </div>
      )}

      {liveSc && cand && (
        <div className="mt-6">
          <ScProcess sc={liveSc} childFirst={child.firstName} />
        </div>
      )}

      {rejectedSc && !openSc && (
        <div className="mt-6 rounded-xl border border-border bg-surface px-6 py-5 text-[13px] leading-relaxed text-navy-2">
          {rejectedDegradeLine(child.firstName)}
        </div>
      )}

      {/* §4 comms — real SMS rows only; notification_log is parent-denied so this omits today. */}
      {cand && cand.smsThread.length > 0 && <SmsThread thread={cand.smsThread} />}

      {statement && (
        <div className="mt-6">
          <ReadinessCard
            childFirst={child.firstName}
            statement={statement}
          />
        </div>
      )}

      {cand && (
        <div className="mt-5">
          <WaecCard
            indexNumber={cand.indexNumber}
            centreCode={cand.centreCode}
            makeUpCentre={liveSc?.makeUpCentre ?? null}
            waecRef={liveSc?.waecRef ?? null}
            programme={child.programme}
          />
        </div>
      )}

      <div className="mt-5">
        <Faq
          items={buildFaq({
            childFirst: child.firstName,
            hasOpenSc: !!liveSc,
            nextPaperName,
            nextPaperDate: nextPaperDateLabel,
            makeUpCentre: liveSc?.makeUpCentre ?? null,
          })}
        />
      </div>
    </>
  );
}

/* ───────────────────────────────────────────────────────────────────── §1 hero ── */

function Hero(props: {
  childFirst: string;
  missedCount: number;
  filedTime: string | null;
  acknowledged: boolean;
  makeUpCentre: string | null;
  nextPaperName: string | null;
  nextPaperDate: string | null;
  nextPaperDays: number | null;
}) {
  const slots = {
    childFirst: props.childFirst,
    missedCount: props.missedCount,
    filedTime: props.filedTime,
    acknowledged: props.acknowledged,
    makeUpCentre: props.makeUpCentre,
    nextPaperName: props.nextPaperName,
    nextPaperDate: props.nextPaperDate,
  };
  const cell = nextPaperCell(props.nextPaperName, props.nextPaperDate, props.nextPaperDays);
  return (
    <section
      className="rounded-2xl px-8 py-7 text-bg shadow-lg"
      style={{ background: HERO_GRADIENT }}
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-75">
          Live case
        </div>
        <div className="flex items-center gap-2 rounded-pill bg-[rgba(255,255,255,0.14)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em]">
          <span className="h-[7px] w-[7px] rounded-full" style={{ background: "#FFD4C9" }} />
          Active case
        </div>
      </div>
      <h2 className="mb-3 font-display text-[26px] font-medium leading-tight">
        {heroHeadline(slots)}
      </h2>
      <p className="mb-5 max-w-[760px] text-sm leading-relaxed opacity-90">{heroBody(slots)}</p>
      {cell && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-[rgba(255,255,255,0.1)] px-4 py-3.5">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] opacity-70">
              {cell.label}
            </div>
            <div className="font-display text-lg font-medium">{cell.value}</div>
            <div className="text-[11px] opacity-[0.78]">{cell.meta}</div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────── §1 child card ── */

function ChildCard({
  child,
  indexNumber,
  target,
}: {
  child: ParentPortalChild;
  indexNumber: string | null;
  target: FrozenTargetUniversity | null;
}) {
  const track = child.programme ? PROGRAMME_TRACKS[child.programme] : null;
  const dob = child.dateOfBirth
    ? parentLongDate(new Date(`${child.dateOfBirth}T00:00:00Z`))
    : null;
  return (
    <section className="mt-6 grid grid-cols-1 items-center gap-5 rounded-xl border border-border bg-surface px-6 py-[22px] md:grid-cols-[auto_1fr_auto]">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-full font-display text-[22px] font-medium text-navy"
        style={{ background: AVATAR_GRADIENT }}
      >
        {avatarInitials(child.fullName)}
      </div>
      <div>
        <div className="mb-1 font-display text-[22px] font-medium text-navy">
          {child.firstName} <em className="not-italic text-gold">{child.lastName}</em>
        </div>
        <div className="mb-1.5 flex flex-wrap gap-3.5 text-xs text-navy-3">
          {child.formLabel && (
            <div>
              <b className="text-navy">{child.formLabel}</b>
            </div>
          )}
          {track && (
            <span
              className={
                "inline-flex items-center rounded-pill px-2.5 py-[3px] text-[11px] font-semibold " +
                (track.pillBgClass ?? "")
              }
              style={track.pillBgStyle ? { background: track.pillBgStyle, color: track.color } : undefined}
            >
              {track.shortLabel} programme
            </span>
          )}
          {indexNumber && (
            <div>
              <b className="text-navy">Index</b> · {indexNumber}
            </div>
          )}
        </div>
        {dob && <div className="text-[11px] text-navy-3">Born {dob}</div>}
      </div>
      {target && (
        <div className="md:text-right">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-navy-3">
            University target
          </div>
          <div className="font-display text-base font-medium text-navy">{targetLine(target)}</div>
          <div className="mt-0.5 text-[11px] text-navy-3">{targetMetaLine(target)}</div>
          <div className="mt-1.5 text-[11px] leading-relaxed text-navy-3">
            {targetGloss(child.firstName, target)}
          </div>
        </div>
      )}
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── §2 schedule ── */

const PILL_CLASS: Record<SittingPillKind, string> = {
  sat: "bg-green-bg text-green",
  missed: "bg-terra-bg text-terra",
  next: "bg-gold text-navy",
  upcoming: "border border-border bg-bg text-navy-3",
};

function Schedule({
  papers,
  nextPaperId,
  scRejected,
  centreCode,
  today,
}: {
  papers: ParentPortalPaper[];
  nextPaperId: string | null;
  scRejected: boolean;
  centreCode: string;
  today: Date;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border bg-bg px-6 py-[18px]">
        <h3 className="font-display text-base font-medium text-navy">Paper-by-paper schedule</h3>
        <div className="text-[11px] tracking-[0.06em] text-navy-3">Centre · {centreCode}</div>
      </div>
      {papers.length === 0 ? (
        <div className="px-6 py-6 text-[13px] text-navy-3">No papers scheduled yet.</div>
      ) : (
        papers.map((p) => {
          const pill = parentSittingLabel(
            {
              satAt: p.satAt,
              exemptedAt: p.exemptedAt,
              scheduledDate: p.scheduledDate,
              isNext: p.paperId === nextPaperId,
              scRejected,
            },
            today,
          );
          const rowStyle =
            pill.kind === "missed" ? { background: MISSED_ROW } : undefined;
          const rowClass = pill.kind === "next" ? "bg-bg" : "";
          const d = p.scheduledDate ? new Date(`${p.scheduledDate}T00:00:00Z`) : null;
          return (
            <div
              key={p.paperId}
              className={`grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-border px-6 py-4 last:border-b-0 ${rowClass}`}
              style={rowStyle}
            >
              <div className="w-[70px] text-center">
                {d ? (
                  <>
                    <div className="font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">
                      {new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(d)}
                    </div>
                    <div className="font-display text-2xl font-medium leading-none text-navy">
                      {d.getUTCDate()}
                    </div>
                    <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-navy-3">
                      {new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(d)}
                    </div>
                  </>
                ) : (
                  <div className="font-display text-2xl font-medium text-navy-3">—</div>
                )}
              </div>
              <div>
                <div className="mb-0.5 font-display text-[15px] font-medium text-navy">{p.name}</div>
                <div className="text-xs text-navy-3">
                  {paperTimeLine(p.scheduledTime, p.durationMinutes, p.paperType)}
                </div>
              </div>
              <div>
                <span
                  className={`inline-flex items-center rounded-pill px-[11px] py-[5px] text-[11px] font-semibold tracking-[0.04em] ${PILL_CLASS[pill.kind]}`}
                >
                  {pill.text}
                </span>
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}

/* ─────────────────────────────────────────────────────────── §3 SC-12 process ── */

function ScProcess({
  sc,
  childFirst,
}: {
  sc: ParentPortalSc;
  childFirst: string;
}) {
  const steps = scSteps(sc);
  const bullets = scExplainerBullets(childFirst, sc.makeUpCentre);
  return (
    <section className="rounded-xl border border-border bg-surface px-7 py-6">
      <div className="mb-[18px] flex items-center justify-between border-b border-border pb-3.5">
        <div>
          <div className="font-display text-lg font-medium text-navy">{SC_PROCESS_TITLE}</div>
          <div className="mt-0.5 text-[11px] text-navy-3">{SC_PROCESS_SUBTITLE}</div>
        </div>
        {sc.waecRef && (
          <div className="font-mono text-[11px] text-navy-3">
            WAEC ref · <b className="text-navy">{sc.waecRef}</b>
          </div>
        )}
      </div>

      {/* Steps — vertical on phone, horizontal ≥ sm (Lucy §0.6). */}
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:gap-0">
        {steps.map((s) => (
          <div key={s.n} className="flex items-center gap-3 sm:flex-1 sm:flex-col sm:gap-2 sm:text-center">
            <div
              className={
                "flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border-2 font-display text-xs font-semibold " +
                (s.state === "done"
                  ? "border-green bg-green text-surface"
                  : s.state === "active"
                    ? "border-gold bg-gold text-navy"
                    : "border-border bg-bg text-navy-3")
              }
            >
              {s.state === "done" ? "✓" : s.n}
            </div>
            <div>
              <div className={"text-[11px] font-semibold leading-tight " + (s.state === "pending" ? "text-navy-3" : "text-navy")}>
                {s.label}
              </div>
              {s.meta && <div className="text-[10px] text-navy-3">{s.meta}</div>}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-md border-l-[3px] border-gold bg-bg px-[18px] py-3.5 text-[13px] leading-relaxed text-navy-2">
        <b className="text-navy">{SC_EXPLAINER_LEAD}</b>
        <ul className="mt-2 space-y-1">
          {bullets.map((b, i) => (
            <li key={i} className="relative pl-3.5 before:absolute before:left-1 before:top-0 before:font-bold before:text-gold before:content-['·']">
              {b}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── §4 comms ── */

function SmsThread({
  thread,
}: {
  thread: ParentPortalSms[];
}) {
  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border bg-bg px-6 py-[18px]">
        <h3 className="font-display text-base font-medium text-navy">Messages</h3>
        <div className="text-[11px] text-navy-3">All times GMT · school contact records</div>
      </div>
      {thread.map((m, i) => (
        <div key={i} className="grid grid-cols-[64px_1fr] gap-4 border-b border-border px-6 py-4 last:border-b-0">
          <div>
            <div className="font-mono text-[13px] font-semibold text-navy">
              {new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(m.createdAt)}
            </div>
            <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-navy-3">SMS</div>
          </div>
          <div>
            <div className="text-[13px] leading-relaxed text-navy-2">{m.message}</div>
            <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-green">
              {m.status}
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

/* ────────────────────────────────────────────────────────── §5 readiness card ── */

function ReadinessCard({
  childFirst,
  statement,
}: {
  childFirst: string;
  statement: ParentPortalStatement;
}) {
  const acknowledged = !!statement.parentAcknowledgedAt;
  const title = statementTitle(acknowledged, statement.parentAcknowledgedAt);
  const body = statementBody(
    childFirst,
    statement.projectedAggregate,
    statement.targets,
    statement.parentConcernsText,
  );
  const sig = signatureLine(
    statement.parentAckMethod,
    statement.parentAckPhone,
    statement.parentAcknowledgedAt,
  );
  return (
    <section
      className="rounded-xl border border-gold-soft px-6 py-[22px]"
      style={{ background: READINESS_GRADIENT }}
    >
      <div className="mb-3.5 flex items-center gap-3.5">
        <div
          className={
            "flex h-[42px] w-[42px] items-center justify-center rounded-lg font-display text-lg font-semibold " +
            (acknowledged ? "bg-gold text-navy" : "border border-border bg-surface text-navy-3")
          }
        >
          {acknowledged ? "✓" : "•"}
        </div>
        <div>
          <div className="font-display text-base font-medium leading-tight text-navy">{title}</div>
          <div className="mt-0.5 text-[11px] text-navy-3">{STATEMENT_SUBTITLE}</div>
        </div>
      </div>
      {body && (
        <div className="border-t border-gold-soft pt-3.5 text-[13px] leading-relaxed text-navy-2">
          {body}
        </div>
      )}
      <div className="mt-3.5 grid grid-cols-1 items-center gap-3.5 border-t border-gold-soft pt-3.5 sm:grid-cols-[1fr_auto]">
        <div className="text-[11px] text-navy-3">{sig ?? NOT_ACKNOWLEDGED_NOTE}</div>
        <a
          href={`/api/senior/readiness-statement/${statement.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-bold text-gold"
        >
          View signed PDF →
        </a>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────── §5 WAEC card ── */

function WaecCard({
  indexNumber,
  centreCode,
  makeUpCentre,
  waecRef,
  programme,
}: {
  indexNumber: string;
  centreCode: string;
  makeUpCentre: string | null;
  waecRef: string | null;
  programme: ParentPortalChild["programme"];
}) {
  const track = programme ? PROGRAMME_TRACKS[programme] : null;
  const rows: [string, string][] = [
    ["Index", indexNumber],
    ["Centre", `${centreCode} (here)`],
  ];
  if (makeUpCentre) rows.push(["Make-up centre", makeUpCentre]);
  if (waecRef) rows.push(["SC-12 reference", waecRef]);
  if (track) rows.push(["Programme", track.shortLabel]);
  return (
    <section className="rounded-xl border border-border bg-surface px-6 py-5">
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md font-display text-sm font-semibold text-navy" style={{ background: "#E5EAF2" }}>
          W
        </div>
        <div className="font-display text-[15px] font-medium text-navy">WAEC details</div>
      </div>
      <div className="text-xs leading-7 text-navy-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between">
            <span>{label}</span>
            <b className="text-navy">{value}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────── §5 FAQ ── */

function buildFaq(slots: {
  childFirst: string;
  hasOpenSc: boolean;
  nextPaperName: string | null;
  nextPaperDate: string | null;
  makeUpCentre: string | null;
}): FaqItem[] {
  const items: FaqItem[] = [];
  if (slots.hasOpenSc) {
    items.push(
      ...scFaqItems({
        childFirst: slots.childFirst,
        nextPaperName: slots.nextPaperName,
        nextPaperDate: slots.nextPaperDate,
        makeUpCentre: slots.makeUpCentre,
      }),
    );
  }
  items.push(AGGREGATE_FAQ, ...EVERGREEN_FAQ);
  return items;
}

function Faq({ items }: { items: FaqItem[] }) {
  return (
    <section className="rounded-xl border border-border bg-surface px-7 py-6">
      <div className="mb-[18px] font-display text-base font-medium text-navy">
        Questions you might have
      </div>
      {items.map((item, i) => (
        <div key={i} className="border-b border-border py-3.5 last:border-b-0 last:pb-0">
          <div className="mb-1.5 text-[13px] font-semibold text-navy">
            <span className="font-display italic font-medium text-gold">Q. </span>
            {item.q}
          </div>
          <div className="pl-[18px] text-[13px] leading-relaxed text-navy-2 -indent-[18px]">
            <span className="font-display italic font-medium text-gold">A. </span>
            {item.a}
          </div>
        </div>
      ))}
    </section>
  );
}
