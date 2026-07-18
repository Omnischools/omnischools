import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { BOARDING_ROLES } from "@/lib/access";
import { getResumptionBoard, type ArrivalRow, type HouseCard } from "@/lib/boarding/resumption-data";
import { checklistItemsFor, type BoardingMode } from "@/lib/boarding/resumption";
import type { ArrivalWindow, DerivedIssue } from "@/lib/boarding/resumption";
import {
  ModeSwitch,
  HeaderActions,
  GateCheckPanel,
} from "@/components/boarding/resumption-console";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function ResumptionOperationsPage(props: {
  params: Promise<{ mode: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const { school, user } = await requireSchoolRole(BOARDING_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const modeParam = params.mode?.toLowerCase();
  if (modeParam !== "resumption" && modeParam !== "vacation") {
    redirect("/senior/boarding/operations/resumption");
  }
  const mode: BoardingMode = modeParam === "vacation" ? "VACATION" : "RESUMPTION";

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  const userId = current?.id ?? user.id;

  const date = searchParams.date && DATE_RE.test(searchParams.date) ? searchParams.date : undefined;
  const board = await getResumptionBoard(school.id, mode, roles, userId, date);
  const items = [...checklistItemsFor(mode)];

  const arriving = mode === "RESUMPTION";

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
          Boarding · Operations · {arriving ? "Resumption day" : "Vacation day"}
        </div>
        <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
          {arriving ? "Resumption" : "Vacation"} ·{" "}
          <em className="italic text-gold">
            {board.hasBoarders ? `${board.counter.expected} boarders, one screen.` : "the two chaos days."}
          </em>
        </h1>
        <div className="mb-3 mt-2 h-0.5 w-16 bg-gold" />
        <p className="max-w-2xl text-sm text-navy-3">
          {arriving ? (
            <>
              Students arrive in staggered waves (Form 3 first → Form 1 last), fees are checked, the GES
              prospectus is inspected, bunks are re-confirmed. One live view: arrival counter, House-by-House
              progress, per-student checklist, fee-owing flags, issues queue. Gate closes{" "}
              <b className="text-navy-2">{board.times.gateCloseLabel}</b>, supper {board.times.supperLabel}.
            </>
          ) : (
            <>
              The inverse of resumption — sign-outs, room clear-outs, transport-contact verification. The same
              surface, the same staff, the departure checklist: bunk cleared · locker emptied · chop box collected
              · transport verified · exeat card returned. Lock-down{" "}
              <b className="text-navy-2">{board.times.lockDownLabel}</b>, keys to Senior HM.
            </>
          )}
        </p>
      </div>

      {/* Mode switch + context + actions */}
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-bg px-4 py-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">Day mode</span>
        <ModeSwitch mode={mode} dateIso={board.dateIso} />
        <span className="text-[11px] text-navy-3">
          {board.periodLabel ? <b className="font-bold text-navy-2">{board.periodLabel}</b> : "No SHS semester"} ·{" "}
          {board.dayLabel}
          {board.isToday ? " · live" : ""}
        </span>
        <div className="ml-auto">
          <HeaderActions mode={mode} />
        </div>
      </div>

      {!board.hasBoarders ? (
        <div className="rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center">
          <h2 className="font-display text-lg font-semibold text-navy">
            {board.periodLabel ? "No boarders you can operate" : "No SHS semester configured"}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-navy-3">
            {board.periodLabel
              ? "You are not assigned to any House with active boarders, or none are enrolled for this semester."
              : "Configure the school's SHS semesters to run resumption / vacation operations."}
          </p>
        </div>
      ) : (
        <>
          {/* Live counter strip (navy) */}
          <div className="grid grid-cols-1 items-center gap-6 rounded-xl bg-navy p-6 text-bg md:grid-cols-[auto_1fr_auto]">
            <div className="flex h-24 w-24 flex-col items-center justify-center rounded-2xl bg-gold text-navy">
              <div className="font-mono text-2xl font-semibold leading-none">{board.clockLabel}</div>
              <div className="mt-1.5 text-[8px] font-bold tracking-[0.12em]">{board.clockMeridian}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
                {arriving ? "Day in progress" : "Vacation departure in progress"}
                {board.isToday ? ` · ${board.hoursIn} hours in · ${board.hoursRemaining} remaining` : ""}
              </div>
              <h3 className="mt-1 font-display text-2xl font-semibold leading-tight">
                {arriving ? "Boarders arriving" : "Boarders departing"} ·{" "}
                <em className="italic text-gold">
                  {board.counter.arrived} of {board.counter.expected}
                </em>
              </h3>
              <div className="mt-1 text-[12px] text-gold-soft opacity-75">
                <b className="text-bg opacity-100">{board.counter.pct}%</b>{" "}
                {arriving ? "arrived" : "departed"}
                {board.counter.lastArrivalLabel ? ` · last ${arriving ? "arrival" : "departure"} ${board.counter.lastArrivalLabel}` : ""}{" "}
                · current rate <b className="text-bg opacity-100">{board.counter.ratePerHour} per hour</b>
              </div>
            </div>
            <div className="md:text-right">
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-gold-soft opacity-60">
                {arriving ? "Arrived this hour" : "Departed this hour"}
              </div>
              <div className="mt-1 font-display text-4xl font-semibold leading-none">
                <em className="italic text-gold">{board.counter.arrivedThisHour}</em>
              </div>
              <div className="mt-1.5 text-[11px] text-gold-soft opacity-60">
                {board.counter.peakHourLabel
                  ? `Peak ${board.counter.peakHourLabel} · ${board.counter.peakHourCount}`
                  : "No peak hour yet"}
              </div>
            </div>
          </div>

          {/* Arrival windows rail */}
          <Section
            eyebrow="Scheduled arrival windows · staggered to spread the gate load"
            title={arriving ? "Six windows · 5 AM to 5 PM" : "Six departure windows · Form 3 leaves first"}
            meta="% arrived · per window · live"
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {board.windows.map((w) => (
                <WindowCard key={w.key} w={w} />
              ))}
            </div>
          </Section>

          {/* House-by-House grid */}
          <Section
            eyebrow="House-by-House · each HM works their own dorm"
            title={`${board.houses.length} House${board.houses.length === 1 ? "" : "s"} · each at its own pace`}
            meta="Form 3 fills first · Form 1 last"
          >
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {board.houses.map((h) => (
                <HouseProgressCard key={h.id} house={h} mode={mode} />
              ))}
            </div>
          </Section>

          {/* Live arrivals checklist + gate-check modal */}
          <Section
            eyebrow={`${arriving ? "Recent arrivals" : "Recent departures"} · ${arriving ? "GES prospectus" : "departure"} checklist + fee + bunk`}
            title={arriving ? "Live arrivals · the gate check" : "Live departures · the checkout"}
            meta={`${board.arrivals.length} shown · about 90 seconds per student`}
            actions={<GateCheckPanel mode={mode} boarders={board.boarderOptions} items={items} />}
          >
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <div className="flex items-center justify-between border-b border-border bg-bg px-5 py-3">
                <div>
                  <h5 className="font-display text-[15px] font-semibold text-navy">
                    {arriving ? "GES Prospectus" : "Departure checklist"} ·{" "}
                    <em className="italic text-gold">
                      {items.length} points{arriving ? " + fees + bunk" : ""}
                    </em>
                  </h5>
                  <div className="mt-0.5 text-[10px] text-navy-3">
                    {items.map((i) => i.label).join(" · ")}
                  </div>
                </div>
              </div>
              {board.arrivals.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-navy-3">
                  No {arriving ? "arrivals" : "departures"} recorded yet — use{" "}
                  <b>{arriving ? "Record arrival" : "Record departure"}</b> to run the first gate check.
                </p>
              ) : (
                board.arrivals.map((a) => <ChecklistRow key={a.studentId} a={a} />)
              )}
            </div>
          </Section>

          {/* Issues queue */}
          <Section
            eyebrow="Issues queue · live · Senior HM resolves or escalates"
            title="Things needing attention"
            meta={`${board.issues.length} open`}
          >
            {board.issues.length === 0 ? (
              <div className="rounded-xl border border-green bg-green-bg px-5 py-8 text-center">
                <div className="font-display text-base font-semibold text-green">No open issues</div>
                <p className="mx-auto mt-1 max-w-md text-[12px] text-navy-2">
                  Every {arriving ? "arrival" : "departure"} clean · no fee shortfalls, prospectus gaps,
                  unallocated bunks or unaccounted boarders.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border-[1.5px] border-terra bg-terra-bg p-5">
                <div className="mb-3 flex items-start justify-between border-b border-dashed border-terra pb-2.5">
                  <div>
                    <h4 className="font-display text-base font-semibold text-navy">
                      {board.issues.length} open issue{board.issues.length === 1 ? "" : "s"} ·{" "}
                      <em className="italic text-terra">{issueBreakdown(board.issues)}</em>
                    </h4>
                    <p className="mt-1 text-[11px] text-navy-2">
                      Surfaced by HM staff at the gate · routed to the Senior HM · derived, not stored (no
                      issues table).
                    </p>
                  </div>
                  <span className="rounded-pill bg-terra px-2.5 py-0.5 text-[9px] font-bold tracking-[0.08em] text-bg">
                    SENIOR HM
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {board.issues.map((i) => (
                    <div
                      key={i.id}
                      className="grid grid-cols-[70px_1fr_auto] items-center gap-3 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-[11px]"
                    >
                      <span className="font-mono text-[10px] font-semibold text-navy-3">{i.timeLabel}</span>
                      <span className="text-navy-2">{i.text}</span>
                      <span className="whitespace-nowrap font-mono text-[9px] font-semibold uppercase text-navy-3">
                        → {i.routing}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>

          {/* Foot bar (navy) */}
          <div className="mt-8 grid grid-cols-2 gap-5 rounded-xl bg-navy px-6 py-5 text-bg md:grid-cols-4">
            <FootStat label={arriving ? "Arrived so far" : "Departed so far"} value={board.foot.arrivedLabel} sub={`${board.foot.pct}%`} />
            <FootStat
              label={arriving ? "Fee-owing arrivals" : "Departing · still owing"}
              value={String(board.foot.feeOwingArrivals)}
              sub="flagged · never detained"
            />
            <FootStat
              label={arriving ? "Prospectus shortfalls" : "Checklist shortfalls"}
              value={`${board.foot.shortfalls}`}
              sub="conditional · logged"
            />
            <FootStat
              label={arriving ? "Time to gate close" : "Time to lock-down"}
              value={board.foot.timeToGateCloseLabel}
              sub={`${board.times.gateCloseLabel} · supper ${board.times.supperLabel}`}
            />
          </div>
        </>
      )}
    </div>
  );
}

function issueBreakdown(issues: DerivedIssue[]): string {
  const counts = new Map<string, number>();
  for (const i of issues) counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
  return (
    Array.from(counts, ([cat, n]) => `${n} ${cat}`).join(" · ") || "0"
  );
}

function WindowCard({ w }: { w: ArrivalWindow }) {
  const tone =
    w.state === "done"
      ? "border-green bg-green-bg"
      : w.state === "active"
        ? "border-gold bg-gold-bg border-[1.5px]"
        : "border-border bg-bg opacity-55";
  const timeCls = w.state === "done" ? "text-green" : w.state === "active" ? "text-navy" : "text-navy-3";
  const countCls =
    w.state === "done" ? "text-green font-bold" : w.state === "active" ? "text-navy font-bold" : "text-navy-3";
  return (
    <div className={`rounded-lg border p-3.5 ${tone}`}>
      <div className={`font-mono text-[10px] font-semibold ${timeCls}`}>{w.timeLabel}</div>
      <div className="mt-1.5 font-display text-[14px] font-semibold leading-tight text-navy">
        {w.formLabel} <em className="italic text-gold">· {w.scopeLabel}</em>
      </div>
      <div className={`mt-1.5 font-mono text-[10px] ${countCls}`}>{w.countLabel}</div>
    </div>
  );
}

function HouseProgressCard({ house, mode }: { house: HouseCard; mode: BoardingMode }) {
  const pill =
    house.status === "live"
      ? "bg-gold text-navy"
      : house.status === "done"
        ? "bg-green-bg text-green"
        : "border border-border bg-bg text-navy-3";
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      {/* House band colour = user data (inline style); a light band needs the border-2 hairline. */}
      <div
        className="h-1.5"
        style={{
          backgroundColor: house.colour ?? "var(--navy)",
          borderBottom: house.isLight ? "1px solid var(--border-2)" : undefined,
        }}
      />
      <div className="p-5">
        <div className="mb-3.5 flex items-start justify-between border-b border-dashed border-border pb-3">
          <div>
            <h4 className="font-display text-[17px] font-semibold leading-tight text-navy">
              {house.name} <em className="italic text-gold">House</em>
            </h4>
            <div className="mt-0.5 text-[10px] text-navy-3">
              {house.gender ? GENDER_LABEL[house.gender] : "—"} · {house.hmName ?? "HM unassigned"} ·{" "}
              {house.expected} expected
            </div>
          </div>
          <span className={`rounded-pill px-2.5 py-1 text-[9px] font-bold tracking-[0.08em] ${pill}`}>
            {house.status.toUpperCase()}
          </span>
        </div>
        <div className="mb-2.5 flex items-end gap-2.5">
          <span className="font-display text-[32px] font-semibold leading-none text-navy">
            <em className="italic text-gold">{house.arrived}</em>
          </span>
          <span className="pb-1 text-sm font-semibold text-navy-3">/ {house.expected}</span>
        </div>
        <div className="mb-3 h-2 overflow-hidden rounded-pill bg-border">
          <div
            className={`h-full ${house.warn ? "bg-warn" : "bg-green"}`}
            style={{ width: `${house.pct}%` }}
          />
        </div>
        {house.byForm.map((f) => (
          <StatusLine
            key={f.form}
            label={`Form ${f.form}`}
            value={`${f.arrived} / ${f.expected}`}
            green={f.expected > 0 && f.arrived >= f.expected}
          />
        ))}
        <StatusLine
          label={mode === "RESUMPTION" ? "Fee shortfalls" : "Departing · still owing"}
          value={String(house.feeShortfalls)}
          warn={house.feeShortfalls > 0}
        />
      </div>
    </div>
  );
}

function StatusLine({
  label,
  value,
  warn,
  green,
}: {
  label: string;
  value: string;
  warn?: boolean;
  green?: boolean;
}) {
  return (
    <div className="flex justify-between border-t border-dashed border-border py-1.5 text-[11px] first:border-t-0">
      <span className="text-navy-3">{label}</span>
      <span className={`font-bold ${warn ? "text-terra" : green ? "text-green" : "text-navy"}`}>{value}</span>
    </div>
  );
}

function ChecklistRow({ a }: { a: ArrivalRow }) {
  return (
    <div className="grid grid-cols-[minmax(120px,1fr)_2fr_90px_70px_auto] items-center gap-3 border-b border-border px-5 py-2.5 text-[12px] last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy font-display text-[10px] font-bold text-gold">
          {a.initials}
        </span>
        <div className="min-w-0">
          <div className="truncate font-bold text-navy">{a.name}</div>
          <div className="truncate text-[9px] text-navy-3">{a.address}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {a.pips.map((p) => (
          <span
            key={p.pip}
            className={`rounded-pill px-1.5 py-0.5 text-[9px] font-semibold ${PIP_CLS[p.state]}`}
          >
            {p.pip}
          </span>
        ))}
      </div>
      {/* Fee renders the WORD CLEAR (green) when clear, never a dash. */}
      <div className={`font-mono text-[12px] font-bold ${a.fee.owed ? "text-terra" : "text-green"}`}>
        {a.fee.label}
      </div>
      <div className={`font-mono text-[11px] font-bold ${a.bunkAllocated ? "text-navy-2" : "text-terra"}`}>
        {a.bunkAllocated ? a.bunkLabel : "UNALLOC"}
      </div>
      <div className="text-right text-[10px] font-semibold uppercase text-navy-3">{ACTION_LABEL[a.action]}</div>
    </div>
  );
}

function FootStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-gold-soft opacity-60">{label}</div>
      <div className="mt-0.5 font-display text-lg font-semibold leading-none">
        <em className="italic text-gold">{value}</em>
      </div>
      <div className="mt-1 text-[10px] text-gold-soft opacity-60">{sub}</div>
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

const GENDER_LABEL: Record<"BOYS" | "GIRLS" | "COED", string> = {
  BOYS: "Boys",
  GIRLS: "Girls",
  COED: "Mixed",
};
const PIP_CLS: Record<string, string> = {
  ok: "bg-green-bg text-green",
  partial: "bg-warn-bg text-warn",
  missing: "bg-terra-bg text-terra",
};
const ACTION_LABEL: Record<ArrivalRow["action"], string> = {
  view: "View",
  note: "Note",
  process: "Process",
};
