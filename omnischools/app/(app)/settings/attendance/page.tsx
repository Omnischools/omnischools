import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { attendanceSettings, schoolHolidays } from "@/db/schema";
import {
  ATTENDANCE_SETTINGS_DEFAULTS,
  type AttendanceSettings,
} from "@/lib/attendance-settings";
import { AttendanceSettingsForm } from "@/components/settings/attendance-settings-form";
import { HolidaysManager } from "@/components/settings/holidays-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Attendance settings" };

export default async function AttendanceSettingsPage() {
  const { school } = await requireSchool();
  const [row] = await withSchool(school.id, (tx) =>
    tx
      .select()
      .from(attendanceSettings)
      .where(eq(attendanceSettings.schoolId, school.id))
      .limit(1),
  );
  const holidays = await withSchool(school.id, (tx) =>
    tx
      .select({
        id: schoolHolidays.id,
        name: schoolHolidays.name,
        startsOn: schoolHolidays.startsOn,
        endsOn: schoolHolidays.endsOn,
        kind: schoolHolidays.kind,
      })
      .from(schoolHolidays)
      .where(eq(schoolHolidays.schoolId, school.id))
      .orderBy(asc(schoolHolidays.startsOn)),
  );

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

  return (
    <div className="mx-auto max-w-page">
      <Link href="/settings" className="text-sm text-navy-3 hover:text-gold">
        ← Settings
      </Link>
      <div className="mb-6 mt-2">
        <h1 className="font-display text-3xl font-semibold text-navy">
          Attendance <em className="not-italic text-gold [font-style:italic]">rules.</em>
        </h1>
        <p className="text-sm text-navy-3">
          The daily schedule, the absence SMS, and when students get flagged. These drive
          the attendance module.
        </p>
      </div>
      <div className="space-y-6">
        <AttendanceSettingsForm initial={initial} />
        <HolidaysManager holidays={holidays} />
      </div>
    </div>
  );
}
