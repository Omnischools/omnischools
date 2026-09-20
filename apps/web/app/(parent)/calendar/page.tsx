import { requireParent } from "@/lib/auth/server";
import { loadParentPortal } from "@/lib/parent/parent-portal-data";
import {
  loadParentCalendar,
  type ParentCalendarHoliday,
  type ParentCalendarTerm,
} from "@/lib/parent/parent-calendar-data";
import { relationshipLabel, parentLongDate } from "@/lib/wassce/parent-copy";
import { ParentHeader, ParentNav } from "../parent-chrome";

/**
 * INCR-278 · the parent-portal SCHOOL CALENDAR tab — the school's term/semester dates + holidays, read
 * from `academic_period` + `school_holiday` (school-wide, no per-child data; reader is parent-calendar-data).
 * Same PARENT session gate as the other (parent) routes. UNLIKE the WASSCE/Sickbay/PTA tabs this one does
 * NOT gate on a linked child — the calendar is school-wide; a no-child (or pre-paste) session simply
 * fail-closes to the honest empty via RLS. Read-only by construction. Every date is derived, never invented
 * (R90): no "current" term unless today is inside one, no "next" term unless one is actually upcoming.
 */
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  PUBLIC: "Public holiday",
  BREAK: "Break",
  EVENT: "Event",
  EXAM: "Exam",
};
const KIND_CHIP: Record<string, string> = {
  PUBLIC: "bg-terra-bg text-terra",
  BREAK: "bg-gold-bg text-navy",
  EVENT: "bg-navy text-bg",
  EXAM: "bg-warn-bg text-warn",
};

/** A 'YYYY-MM-DD' column → "28 March 2026" (UTC, no time — the parent-copy idiom). */
const longDay = (iso: string): string => parentLongDate(new Date(`${iso}T00:00:00Z`));
const dateRange = (startsOn: string, endsOn: string): string =>
  startsOn === endsOn ? longDay(startsOn) : `${longDay(startsOn)} – ${longDay(endsOn)}`;

export default async function ParentCalendarPage() {
  const { user, school } = await requireParent();
  const [data, calendar] = await Promise.all([
    loadParentPortal(school.id, user.id),
    loadParentCalendar(school.id, user.id),
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
      <ParentNav active="School calendar" />

      <div className="px-7 pb-9 pt-6">
        {calendar.terms.length === 0 ? (
          <Empty />
        ) : (
          <div className="space-y-6">
            {calendar.current && <CurrentTerm current={calendar.current} />}
            <Terms
              terms={calendar.terms}
              nextTerm={calendar.nextTerm}
              academicYear={calendar.academicYear}
            />
            <Holidays holidays={calendar.holidays} academicYear={calendar.academicYear} />
          </div>
        )}
      </div>
    </div>
  );
}

/** No term configured (or pre-paste fail-closed) — one honest empty, never an invented date (AC-CAL-16). */
function Empty() {
  return (
    <div className="rounded-xl border border-border bg-surface px-6 py-8 text-center text-[13px] leading-relaxed text-navy-2">
      Your school hasn&apos;t published its calendar yet. Term dates and holidays will show here once the
      school sets them up.
    </div>
  );
}

/* ─────────────────────────────────────────────────────── This term (progress) ── */

function CurrentTerm({ current }: { current: { label: string; dayOf: number; total: number } }) {
  const pct = current.total > 0 ? Math.min(100, Math.round((current.dayOf / current.total) * 100)) : 0;
  return (
    <section
      className="rounded-xl border border-gold-soft px-6 py-[22px]"
      style={{ background: "linear-gradient(135deg,#F5EBDC 0%,#FAF7F2 100%)" }}
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-navy-3">
        This term
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-display text-[20px] font-medium leading-tight text-navy">{current.label}</div>
        <div className="font-mono text-[13px] font-semibold text-navy-2">
          Day {current.dayOf} of {current.total}
        </div>
      </div>
      <div className="mt-3.5 h-2 overflow-hidden rounded-pill bg-surface">
        <div className="h-full rounded-pill bg-gold" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 text-[11px] text-navy-3">School days so far, weekends and holidays excluded.</div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────── Term dates ── */

function Terms({
  terms,
  nextTerm,
  academicYear,
}: {
  terms: ParentCalendarTerm[];
  nextTerm: ParentCalendarTerm | null;
  academicYear: string | null;
}) {
  const nextKey = nextTerm ? nextTerm.startsOn + nextTerm.label : null;
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border bg-bg px-6 py-[18px]">
        <h3 className="font-display text-base font-medium text-navy">Term dates</h3>
        <div className="text-[11px] text-navy-3">
          {academicYear ? `Academic year ${academicYear}` : "All published terms"}
        </div>
      </div>
      {terms.map((t) => {
        const isNext = nextKey != null && t.startsOn + t.label === nextKey;
        return (
          <div
            key={t.startsOn + t.label}
            className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-border px-6 py-4 last:border-b-0"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-[15px] font-medium text-navy">{t.label}</span>
                {t.isCurrent && (
                  <span className="inline-flex items-center rounded-pill bg-gold px-2.5 py-[3px] text-[11px] font-semibold text-navy">
                    Now
                  </span>
                )}
                {isNext && !t.isCurrent && (
                  <span className="inline-flex items-center rounded-pill bg-navy px-2.5 py-[3px] text-[11px] font-semibold text-bg">
                    Up next
                  </span>
                )}
              </div>
              <div className="text-xs text-navy-3">{t.academicYear}</div>
            </div>
            <div className="text-right font-mono text-[13px] text-navy-2">
              {dateRange(t.startsOn, t.endsOn)}
            </div>
          </div>
        );
      })}
    </section>
  );
}

/* ─────────────────────────────────────────────────────────── Holidays & breaks ── */

function Holidays({
  holidays,
  academicYear,
}: {
  holidays: ParentCalendarHoliday[];
  academicYear: string | null;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border bg-bg px-6 py-[18px]">
        <h3 className="font-display text-base font-medium text-navy">Holidays &amp; breaks</h3>
        <div className="text-[11px] text-navy-3">
          {academicYear ? `Non-teaching days in ${academicYear}` : "Non-teaching days"}
        </div>
      </div>
      {holidays.length === 0 ? (
        <div className="px-6 py-6 text-[13px] leading-relaxed text-navy-2">
          No holidays or breaks have been published for this year yet.
        </div>
      ) : (
        holidays.map((h, i) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-border px-6 py-4 last:border-b-0"
          >
            <div>
              <div className="font-display text-[15px] font-medium text-navy">{h.name}</div>
              <div className="font-mono text-xs text-navy-3">{dateRange(h.startsOn, h.endsOn)}</div>
            </div>
            <span
              className={
                "inline-flex items-center rounded-pill px-2.5 py-[3px] text-[11px] font-semibold " +
                (KIND_CHIP[h.kind] ?? "bg-bg text-navy-3")
              }
            >
              {KIND_LABEL[h.kind] ?? h.kind}
            </span>
          </div>
        ))
      )}
    </section>
  );
}
