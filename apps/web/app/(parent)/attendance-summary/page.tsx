import { requireParent } from "@/lib/auth/server";
import { loadParentPortal } from "@/lib/parent/parent-portal-data";
import {
  loadParentAttendance,
  type AttendanceBucket,
  type ParentAttendance,
  type ParentAttendanceTerm,
  type ParentAttendanceWeekDay,
} from "@/lib/parent/parent-attendance-data";
import { relationshipLabel, parentLongDate } from "@/lib/wassce/parent-copy";
import { ParentHeader, ParentNav } from "../parent-chrome";

/**
 * INCR · the parent-portal ATTENDANCE tab — a parent's read of their OWN child's attendance (reader is
 * parent-attendance-data, the frozen-key-set column guard). Same PARENT session gate as the other (parent)
 * routes; the child is resolved from the SESSION (never a URL id). Read-only by construction. Every figure
 * is derived from real `attendance_record` rows (R90): no fabricated rate/day/streak; an unmarked term shows
 * an honest "not recorded yet", never 0% or 100%. MEDICAL is folded → Excused in the reader (never shown as
 * a distinct health-inflected marker); reason/note/teacher-name/clock never reach this surface.
 */
export const dynamic = "force-dynamic";

const BUCKET: Record<AttendanceBucket, { label: string; tile: string; pill: string; seg: string }> = {
  PRESENT: { label: "Present", tile: "bg-green text-white", pill: "bg-green-bg text-green", seg: "bg-green" },
  LATE: { label: "Late", tile: "bg-gold text-navy", pill: "bg-gold-bg text-navy", seg: "bg-gold" },
  EXCUSED: { label: "Excused", tile: "bg-warn text-white", pill: "bg-warn-bg text-warn", seg: "bg-warn" },
  ABSENT: { label: "Absent", tile: "bg-terra text-white", pill: "bg-terra-bg text-terra", seg: "bg-terra" },
};
const DAY_LETTER = ["Su", "M", "T", "W", "T", "F", "Sa"]; // getUTCDay index; Mon–Fri only are rendered
const longDay = (iso: string): string => parentLongDate(new Date(`${iso}T00:00:00Z`));

export default async function ParentAttendancePage() {
  const { user, school } = await requireParent();
  const data = await loadParentPortal(school.id, user.id);
  const child = data.children[0] ?? null;
  const attendance = child ? await loadParentAttendance(school.id, user.id, child.studentId) : null;

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
      <ParentNav active="Attendance" />

      <div className="px-7 pb-9 pt-6">
        {!child ? (
          <NoChild />
        ) : (
          <div className="space-y-6">
            <TodayHero firstName={child.firstName} attendance={attendance!} />
            <WeekStrip week={attendance!.week} />
            <TermSummary firstName={child.firstName} attendance={attendance!} />
            <RecentAbsences absences={attendance!.recentAbsences} />
          </div>
        )}
      </div>
    </div>
  );
}

/** No portal-linked child — a linking issue, not an attendance fact (mirrors the Sickbay/WASSCE tabs). */
function NoChild() {
  return (
    <div className="rounded-xl border border-border bg-surface px-6 py-8 text-center text-[13px] leading-relaxed text-navy-2">
      No student is linked to this portal yet. Please contact the school office.
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── Today (hero) ── */

function TodayHero({ firstName, attendance }: { firstName: string; attendance: ParentAttendance }) {
  const today = attendance.today;
  if (!today) return null; // no mark today / weekend / holiday → omit the hero (the week + term carry it)

  const absent = today.bucket === "ABSENT";
  const headline =
    today.bucket === "PRESENT" ? (
      <>
        {firstName} was <em className="text-gold">at school</em> today.
      </>
    ) : today.bucket === "LATE" ? (
      <>
        {firstName} was <em className="text-gold">at school</em> today, marked a little late.
      </>
    ) : today.bucket === "EXCUSED" ? (
      <>
        {firstName} was <em className="text-gold">away with the school&apos;s knowledge</em> today.
      </>
    ) : (
      <>
        {firstName} was <em className="text-terra">not at school</em> today.
      </>
    );

  return (
    <section
      className={"rounded-xl border px-[26px] py-[22px] " + (absent ? "border-terra-soft" : "border-gold-soft")}
      style={{
        background: absent
          ? "linear-gradient(135deg,#F7E8E5 0%,#FAF7F2 100%)"
          : "linear-gradient(135deg,#E5EFE8 0%,#FAF7F2 100%)",
      }}
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-navy-3">Today</div>
      <h2 className="font-display text-[22px] font-medium leading-snug text-navy">{headline}</h2>
      <p className="mt-2 text-xs leading-relaxed text-navy-3">
        {absent
          ? `If ${firstName} should have been in school, please contact the school office.`
          : "Marked by the school today."}
      </p>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────── This week ── */

function WeekStrip({ week }: { week: ParentAttendanceWeekDay[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border bg-bg px-6 py-[18px]">
        <h3 className="font-display text-base font-medium text-navy">This week</h3>
        <div className="text-[11px] text-navy-3">Monday to Friday</div>
      </div>
      <div className="grid grid-cols-5 gap-2.5 px-6 py-5">
        {week.map((d) => {
          const num = Number(d.date.slice(8, 10));
          const meta = d.bucket ? BUCKET[d.bucket] : null;
          return (
            <div
              key={d.date}
              className={
                "flex flex-col items-center gap-1 rounded-lg border py-3 text-center " +
                (d.isToday ? "border-gold ring-1 ring-gold " : "border-border ") +
                (meta ? "" : d.isSchoolDay ? "bg-bg" : "bg-bg opacity-60")
              }
            >
              <div className="font-display text-[11px] font-semibold text-navy-3">
                {DAY_LETTER[new Date(`${d.date}T00:00:00Z`).getUTCDay()]}
              </div>
              <div className="font-display text-lg font-medium text-navy">{num}</div>
              {meta ? (
                <span className={"rounded-pill px-2 py-[2px] text-[10px] font-semibold " + meta.pill}>
                  {meta.label}
                </span>
              ) : (
                <span className="text-[10px] text-navy-3">{d.isToday ? "Today" : d.isSchoolDay ? "—" : "No school"}</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────── This term ── */

const ORDER: AttendanceBucket[] = ["PRESENT", "LATE", "EXCUSED", "ABSENT"];

function TermSummary({ firstName, attendance }: { firstName: string; attendance: ParentAttendance }) {
  const term = attendance.term;
  if (!term) {
    return (
      <section className="rounded-xl border border-border bg-surface px-6 py-8 text-center text-[13px] leading-relaxed text-navy-2">
        Your school hasn&apos;t set up this term&apos;s calendar yet. {firstName}&apos;s attendance summary
        will show here once it does.
      </section>
    );
  }
  if (term.markedDays === 0) {
    return (
      <section className="rounded-xl border border-border bg-surface px-6 py-8 text-center">
        <div className="font-display text-base font-medium text-navy">
          No attendance recorded for {firstName} this term yet.
        </div>
        <div className="mt-1.5 text-[13px] leading-relaxed text-navy-2">
          Once the school starts marking the register for {term.label.split(" · ")[0]}, {firstName}&apos;s
          summary will appear here.
        </div>
      </section>
    );
  }

  const pct = term.atSchoolPct;
  const band = pct == null ? "text-navy" : pct >= 90 ? "text-green" : pct >= 75 ? "text-warn" : "text-terra";
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border bg-bg px-6 py-[18px]">
        <h3 className="font-display text-base font-medium text-navy">This term</h3>
        <div className="text-[11px] text-navy-3">{term.label}</div>
      </div>
      <div className="px-6 py-5">
        <div className="flex items-baseline gap-3">
          <div className={"font-display text-[36px] font-semibold leading-none " + band}>{pct}%</div>
          <div className="font-mono text-[13px] text-navy-2">
            at school <span className="font-semibold">{term.atSchoolDays}</span> of {term.markedDays} days
          </div>
        </div>

        {/* breakdown bar — only buckets with a count, proportional to marked days */}
        <div className="mt-4 flex h-2.5 overflow-hidden rounded-pill">
          {ORDER.filter((b) => term.counts[bucketKey(b)] > 0).map((b) => (
            <div
              key={b}
              className={"h-full " + BUCKET[b].seg}
              style={{ width: `${(term.counts[bucketKey(b)] / term.markedDays) * 100}%` }}
            />
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
          {ORDER.filter((b) => term.counts[bucketKey(b)] > 0).map((b) => (
            <span key={b} className="inline-flex items-center gap-1.5 text-[11px] text-navy-3">
              <span className={"h-2 w-2 rounded-full " + BUCKET[b].seg} />
              {BUCKET[b].label} <span className="font-mono text-navy-2">{term.counts[bucketKey(b)]}</span>
            </span>
          ))}
        </div>

        {attendance.priorTerm && (
          <div className="mt-4 border-t border-border pt-3 font-mono text-xs text-navy-3">
            Last term{" "}
            <span className="text-navy-2">
              {attendance.priorTerm.atSchoolPct == null ? "—" : `${attendance.priorTerm.atSchoolPct}%`}
            </span>{" "}
            · {attendance.priorTerm.atSchoolDays} of {attendance.priorTerm.markedDays} days
          </div>
        )}
      </div>
    </section>
  );
}

const bucketKey = (b: AttendanceBucket): "present" | "late" | "excused" | "absent" =>
  b === "PRESENT" ? "present" : b === "LATE" ? "late" : b === "EXCUSED" ? "excused" : "absent";

/* ─────────────────────────────────────────────────────────── Recent absences ── */

function RecentAbsences({ absences }: { absences: ParentAttendance["recentAbsences"] }) {
  if (absences.length === 0) return null; // no absences → omit the section (nothing to note is good news)
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border bg-bg px-6 py-[18px]">
        <h3 className="font-display text-base font-medium text-navy">Days away this term</h3>
        <div className="text-[11px] text-navy-3">Absent and excused days, most recent first</div>
      </div>
      {absences.map((a) => (
        <div
          key={a.date}
          className="flex items-center justify-between gap-4 border-b border-border px-6 py-3.5 last:border-b-0"
        >
          <span className="font-mono text-[13px] text-navy-2">{longDay(a.date)}</span>
          <span className={"rounded-pill px-2.5 py-[3px] text-[11px] font-semibold " + BUCKET[a.bucket].pill}>
            {BUCKET[a.bucket].label}
          </span>
        </div>
      ))}
    </section>
  );
}
