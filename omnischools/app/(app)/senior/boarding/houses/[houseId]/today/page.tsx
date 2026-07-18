import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { BOARDING_ROLES } from "@/lib/access";
import { getDailyLife, type DailyLifeView, type DormInspection } from "@/lib/boarding/daily-data";
import { isLightColour } from "@/lib/boarding/roster";
import {
  DailyInspectionButton,
  WeeklyInspectionButton,
  PrepExceptionLog,
  ScrubbingAttendanceButton,
} from "@/components/boarding/daily-life-client";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const shiftDate = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export default async function HouseTodayPage({
  params,
  searchParams,
}: {
  params: { houseId: string };
  searchParams: { date?: string };
}) {
  const { school, user } = await requireSchoolRole(BOARDING_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  // Reload roles/id for the house-scope guard (dev bypass returns a fixed ADMIN — mirror roster).
  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  const userId = current?.id ?? user.id;

  const date = searchParams.date && DATE_RE.test(searchParams.date) ? searchParams.date : undefined;
  const view = await getDailyLife(school.id, params.houseId, roles, userId, date);
  if (!view) notFound();

  const light = isLightColour(view.house.colour);
  const strip = {
    backgroundColor: view.house.colour ?? "var(--navy)",
    color: light ? "var(--navy)" : "var(--bg)",
  } as const;

  return (
    <div className="mx-auto max-w-page pb-16">
      <div className="mb-5 flex items-center justify-between">
        <Link
          href={`/senior/boarding/houses/${view.house.id}/roster`}
          className="text-[11px] font-semibold uppercase tracking-[0.16em] text-navy-3 hover:text-navy"
        >
          ← {view.house.name} · Roster
        </Link>
        <div className="flex items-center gap-2 text-[11px]">
          <Link
            href={`/senior/boarding/houses/${view.house.id}/today?date=${shiftDate(view.dateIso, -1)}`}
            className="rounded-md border border-border bg-surface px-2.5 py-1 font-semibold text-navy hover:border-gold"
          >
            ← Prev day
          </Link>
          {!view.isToday && (
            <Link
              href={`/senior/boarding/houses/${view.house.id}/today`}
              className="rounded-md border border-border bg-surface px-2.5 py-1 font-semibold text-navy hover:border-gold"
            >
              Today
            </Link>
          )}
          <Link
            href={`/senior/boarding/houses/${view.house.id}/today?date=${shiftDate(view.dateIso, 1)}`}
            className="rounded-md border border-border bg-surface px-2.5 py-1 font-semibold text-navy hover:border-gold"
          >
            Next day →
          </Link>
        </div>
      </div>

      {/* House strip — house.colour is USER DATA, inline style only. Muted labels use element
          opacity (the sanctioned form), never slash-opacity on the raw hex. */}
      <div
        className={`flex flex-wrap items-center gap-4 rounded-t-xl px-6 py-5 ${
          light ? "border-2 border-b-0 border-border-2" : ""
        }`}
        style={strip}
      >
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-bg font-display text-xl font-bold"
          style={{ color: view.house.colour ?? "var(--navy)" }}
        >
          {view.house.name.charAt(0).toUpperCase()}
        </span>
        <div className="flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-80">
            {view.house.name} House · HM {view.house.hmName ?? "unassigned"} · {view.dayLabel}
          </div>
          <h1 className="font-display text-2xl font-semibold leading-tight">
            Today, by the rhythm{" "}
            <em className="italic opacity-90">· the operating day</em>
          </h1>
        </div>
        <div className="flex gap-6 text-right">
          <Stat label="In House now" value={view.counts.inHouse} />
          <Stat label="Sick bay" value="—" />
          <Stat label="Exeats today" value={view.counts.exeatsToday} />
          <Stat label="Lights out" value={view.counts.lightsOut ?? "—"} />
        </div>
      </div>

      {/* NOW strip — derived from the clock; pulses only when live (today). */}
      <NowStrip view={view} />

      {/* Head row */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-x border-border bg-surface px-6 py-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">
            Boarding &amp; residential life · Houses · {view.house.name} · Today&apos;s operational view
          </div>
          <h2 className="mt-1 font-display text-xl font-semibold text-navy">
            {view.dayLabel.split("·")[0]} <em className="italic text-gold">· {view.dateIso}</em>
          </h2>
          <div className="mt-1 text-[12px] text-navy-3">
            {view.counts.boarderCount} boarders · {view.counts.currentlyOut} currently off campus ·
            day type <b className="text-navy-2">{view.dayType}</b>
          </div>
        </div>
      </div>

      {/* Summary cards — every number derived; the scrubbing card is suppressed on non-scrubbing days. */}
      <div className="grid grid-cols-2 gap-3 border-x border-border bg-bg px-6 py-5 md:grid-cols-5">
        <SumCard featured label="In House right now" big={`${view.counts.inHouse} / ${view.counts.boarderCount}`}>
          {view.counts.currentlyOut === 0 ? "all boarders on campus" : `${view.counts.currentlyOut} on exeat`}
          {" · sick-bay not subtracted"}
        </SumCard>
        <SumCard
          green={view.inspection.pending === 0 && view.inspection.partial === 0 && view.inspection.fail === 0}
          warn={view.inspection.partial > 0 || view.inspection.fail > 0}
          label="Morning inspection"
          big={`${view.inspection.pass} of ${view.inspection.total} pass`}
        >
          {view.inspection.pending > 0
            ? `${view.inspection.pending} dorm(s) not yet inspected`
            : `${view.inspection.partial} partial · ${view.inspection.fail} fail`}
        </SumCard>
        <SumCard label="Tonight's prep" big={view.counts.lightsOut ? "19:00" : "—"}>
          {view.prep.rosterCount} expected · {view.prep.late} late · {view.prep.absent} absent
        </SumCard>
        {view.scrubbing.active && (
          <SumCard warn label="Mid-week scrubbing" big={view.scrubbing.range ?? "—"}>
            {weekdayLong(view.dateIso)} · House yards, dining hall
          </SumCard>
        )}
        <SumCard label="Sick bay queue" big="—">
          Placeholder · sick bay module ships separately
        </SumCard>
      </div>

      <div className="rounded-b-xl border-x border-b border-border bg-surface px-6 py-6">
        {/* ---- Day timeline ---- */}
        <Block
          eyebrow="The day timeline · what has happened, what is happening, what is coming"
          title={
            <>
              Today, by the rhythm <em className="italic text-gold">· render of the schedule</em>
            </>
          }
          meta={
            <>
              <b className="text-navy-2">Done</b> green · <b className="text-navy-2">NOW</b> gold ·{" "}
              <b className="text-navy-2">upcoming</b> faded
            </>
          }
        >
          {!view.configured || !view.timeline ? (
            <div className="rounded-xl border border-dashed border-border-2 bg-bg px-4 py-8 text-center text-sm text-navy-3">
              This day type (<b>{view.dayType}</b>) is not configured. Set up its rhythm in the
              boarding programme to see the timeline.
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap gap-0 border-b border-border pb-3">
                {view.timeline.slots.map((s, i) => (
                  <div
                    key={i}
                    className={`min-w-[70px] flex-1 border-r border-dashed border-border px-1.5 py-2 text-center last:border-r-0 ${
                      s.state === "done"
                        ? "bg-green-bg"
                        : s.state === "now"
                          ? "border-b-[3px] border-b-gold bg-gold-bg"
                          : "opacity-65"
                    }`}
                  >
                    <div
                      className={`font-mono text-[10px] font-semibold ${
                        s.state === "done" ? "text-green" : s.state === "now" ? "text-navy" : "text-navy-3"
                      }`}
                    >
                      {s.startLabel}
                    </div>
                    <div className="mt-1 font-display text-[11px] font-semibold leading-tight text-navy-2">
                      {s.short}
                      {s.state === "now" && <em className="italic text-gold"> · now</em>}
                    </div>
                  </div>
                ))}
              </div>
              {/* Rail-foot minis */}
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                {view.scrubbing.active && (
                  <Mini label={`${weekdayShort(view.dateIso)} accent`} value="Scrubbing" sub={view.scrubbing.range ?? "afternoon"} />
                )}
                {view.washing.active && (
                  <Mini label={`${weekdayShort(view.dateIso)} accent`} value="Washing" sub="Personal laundry · afternoon" />
                )}
                {view.f3Accent && (
                  <Mini
                    label="F3 only"
                    value="Prep ext"
                    sub={`Lights out ${view.f3Accent.lightsOutF3} vs ${view.f3Accent.lightsOutAll} · WASSCE prep`}
                  />
                )}
                <Mini
                  label="Tonight"
                  value={weekdayShort(view.dateIso) === "Thu" ? "Club night" : "Club · Thu only"}
                  sub={
                    weekdayShort(view.dateIso) === "Thu"
                      ? "Clubs & societies"
                      : "No club tonight · clubs are Thursdays"
                  }
                  negative={weekdayShort(view.dateIso) !== "Thu"}
                />
              </div>
            </div>
          )}
        </Block>

        {/* ---- Daily inspection grid ---- */}
        <Block
          eyebrow={`This morning · daily inspection · ${view.inspection.pass} of ${view.inspection.total} dorms passed`}
          title={
            <>
              Daily inspection <em className="italic text-gold">· bunks, lockers, attire</em>
            </>
          }
          meta="Conducted by HM with House Prefects · the Saturday weekly inspection is a separate, deeper cadence"
        >
          {view.inspection.dorms.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-2 bg-bg px-4 py-8 text-center text-sm text-navy-3">
              No dormitories configured for this House yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {view.inspection.dorms.map((d) => (
                <DormCard key={d.dormId} dorm={d} />
              ))}
            </div>
          )}
        </Block>

        {/* ---- Weekly inspection pane (Saturday-scoped view — a design addition) ---- */}
        <Block
          eyebrow="Weekly inspection · the deep whole-house check · Saturday cadence"
          title={
            <>
              Weekly inspection <em className="italic text-gold">· washrooms, drying lines, stores</em>
            </>
          }
          meta={
            view.weeklyDay
              ? "It's Saturday — the weekly-inspection day"
              : "Separate cadence from the daily grid (Saturday 08:00, whole House)"
          }
          actions={<WeeklyInspectionButton houseId={view.house.id} houseName={view.house.name} />}
        >
          {view.weekly ? (
            <div
              className={`rounded-xl border p-5 ${
                view.weekly.result === "PASS"
                  ? "border-green bg-green-bg"
                  : view.weekly.result === "PARTIAL"
                    ? "border-warn bg-warn-bg"
                    : "border-terra bg-terra-bg"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="font-display text-lg font-semibold text-navy">
                  Whole House · {view.weekly.result}
                </div>
                <div className="text-[11px] text-navy-3">
                  {view.weekly.inspectedAtLabel} · {view.weekly.inspectorName ?? "staff"} ·{" "}
                  {view.weekly.anomalies} anomal{view.weekly.anomalies === 1 ? "y" : "ies"}
                </div>
              </div>
              {view.weekly.findings && (
                <ul className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {view.weekly.findings.areas.map((a, i) => (
                    <li key={i} className="flex items-center gap-2 text-[12px] text-navy-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          a.result === "OK" ? "bg-green text-bg" : "bg-terra text-bg"
                        }`}
                      >
                        {a.result}
                      </span>
                      <b className="text-navy">{a.area}</b>
                      {a.note ? <span className="text-navy-3">· {a.note}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border-2 bg-bg px-4 py-8 text-center text-sm text-navy-3">
              No weekly inspection recorded for {view.dateIso}. The weekly check runs Saturday mornings
              (whole House, top to bottom).
            </div>
          )}
        </Block>

        {/* ---- Tonight's prep (navy card — solid tokens, no slash-opacity on the hex) ---- */}
        <Block
          eyebrow="Tonight · prep · the supervised study period"
          title={
            <>
              Tonight&apos;s prep <em className="italic text-gold">· the exception log</em>
            </>
          }
          meta="F3 stays later for WASSCE prep · present-by-default · only exceptions are logged"
        >
          <div className="rounded-2xl bg-navy p-6 text-bg">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-navy-2 pb-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold-soft">
                  Prep · {view.dayLabel}
                </div>
                <h4 className="mt-1 font-display text-xl font-semibold">
                  {view.prep.rosterCount} boarders expected{" "}
                  <em className="italic text-gold">· {view.prep.present} present</em>
                </h4>
              </div>
              <div className="font-mono text-[13px] font-semibold text-gold-soft">
                {view.prep.late} late · {view.prep.absent} absent · {view.prep.excused} excused ·{" "}
                {view.prep.medical} medical
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {view.prep.byForm.length === 0 ? (
                <div className="rounded-lg border border-navy-2 bg-navy-2 p-4 text-[12px] text-gold-soft">
                  No boarders on the roster tonight.
                </div>
              ) : (
                view.prep.byForm.map((f) => (
                  <div key={f.form} className="rounded-lg border border-navy-2 bg-navy-2 p-4">
                    <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-gold-soft">
                      {f.form}
                    </div>
                    <div className="mt-1 font-display text-lg font-semibold">
                      {f.count} <span className="text-[12px] font-normal text-gold-soft">boarders</span>
                    </div>
                  </div>
                ))
              )}
            </div>
            <p className="mt-4 rounded-lg bg-navy-2 px-4 py-3 text-[11px] leading-relaxed text-gold-soft">
              If a boarder is more than 5 minutes late, the prep prefect logs it; the HM reviews at
              9 PM. Late, absent, excused &amp; medical are the only states written — everyone else is
              present by default.
            </p>
          </div>

          <div className="mt-4">
            <PrepExceptionLog
              houseId={view.house.id}
              dateIso={view.dateIso}
              boarders={view.boarderOptions}
            />
          </div>

          {view.prepEntries.length > 0 && (
            <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
              {view.prepEntries.map((e, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 px-4 py-2 text-[12px]">
                  <span className="font-semibold text-navy">{e.studentName}</span>
                  {e.formLabel && <span className="text-navy-3">· {e.formLabel}</span>}
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${statusPill(e.status)}`}
                  >
                    {e.status}
                    {e.status === "LATE" && e.minutesLate != null ? ` +${e.minutesLate}m` : ""}
                  </span>
                  {e.note && <span className="text-navy-3">· {e.note}</span>}
                  {e.loggedByName && (
                    <span className="ml-auto text-[11px] text-navy-3">by {e.loggedByName}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Block>

        {/* ---- Wed scrubbing accent (Wed-only) ---- */}
        {view.scrubbing.active && (
          <Block
            eyebrow="Mid-week accent · the cleaning beat"
            title={
              <>
                Mid-week scrubbing <em className="italic text-warn">· {view.scrubbing.range ?? "afternoon"}</em>
              </>
            }
            meta={`${weekdayLong(view.dateIso)}-only · House yards, dining hall, washroom block`}
          >
            <div className="flex flex-wrap items-center gap-5 rounded-xl border-[1.5px] border-warn bg-warn-bg p-5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-warn font-display text-lg font-semibold text-bg">
                SCB
              </div>
              <div className="flex-1">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-warn">
                  Scrubbing · {view.scrubbing.range ?? "afternoon"}
                </div>
                <h4 className="mt-0.5 font-display text-base font-semibold text-navy">
                  House yards, dining hall, washroom block
                </h4>
                <div className="mt-1 text-[11px] text-navy-2">
                  The mid-week cleaning beat layered on the daily morning duties.
                  {view.washing.active ? " Washing days too — personal laundry this afternoon." : ""}
                </div>
              </div>
              <ScrubbingAttendanceButton />
            </div>
          </Block>
        )}

        {/* ---- Sick bay placeholder (BINDING override: shell + badge + note + empty state only) ---- */}
        <Block
          eyebrow="Sick bay · light log · full module ships in a separate batch"
          title={
            <>
              Sick bay <em className="italic text-gold">· today&apos;s traffic</em>
            </>
          }
          meta="Placeholder until the sick bay / matron batch (module 4.4) ships"
        >
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="flex items-start justify-between border-b border-dashed border-border pb-3">
              <div>
                <h4 className="font-display text-base font-semibold text-navy">
                  — visits today <em className="italic text-gold">· count not yet tracked</em>
                </h4>
                <div className="mt-1 text-[10px] text-navy-3">
                  Count stubbed (0/—) · does not feed the in-House number
                </div>
              </div>
              <span className="rounded-pill border border-border bg-bg px-2.5 py-1 text-[9px] font-bold tracking-[0.08em] text-navy-3">
                LIGHT · PLACEHOLDER
              </span>
            </div>
            <div className="py-6 text-center text-sm text-navy-3">
              No sick-bay records here yet — patient records, temperatures and parent notifications are
              owned by the sick bay / matron module (module 4.4), which gets its own batch.
            </div>
            <p className="rounded-lg border-l-[3px] border-gold bg-bg px-4 py-3 text-[11px] leading-relaxed text-navy-2">
              The light log <b className="text-navy">captures the boarding-day relevant fact</b>: who is
              not in their usual place during scheduled activities?{" "}
              <em className="font-display italic text-gold">The matron&apos;s medical record</em> —
              symptoms, treatment, family history, parent calls — is owned by the sick bay module, which
              gets its own batch. The boarding day surface only needs the operational fact: who is in
              sick bay, not in their dorm, not at prep tonight unless cleared.
            </p>
          </div>
        </Block>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Server sub-components
// ---------------------------------------------------------------------------

function NowStrip({ view }: { view: DailyLifeView }) {
  const now = view.timeline?.now ?? null;
  const next = view.timeline?.next ?? null;
  const live = view.timeline?.live ?? false;
  return (
    <div className="flex flex-wrap items-center gap-4 border-x border-b border-gold-soft bg-gold-bg px-6 py-4">
      <span className="flex items-center gap-1.5 rounded-pill bg-gold px-3 py-1.5 text-[10px] font-bold tracking-[0.1em] text-navy">
        {live && now && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-navy" />}
        {now ? "NOW" : "NEXT"}
      </span>
      <div className="flex-1">
        {now ? (
          <>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
              Current activity · {now.minutesIn} min in · {now.minutesRemaining} min remaining
            </div>
            <h4 className="font-display text-lg font-semibold text-navy">
              {now.activity.split("·")[0].trim()}
              {now.note && <em className="italic text-gold"> {now.note}</em>}
            </h4>
            <div className="mt-0.5 text-[11px] text-navy-2">
              {now.startLabel}
              {now.endLabel ? ` — ${now.endLabel}` : ""} · {view.counts.inHouse} of{" "}
              {view.counts.boarderCount} in House · {now.who}
            </div>
          </>
        ) : next ? (
          <>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
              Between activities
            </div>
            <h4 className="font-display text-lg font-semibold text-navy">
              Next · {next.short} <em className="italic text-gold">· in {next.minutesUntil} min</em>
            </h4>
            <div className="mt-0.5 text-[11px] text-navy-2">Begins {next.startLabel}</div>
          </>
        ) : (
          <>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
              {view.configured ? "Outside the day" : "Not configured"}
            </div>
            <h4 className="font-display text-lg font-semibold text-navy">
              {view.configured
                ? view.isToday
                  ? "The day has wound down · lights out"
                  : "No live activity for this date"
                : "This day type has no rhythm configured"}
            </h4>
          </>
        )}
      </div>
      {now && (
        <div className="text-right font-mono text-2xl font-semibold text-navy">
          {now.startLabel}
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3">
            {now.minutesRemaining} min left
          </div>
        </div>
      )}
    </div>
  );
}

function DormCard({ dorm }: { dorm: DormInspection }) {
  const r = dorm.latest;
  const tone = !r
    ? "border-border bg-surface"
    : r.result === "PASS"
      ? "border-l-[3px] border-l-green bg-surface"
      : r.result === "PARTIAL"
        ? "border-l-[3px] border-l-warn bg-warn-bg"
        : "border-l-[3px] border-l-terra bg-terra-bg";
  const pill = !r
    ? "bg-bg text-navy-3 border border-border"
    : r.result === "PASS"
      ? "bg-green text-bg"
      : r.result === "PARTIAL"
        ? "bg-warn text-bg"
        : "bg-terra text-bg";
  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <div className="mb-2 flex items-start justify-between border-b border-dashed border-border pb-2">
        <div>
          <h5 className="font-display text-sm font-semibold text-navy">Dorm {dorm.name}</h5>
          <div className="mt-0.5 text-[9px] text-navy-3">{dorm.boarderCount} boarders</div>
        </div>
        <span className={`rounded-pill px-2 py-0.5 text-[9px] font-bold tracking-[0.08em] ${pill}`}>
          {r ? r.result : "PENDING"}
        </span>
      </div>
      {r ? (
        <>
          <div className="mb-1 flex items-end gap-1.5">
            <span className="font-display text-xl font-semibold text-navy">
              {r.bunksClean ?? "—"}
            </span>
            <span className="pb-0.5 text-[11px] font-semibold text-navy-3">
              / {r.bunksTotal ?? "—"} bunks clean
            </span>
          </div>
          <div className="text-[10px] leading-relaxed text-navy-3">
            {r.findings
              ? checkSummary(r.findings)
              : "Recorded"}
            {r.anomalies > 0 && <span className="text-terra"> · {r.anomalies} anomalies</span>}
          </div>
          <div className="mt-1 text-[9px] text-navy-3">
            {r.inspectedAtLabel} · {r.inspectorName ?? "staff"}
          </div>
        </>
      ) : (
        <div className="text-[11px] text-navy-3">Not yet inspected today.</div>
      )}
      <div className="mt-3">
        <DailyInspectionButton
          dormId={dorm.dormId}
          dormName={dorm.name}
          defaultTotal={dorm.boarderCount || (r?.bunksTotal ?? 0)}
          recorded={!!r}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-[9px] font-bold uppercase tracking-[0.08em] opacity-70">{label}</div>
      <div className="mt-0.5 font-display text-lg font-semibold">{value}</div>
    </div>
  );
}

function SumCard({
  label,
  big,
  children,
  featured,
  warn,
  green,
}: {
  label: string;
  big: string | number;
  children: React.ReactNode;
  featured?: boolean;
  warn?: boolean;
  green?: boolean;
}) {
  const tone = featured
    ? "bg-navy text-bg border-navy"
    : warn
      ? "bg-warn-bg border-warn"
      : green
        ? "bg-green-bg border-green"
        : "bg-surface border-border";
  const labelTone = featured ? "text-gold-soft" : warn ? "text-warn" : green ? "text-green" : "text-navy-3";
  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <div className={`text-[10px] font-bold uppercase tracking-[0.12em] ${labelTone}`}>{label}</div>
      <div className="mt-1 font-display text-xl font-semibold leading-none">{big}</div>
      <div className={`mt-1.5 text-[11px] ${labelTone}`}>{children}</div>
    </div>
  );
}

function Block({
  eyebrow,
  title,
  meta,
  actions,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">{eyebrow}</div>
          <h3 className="mt-1 font-display text-lg font-semibold text-navy">{title}</h3>
        </div>
        <div className="flex items-center gap-3">
          {meta && <div className="max-w-md text-right text-[11px] text-navy-3">{meta}</div>}
          {actions}
        </div>
      </div>
      {children}
    </div>
  );
}

function Mini({
  label,
  value,
  sub,
  negative,
}: {
  label: string;
  value: string;
  sub: string;
  negative?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 ${negative ? "border-border bg-bg opacity-70" : "border-border bg-bg"}`}>
      <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3">{label}</div>
      <div className="mt-1 font-display text-[13px] font-semibold text-navy">{value}</div>
      <div className="mt-0.5 text-[10px] text-navy-3">{sub}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function checkSummary(f: { checks: { bunks: string; lockers: string; attire: string }; flaggedBunks?: number[] }) {
  const parts = (["bunks", "lockers", "attire"] as const)
    .filter((k) => f.checks[k] === "ISSUE")
    .map((k) => k);
  if (parts.length === 0 && !(f.flaggedBunks && f.flaggedBunks.length))
    return "All checks clean";
  const bits: string[] = [];
  if (parts.length) bits.push(`${parts.join(", ")} flagged`);
  if (f.flaggedBunks && f.flaggedBunks.length) bits.push(`bunks ${f.flaggedBunks.join(", ")}`);
  return bits.join(" · ");
}

function statusPill(status: string): string {
  switch (status) {
    case "LATE":
      return "bg-warn text-bg";
    case "ABSENT":
      return "bg-terra text-bg";
    case "MEDICAL":
      return "bg-navy-2 text-bg";
    default:
      return "bg-green text-bg"; // EXCUSED
  }
}

const weekdayLong = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
const weekdayShort = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
