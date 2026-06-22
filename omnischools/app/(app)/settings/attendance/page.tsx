import Link from "next/link";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { attendanceSettings, schoolHolidays, academicPeriod } from "@/db/schema";
import {
  ATTENDANCE_SETTINGS_DEFAULTS,
  type AttendanceSettings,
} from "@/lib/attendance-settings";
import { AttendanceSettingsForm } from "@/components/settings/attendance-settings-form";
import { HolidaysManager } from "@/components/settings/holidays-manager";
import { TermCalendar } from "@/components/settings/term-calendar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Attendance settings" };

const fmtFull = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

function lastEdited(updatedAt: Date | string | null | undefined): string | null {
  if (!updatedAt) return null;
  const ms = Date.now() - (updatedAt instanceof Date ? updatedAt : new Date(updatedAt)).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

function SectionHead({ num, title, meta }: { num: string; title: string; meta?: string }) {
  return (
    <div className="mb-3 mt-8 flex flex-wrap items-baseline gap-3 first:mt-0">
      <span className="font-display text-xl font-semibold italic text-gold">{num}</span>
      <h2 className="font-display text-lg font-semibold text-navy">{title}</h2>
      {meta && <span className="text-[11px] uppercase tracking-wide text-navy-3">{meta}</span>}
    </div>
  );
}

export default async function AttendanceSettingsPage() {
  const { school } = await requireSchool();
  const today = new Date().toISOString().slice(0, 10);

  const data = await withSchool(school.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(attendanceSettings)
      .where(eq(attendanceSettings.schoolId, school.id))
      .limit(1);
    const [term] = await tx
      .select({
        label: academicPeriod.periodLabel,
        startsOn: academicPeriod.startsOn,
        endsOn: academicPeriod.endsOn,
      })
      .from(academicPeriod)
      .where(
        and(
          eq(academicPeriod.schoolId, school.id),
          lte(academicPeriod.startsOn, today),
          gte(academicPeriod.endsOn, today),
        ),
      )
      .limit(1);
    const holidays = await tx
      .select({
        id: schoolHolidays.id,
        name: schoolHolidays.name,
        startsOn: schoolHolidays.startsOn,
        endsOn: schoolHolidays.endsOn,
        kind: schoolHolidays.kind,
      })
      .from(schoolHolidays)
      .where(eq(schoolHolidays.schoolId, school.id))
      .orderBy(asc(schoolHolidays.startsOn));
    return { row, term, holidays };
  });

  const { row, term, holidays } = data;
  const initial: AttendanceSettings = row
    ? {
        dayStart: row.dayStart,
        lateThreshold: row.lateThreshold,
        dayEnd: row.dayEnd,
        editWindowHours: row.editWindowHours,
        absenceSms: row.absenceSms,
        absWatchDays: row.absWatchDays,
        absCriticalDays: row.absCriticalDays,
        pctWatch: row.pctWatch,
        pctCritical: row.pctCritical,
      }
    : ATTENDANCE_SETTINGS_DEFAULTS;
  const edited = lastEdited(row?.updatedAt);

  return (
    <div className="mx-auto max-w-page">
      <div className="text-xs uppercase tracking-wide text-navy-3">
        <Link href="/settings" className="font-semibold text-gold hover:underline">
          Settings
        </Link>{" "}
        / Attendance
      </div>
      <div className="mb-5 mt-2">
        <h1 className="font-display text-3xl font-semibold text-navy">
          Attendance <em className="text-gold">settings</em>
        </h1>
        <p className="text-sm text-navy-3">
          School calendar, daily schedule, and the rules that drive flags &amp; SMS
          {edited ? (
            <>
              {" · "}last edited <b className="font-semibold text-navy-2">{edited}</b>
            </>
          ) : null}
        </p>
      </div>

      {/* Default notice */}
      <div className="mb-6 grid grid-cols-[24px_1fr] gap-3 rounded-xl border border-gold-soft bg-gold-bg p-4">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gold font-display text-xs font-bold text-navy">
          i
        </span>
        <p className="text-xs leading-relaxed text-navy-2">
          <b className="font-semibold text-navy">
            These are the Omnischools recommended defaults.
          </b>{" "}
          We&apos;ve calibrated them for typical Ghanaian basic schools — change them only if
          you have a reason. Defaults are auditable; admins reviewing later can see what&apos;s
          been changed.
        </p>
      </div>

      {/* Region 01 — School calendar */}
      <SectionHead
        num="01"
        title="School calendar"
        meta={term ? `${term.label} · ${fmtFull(term.startsOn)} — ${fmtFull(term.endsOn)}` : undefined}
      />
      {term ? (
        <div className="space-y-4">
          <TermCalendar term={term} holidays={holidays} today={today} />
          <HolidaysManager holidays={holidays} termLabel={term.label} />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="rounded-xl border border-dashed border-border-2 bg-surface p-8 text-center text-sm text-navy-3">
            No active term — set term dates in onboarding or the term &amp; calendar settings to
            see the calendar visual.
          </p>
          <HolidaysManager holidays={holidays} />
        </div>
      )}

      {/* Region 02 — Daily schedule, marking & alert rules */}
      <SectionHead num="02" title="Daily schedule, marking & alert rules" />
      <AttendanceSettingsForm initial={initial} />
    </div>
  );
}
