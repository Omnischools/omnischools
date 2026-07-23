import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSchoolRole, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { CARE_PLAN_MARKER } from "@/lib/sickbay/chronic-copy";
import { hasAnyRole, SICKBAY_CLINICAL_WRITE_ROLES, SICKBAY_ROLES } from "@/lib/access";
import { getSickbayBoard, type SickbayWardPatient } from "@/lib/sickbay/board-reads";
import {
  ADMITTED_TAG,
  BEDS_CARD_EM,
  BEDS_CARD_TITLE,
  BED_EMPTY_STATE,
  EMPTY_LOG,
  EMPTY_QUEUE,
  EXPECTED_DISCHARGE,
  H1_EM,
  H1_LEAD,
  ISO_TAG,
  LIVE_TILE_LABELS,
  LOG_CARD_EM,
  LOG_CARD_TAIL,
  LOG_HEAD_NOTE,
  NOT_CONFIGURED,
  NO_BEDS,
  NO_READINGS,
  OPEN_RECORD,
  QUEUE_CARD_EM,
  QUEUE_CARD_TITLE,
  REASSESSMENT_OVERDUE,
  WARD_VITAL_LABELS,
  admittedBedSuffix,
  admittedMeta,
  admittedTileMeta,
  asOf,
  bedLabel,
  bedOccupancyMeta,
  boardDate,
  boardLede,
  dayLabel,
  dispositionPill,
  hhmm,
  initials,
  queueWaitMeta,
  recentLede,
  stampLabel,
  studentMeta,
  visitBreakdown,
} from "@/lib/sickbay/board-copy";
import { splitBold } from "@/lib/sickbay/defaults";
import { formatElapsed, formatWait, waitMs } from "@/lib/sickbay/visits";
import { painLevel, vitalSeverity } from "@/lib/sickbay/vitals";
import { ClinicalRestricted } from "@/components/sickbay/clinical-restricted";
import { BeginVisitButton } from "@/components/sickbay/begin-visit-button";

// B15 — every wall-clock derivation (`05h 31m`, `7 min wait`) is computed SERVER-SIDE at request
// time from ONE pinned instant and rendered as a static string. A stale minute is honest; a ticking
// client clock on a clinical page is not, and there is no polling to make the `.now-dot` a promise.
export const dynamic = "force-dynamic";

/**
 * `/senior/sickbay/today` — the bench-side board (SHS module 4.4 / INCR-22c). §01 (live strip ·
 * admitted block · queue · bed board) and §03 (Recent visits · 24h) as ONE route: the surface draws
 * §03 at its own URL, but two routes would be two clinical gates, two readers and two dynamic
 * renders for one glance, and `TODAY_PATH` is already every shipped 22a write's revalidation target.
 * §02 rounds (24) · §04 referrals (25) · §05 outbreak (27) are ABSENT ENTIRELY — no shell, no badge,
 * no anchor target.
 *
 * 🔴 TWO gates, and the split is the point (owner D2 · R40/R88):
 *   • MODULE access is `SICKBAY_ROLES` — ADMIN reaches the route and is NOT 404'd, NOT redirected.
 *   • CLINICAL read is enforced INSIDE `getSickbayBoard`, which returns null for a non-clinical
 *     reader BEFORE issuing a query (R81). So for an ADMIN this page issues no SQL at all: there is
 *     no complaint, no vital, no name and no count to leak into the flight payload (AC G1/G2).
 *   • CLINICAL write is `SICKBAY_CLINICAL_WRITE_ROLES` = [MATRON]: `New visit` and every
 *     `Begin visit` are absent for a HEADMASTER, whose rows still render and still link. An
 *     affordance filter, NEVER a data filter.
 *
 * 🔴 A11 — the threat model is PHYSICAL. This is a screen in a room where students queue, so the
 * reader gate is not the boundary that matters here: the board prints identity, location, status and
 * duration, and it prints NO clinical assertion except the live queue's presenting complaint (A6,
 * bought by triage necessity). The §03 complaint fragment, the bed tile's condition and the admitted
 * block's narrative are gone for that reason and not because a column was missing (R76 · R87).
 */
export default async function SickbayTodayPage() {
  const { school, user } = await requireSchoolRole(SICKBAY_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  // R119 — the actor identity (resolved so the AUTH_DEV_BYPASS preview matches a real role_assignment)
  // drives 23's `hasCarePlan` marker through the chronic RLS boundary.
  const { id: userId } = await resolveActor(school.id);

  // R68 — the clock is read ONCE, here, and threaded. Nothing below (and nothing in the reader)
  // calls `new Date()`, so every derived duration on the page belongs to the same instant.
  const now = new Date();
  const board = await getSickbayBoard(school.id, { userId, roles }, now);
  if (!board) return <ClinicalRestricted label="Today" />;

  const canWrite = hasAnyRole(roles, SICKBAY_CLINICAL_WRITE_ROLES);
  const { counts } = board;
  const waits = board.queue.map((q) =>
    waitMs({ presentedAt: q.presentedAt, startedAt: null }, now),
  );

  const lede = boardLede({
    // Mode C: the clause is not "0 admitted" — a school with no beds has no admissions to count.
    admitted: board.beds ? counts.admitted : null,
    queued: counts.queued,
    visitsToday: counts.today.total,
  });
  const todayMeta = visitBreakdown({ ...counts.today, open: counts.today.awaiting });
  const occupiedBeds = board.bedTiles.filter((b) => b.occupant).length;

  const log = board.recent.map((r) => ({
    ...r,
    pill: dispositionPill(r.disposition, r.dispositionAt),
  }));
  const logCounts = {
    total: log.length,
    discharged: log.filter((r) => r.disposition === "DISCHARGE").length,
    admitted: log.filter((r) => r.disposition === "ADMIT").length,
    referred: log.filter((r) => r.disposition === "REFER").length,
    open: log.filter((r) => r.disposition === null).length,
  };
  const logLede = recentLede(logCounts);

  return (
    <div className="mx-auto max-w-page px-6 pb-16 pt-6 md:px-9">
      {/* ═══ page head ═══ */}
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-3">
        <a href="/senior/sickbay/setup" className="text-gold no-underline">
          Sickbay
        </a>{" "}
        · Today
      </div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-medium leading-[1.1] tracking-[-0.018em] text-navy">
            {H1_LEAD}
            <em className="font-normal italic text-gold">{H1_EM}</em> · {boardDate(now)}
          </h1>
          <p className="mt-1 max-w-[720px] text-[13px] text-navy-3">
            <Bold text={lede} />
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* R83 — `Admit patient` is OMITTED: an admission is a DISPOSITION of an in-progress visit
              (started_at + complaint + impression), so a board-level button would either skip those
              preconditions or be `New visit` under a misleading label. */}
          {canWrite && (
            <Link
              href="/senior/sickbay/visits/new"
              className="rounded-[5px] border border-gold bg-gold px-[14px] py-[8px] text-[12px] font-bold text-navy no-underline"
            >
              New visit
            </Link>
          )}
          {/* §1.3 — the register is reached from the board head, one flat nav row (R84). */}
          <Link
            href="/senior/sickbay/chronic-register"
            className="rounded-[5px] border border-border-2 bg-surface px-[14px] py-[8px] text-[12px] font-semibold text-navy no-underline"
          >
            Chronic register
          </Link>
          <Link
            href="/senior/sickbay/setup"
            className="rounded-[5px] border border-border-2 bg-surface px-[14px] py-[8px] text-[12px] font-semibold text-navy no-underline"
          >
            Setup
          </Link>
        </div>
      </div>

      {/* R89 — the R25 distinction: a coalesced REFERRAL_ONLY is not a declared Mode C. Orthogonal to
          the mode, shown to every reader, gone the moment setup is saved. */}
      {!board.configured && (
        <div className="mb-6 rounded-[10px] border border-dashed border-border-2 bg-bg p-[14px_18px] text-[12px] text-navy-2">
          <BoldLink text={NOT_CONFIGURED} href="/senior/sickbay/setup" />
        </div>
      )}

      {/* ═══ live strip — 3 tiles (A/B), 2 in Mode C where `Admitted now` is absent from the DOM ═══ */}
      <div
        className={`mb-6 grid gap-[14px] ${board.beds ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
      >
        {board.beds && (
          <Tile
            label={LIVE_TILE_LABELS[0]}
            value={String(counts.admitted)}
            // A known zero renders with its denominator; ZERO ACTIVE BEDS renders no `/ M` at all —
            // a capacity the school never configured is the false-zero shape (R74).
            subNum={
              counts.bedsTotal > 0
                ? ` / ${counts.bedsTotal} bed${counts.bedsTotal === 1 ? "" : "s"}`
                : null
            }
            // The ONE place the board abbreviates at render: `ward` is the one type that carries the
            // FULL name (the `.ab-name` block below prints it), so tile 1 applies the tier itself —
            // through the SAME `initials()` every other board name already went through.
            meta={admittedTileMeta(
              board.ward.map((w) => ({
                shortName: initials(w.studentFullName),
                bedNumber: w.bedNumber,
              })),
            )}
            active={counts.admitted > 0}
          />
        )}
        <Tile
          label={LIVE_TILE_LABELS[1]}
          value={String(counts.queued)}
          subNum={null}
          meta={queueWaitMeta(waits)}
          active={counts.queued > 0}
        />
        <Tile
          label={LIVE_TILE_LABELS[2]}
          value={String(counts.today.total)}
          subNum={null}
          meta={todayMeta}
          active={false}
        />
      </div>

      {/* ═══ admitted block — one per open admission, ordered by bed ═══ */}
      {board.ward.map((p) => (
        <AdmittedBlock key={p.admissionId} p={p} now={now} />
      ))}

      <div className={`grid gap-[18px] ${board.beds ? "lg:grid-cols-[1.4fr_1fr]" : ""}`}>
        {/* ═══ queue ═══ */}
        <div className="overflow-hidden rounded-xl border-[1.5px] border-gold bg-surface">
          <div className="flex items-baseline justify-between gap-[14px] border-b border-border p-[14px_20px_12px]">
            <span className="font-display text-[16px] font-semibold tracking-[-0.005em] text-navy">
              {QUEUE_CARD_TITLE}
              <em className="font-normal italic text-gold">{QUEUE_CARD_EM}</em>
            </span>
            {counts.queued > 0 && (
              <span className="shrink-0 text-[10px] font-semibold tracking-[0.06em] text-navy-3">
                {counts.queued} student{counts.queued === 1 ? "" : "s"}
              </span>
            )}
          </div>
          {board.queue.length === 0 ? (
            <p className="p-[18px_20px] text-[12px] italic text-navy-3">{EMPTY_QUEUE}</p>
          ) : (
            board.queue.map((q, i) => (
              <div
                key={q.visitId}
                className="grid grid-cols-[70px_1fr_130px_80px] items-center gap-[14px] border-b border-border p-[14px_20px] last:border-b-0"
              >
                <div className="font-mono text-[13px] font-semibold text-navy">
                  {hhmm(q.presentedAt)}
                  <span className="mt-[2px] block font-sans text-[9px] font-bold uppercase tracking-[0.08em] text-gold">
                    {formatWait(waits[i])}
                  </span>
                </div>
                <div>
                  {/* The NAME is the link, not the row: a button nested inside a link is an a11y
                      defect, and the row carries the `Begin visit` control. */}
                  <a
                    href={`/senior/sickbay/visits/${q.visitId}`}
                    className="mb-px block text-[13px] font-semibold text-navy no-underline hover:text-gold"
                  >
                    {q.studentName}
                  </a>
                  <div className="text-[11px] text-navy-3">
                    <Bold
                      text={studentMeta(q.formLabel, q.houseName, q.studentCode, true)}
                    />
                  </div>
                  {/* R123 — the neutral marker, rendered ONLY when the actor may read a plan for this
                      student; nothing at all otherwise (never its negation, never the condition). */}
                  {q.hasCarePlan && (
                    <span className="mt-[3px] inline-block rounded-full bg-gold-bg px-[7px] py-px text-[9px] font-bold uppercase tracking-[0.06em] text-gold">
                      {CARE_PLAN_MARKER}
                    </span>
                  )}
                </div>
                {/* A6 — the ONE named adjacency exception, rendered verbatim and UN-TRUNCATED: a
                    truncated complaint is a MISREAD complaint, and triage ordering is impossible
                    without it. On screen only — this is the independent reason `Print day sheet` is
                    omitted. */}
                <div className="text-[12px] text-navy-2">{q.complaint}</div>
                {/* The surface's `.queue-row .q-action { text-align:right }`. The 80px track is the
                    surface's own and stays FIXED: this cell also renders the action's error `<p>`,
                    and an `auto` track would size to that longest message and squeeze the name
                    column on every row. */}
                <div className="text-right">
                  {canWrite && <BeginVisitButton visitId={q.visitId} />}
                </div>
              </div>
            ))
          )}
        </div>

        {/* ═══ bed board — ABSENT FROM THE DOM in Mode C, with no explanatory panel (R89) ═══ */}
        {board.beds && (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="flex items-baseline justify-between gap-[14px] border-b border-border p-[14px_20px_12px]">
              <span className="font-display text-[16px] font-semibold tracking-[-0.005em] text-navy">
                {BEDS_CARD_TITLE}
                <em className="font-normal italic text-gold">{BEDS_CARD_EM}</em>
              </span>
              {counts.bedsTotal > 0 && (
                <span className="shrink-0 text-[10px] font-semibold tracking-[0.06em] text-navy-3">
                  {bedOccupancyMeta(occupiedBeds, counts.bedsTotal)}
                </span>
              )}
            </div>
            {board.bedTiles.length === 0 ? (
              <p className="p-[18px_20px] text-[12px] italic text-navy-3">
                <BoldLink text={NO_BEDS} href="/senior/sickbay/setup" />
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-[10px] p-[18px_20px] md:grid-cols-3 xl:grid-cols-4">
                {board.bedTiles.map((b) => (
                  <div
                    key={b.bedNumber}
                    className={`relative flex min-h-[100px] flex-col gap-[6px] rounded-[10px] p-[14px] ${
                      b.occupant
                        ? "border-[1.5px] border-gold bg-[linear-gradient(180deg,var(--surface)_0%,var(--gold-bg)_100%)]"
                        : b.isIsolation
                          ? "border border-dashed border-terra bg-surface"
                          : "border border-dashed border-border bg-surface"
                    }`}
                  >
                    <div
                      className={`font-mono text-[10px] font-bold uppercase tracking-[0.1em] ${
                        b.occupant ? "text-navy-2" : "text-navy-3"
                      }`}
                    >
                      {bedLabel(b.bedNumber)}
                      {b.isIsolation && (
                        <span className="ml-[6px] inline-block rounded-full bg-terra-bg px-[6px] py-px text-[8px] font-bold tracking-[0.08em] text-terra">
                          {ISO_TAG}
                        </span>
                      )}
                    </div>
                    {b.occupant ? (
                      <>
                        <div className="font-display text-[14px] font-semibold tracking-[-0.005em] text-navy">
                          {b.occupant.studentName}
                        </div>
                        <div className="text-[10px] text-navy-3">
                          <Bold
                            text={studentMeta(
                              b.occupant.formLabel,
                              b.occupant.houseName,
                              null,
                              false,
                            )}
                          />
                        </div>
                        {/* A1 — the condition is REMOVED and the slot re-toned navy-3: terra signals
                            a clinical alarm and a duration is not an alarm. */}
                        <div className="mt-auto border-t border-gold-soft pt-[6px] text-[10px] font-bold uppercase tracking-[0.06em] text-navy-3">
                          {formatElapsed(now.getTime() - b.occupant.admittedAt.getTime())}
                        </div>
                      </>
                    ) : (
                      <div className="mt-auto text-[11px] italic text-navy-3">
                        {BED_EMPTY_STATE}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ §03 · Recent visits · 24h — a SECTION of this route, not a second one ═══ */}
      <section className="mt-8 overflow-hidden rounded-[14px] border border-border bg-surface">
        <div className="flex items-end justify-between gap-[14px] border-b border-border bg-[linear-gradient(180deg,var(--bg)_0%,var(--surface)_100%)] p-[18px_22px_16px]">
          <div>
            <h3 className="font-display text-[20px] font-semibold tracking-[-0.01em] text-navy">
              {log.length}{" "}
              <em className="font-normal italic text-gold">
                {log.length === 1 ? LOG_CARD_EM.slice(0, -1) : LOG_CARD_EM}
              </em>
              {LOG_CARD_TAIL}
            </h3>
            <p className="mt-[3px] text-[12px] text-navy-3">{LOG_HEAD_NOTE}</p>
            {logLede && (
              <p className="mt-[3px] text-[12px] text-navy-3">
                <Bold text={logLede} />
              </p>
            )}
          </div>
          {/* The surface's pulsing dot is dropped: a green pulse beside a frozen server timestamp
              asserts a liveness this page does not have. The reload is the refresh. */}
          <div className="shrink-0 rounded-md border border-border bg-bg px-[10px] py-[5px] font-mono text-[13px] font-semibold text-navy">
            {asOf(now)}
          </div>
        </div>
        {log.length === 0 ? (
          <p className="p-[18px_22px] text-[12px] italic text-navy-3">{EMPTY_LOG}</p>
        ) : (
          log.map((r) => (
            <a
              key={r.visitId}
              href={`/senior/sickbay/visits/${r.visitId}`}
              className="grid grid-cols-[74px_1fr_110px] items-center gap-[14px] border-b border-border p-[12px_20px] text-[12px] no-underline last:border-b-0 hover:bg-bg"
            >
              <div className="font-mono text-[12px] font-semibold text-navy-2">
                {hhmm(r.presentedAt)}
                <span className="mt-px block font-sans text-[9px] font-bold uppercase tracking-[0.08em] text-gold">
                  {dayLabel(r.presentedAt, now)}
                </span>
              </div>
              <div>
                <div className="text-[12px] font-semibold text-navy">{r.studentName}</div>
                {/* A12 — the clinical fragment is GONE. Nothing on a closed visit is being decided
                    from this list; time + name + form + House + outcome finds the row, and the
                    content is one click away in the record. */}
                <div className="mt-px text-[11px] leading-[1.5] text-navy-3">
                  <Bold text={studentMeta(r.formLabel, r.houseName, null, false)} />
                </div>
              </div>
              <div className="text-right">
                <span
                  className={`inline-block rounded-full px-[9px] py-[3px] text-[9px] font-bold uppercase tracking-[0.06em] ${PILL[r.pill.tone]}`}
                >
                  {r.pill.label}
                </span>
              </div>
            </a>
          ))
        )}
      </section>
    </div>
  );
}

const PILL = {
  discharge: "bg-green-bg text-green",
  admit: "bg-gold-bg text-gold",
  refer: "bg-terra-bg text-terra",
  open: "border border-border bg-bg text-navy-3",
} as const;

/** `**bold**` → `<b>`, through the shipped splitter. No copy is authored inside a component. */
function Bold({ text }: { text: string }) {
  return (
    <>
      {splitBold(text).map((part, i) =>
        i % 2 === 1 ? (
          <b key={i} className="font-semibold text-navy-2">
            {part}
          </b>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/** Same splitter, but the emphasised fragment IS the link — the two empty states point at setup. */
function BoldLink({ text, href }: { text: string; href: string }) {
  return (
    <>
      {splitBold(text).map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={href} className="font-semibold text-gold no-underline">
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function Tile({
  label,
  value,
  subNum,
  meta,
  active,
}: {
  label: string;
  value: string;
  subNum: string | null;
  meta: string | null;
  active: boolean;
}) {
  return (
    <div
      className={`relative rounded-xl bg-surface p-[16px_18px] ${
        active
          ? "border-[1.5px] border-gold bg-[linear-gradient(180deg,var(--surface)_0%,var(--gold-bg)_100%)]"
          : "border border-border"
      }`}
    >
      {/* A STATE marker (this tile is non-zero), never a liveness claim — nothing polls. */}
      {active && (
        <span className="absolute right-[14px] top-[14px] size-2 rounded-full bg-green ring-4 ring-green-bg" />
      )}
      <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
        {label}
      </div>
      <div className="mt-[3px] font-display text-[32px] font-semibold leading-[1.05] tracking-[-0.018em] text-navy">
        {value}
        {subNum && (
          <span className="font-mono text-[14px] font-medium text-navy-3">{subNum}</span>
        )}
      </div>
      {meta && (
        <div className="mt-1 text-[10px] italic text-navy-3">
          <Bold text={meta} />
        </div>
      )}
    </div>
  );
}

/**
 * One open admission. 🔴 R87 — the `.ab-line` keeps its slot and its dashed border and loses its
 * clinical prose: `working_impression` / `hydration_status` / `plan` are not even fetched. What is
 * left is location and time — the tier the module already commits to disclosing to a housemaster.
 * The `.ab-vitals` grid SURVIVES (A14): the glance-check on a patient ten metres away is a genuine
 * patient-safety instrument, and removing it would push the matron to open full records MORE often.
 */
function AdmittedBlock({ p, now }: { p: SickbayWardPatient; now: Date }) {
  // `studentFullName` — the deliberate exception, printed in full because the surface's `.ab-name`
  // splits it into `{first} <em>{last}</em>`. Every other name on this board arrives abbreviated.
  const parts = p.studentFullName.trim().split(/\s+/);
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  const first = parts.length > 1 ? parts.slice(0, -1).join(" ") : p.studentFullName;
  const v = p.latestVital;
  const overdue =
    p.expectedDischargeAt !== null && p.expectedDischargeAt.getTime() < now.getTime();

  return (
    <div className="mb-6 rounded-[14px] border-[1.5px] border-gold bg-[linear-gradient(180deg,var(--gold-bg)_0%,var(--surface)_100%)] p-[20px_24px]">
      <div className="mb-[10px] flex items-start justify-between gap-[14px]">
        <div>
          <div className="font-display text-[20px] font-semibold tracking-[-0.01em] text-navy">
            {first} <em className="font-normal italic text-gold">{last}</em>
            {admittedBedSuffix(p.bedNumber, p.isIsolation)}
          </div>
          <div className="mt-[3px] text-[11px] text-navy-3">
            <Bold
              text={admittedMeta({
                formLabel: p.formLabel,
                houseName: p.houseName,
                studentCode: p.studentCode,
                admittedStamp: stampLabel(p.admittedAt, now),
                admittedByName: p.admittedByName,
                elapsed: formatElapsed(now.getTime() - p.admittedAt.getTime()),
              })}
            />
          </div>
        </div>
        {/* The chronic tag is OMITTED (A3): a condition beside a name, above the fold, on the page
            the matron leaves open all day. It returns at INCR-23 inside the visit record only. */}
        <span className="shrink-0 rounded-full bg-gold px-[9px] py-[3px] text-[9px] font-bold uppercase tracking-[0.08em] text-navy">
          {ADMITTED_TAG}
        </span>
      </div>

      {v ? (
        <div className="mt-[14px] grid grid-cols-2 gap-[10px] rounded-lg border border-gold-soft bg-surface p-3 sm:grid-cols-3 lg:grid-cols-5">
          <VitalTile
            label={WARD_VITAL_LABELS[0]}
            value={v.tempC === null ? null : `${v.tempC.toFixed(1)}°C`}
            tone={tone(vitalSeverity("tempC", v.tempC, true))}
            sub={`${hhmm(v.takenAt)} last`}
          />
          <VitalTile
            label={WARD_VITAL_LABELS[1]}
            value={
              v.systolic !== null && v.diastolic !== null
                ? `${v.systolic}/${v.diastolic}`
                : null
            }
            tone="text-navy"
            sub={`${hhmm(v.takenAt)} last`}
          />
          <VitalTile
            label={WARD_VITAL_LABELS[2]}
            value={v.pulseBpm === null ? null : `${v.pulseBpm} bpm`}
            tone={tone(vitalSeverity("pulseBpm", v.pulseBpm, true))}
            sub={`${hhmm(v.takenAt)} last`}
          />
          <VitalTile
            label={WARD_VITAL_LABELS[3]}
            value={v.spo2Pct === null ? null : `${v.spo2Pct}%`}
            tone={tone(vitalSeverity("spo2Pct", v.spo2Pct, true))}
            sub={`${hhmm(v.takenAt)} last`}
          />
          <VitalTile
            label={WARD_VITAL_LABELS[4]}
            value={v.painScore === null ? null : `${v.painScore} / 10`}
            tone={v.painScore === null ? "text-navy" : PAIN_TONE[painLevel(v.painScore)]}
            // The trend survives exactly where the surface put it — arithmetic over stored rows,
            // never an alert (R45).
            sub={
              v.painScore === null ||
              p.firstPainScore === null ||
              p.firstPainScore === v.painScore
                ? null
                : `${v.painScore < p.firstPainScore ? "down" : "up"} from ${p.firstPainScore}`
            }
          />
        </div>
      ) : (
        <p className="mt-[14px] text-[11px] italic text-navy-3">{NO_READINGS}</p>
      )}

      {/* `.ab-line` — the slot and the dashed border survive; the prose does not. The line ALWAYS
          renders, even with no expected-discharge stamp, because the link is the point of it. */}
      <div className="mt-3 border-t border-dashed border-gold-soft pt-[10px] text-[12px] leading-[1.6] text-navy-2">
        {p.expectedDischargeAt && (
          <>
            {EXPECTED_DISCHARGE}{" "}
            <b className="font-semibold text-navy-2">
              {stampLabel(p.expectedDischargeAt, now)}
            </b>{" "}
          </>
        )}
        {overdue && (
          <>
            · <b className="font-semibold text-gold">{REASSESSMENT_OVERDUE}</b>{" "}
          </>
        )}
        <a
          href={`/senior/sickbay/visits/${p.visitId}`}
          className="font-semibold text-gold no-underline"
        >
          {OPEN_RECORD}
        </a>
      </div>
    </div>
  );
}

const PAIN_TONE = {
  min: "text-navy",
  low: "text-warn",
  mod: "text-warn",
  high: "text-terra",
} as const;

const tone = (sev: ReturnType<typeof vitalSeverity>): string =>
  sev === "elevated" ? "text-terra" : sev === "warn" ? "text-warn" : "text-navy";

/**
 * One measure. 🔴 A metric absent from the latest reading renders BLANK — never `—` and never `0`:
 * a dash in a vitals grid reads as "measured and normal" to a nurse.
 */
function VitalTile({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string | null;
  tone: string;
  sub: string | null;
}) {
  return (
    <div>
      <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3">
        {label}
      </div>
      <div className={`font-mono text-[14px] font-semibold ${tone}`}>{value ?? " "}</div>
      {value !== null && sub && (
        <div className="mt-[2px] text-[9px] italic text-navy-3">{sub}</div>
      )}
    </div>
  );
}
