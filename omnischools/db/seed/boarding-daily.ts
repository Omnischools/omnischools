import "../_loadenv";
import { and, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  schools,
  houses,
  students,
  users,
  auditLog,
  boardingDormitory,
  inspections,
  prepAttendance,
} from "@/db/schema";
import {
  computeAnomalies,
  type DailyFindings,
  type WeeklyFindings,
} from "@/lib/boarding/daily-life";

/**
 * Boarding daily-life (INCR-10) demo seed for Asankrangwa's Aggrey House — a coherent "Today":
 * 7 dorms DAILY PASS + one PARTIAL (Dorm D, with J. Manu's bunk still clean), one WEEKLY whole-house
 * row (anchored to Dorm A), and a couple of prep exception rows. Everything is dated in TODAY's UTC
 * window so the latest-wins reads pick it up.
 *
 * MARKER-SCOPED + RE-RUN-SAFE: it deletes only Aggrey's inspection rows within today's UTC window
 * and Aggrey's prep_attendance rows for today's date, then re-inserts — no broad `where schoolId`
 * delete of shared/baseline data. Run AFTER db:seed + db:seed-boarding. `pnpm db:seed-daily`.
 */

const todayIso = new Date().toISOString().slice(0, 10);
const utc = (h: number, m = 0) => new Date(`${todayIso}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
const dayStart = new Date(`${todayIso}T00:00:00Z`);
const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

const cleanDaily: DailyFindings = {
  kind: "DAILY",
  checks: { bunks: "OK", lockers: "OK", attire: "OK" },
  notes: "All bunks made · lockers in order · attire complete",
};
const partialDaily: DailyFindings = {
  kind: "DAILY",
  checks: { bunks: "ISSUE", lockers: "ISSUE", attire: "OK" },
  flaggedBunks: [6, 9, 13],
  notes: "Bunks 6, 9, 13 made carelessly · locker 9 untidy · spoken to · J. Manu's bunk clean as ever · note logged",
};
const weeklyFindings: WeeklyFindings = {
  kind: "WEEKLY",
  areas: [
    { area: "Washrooms", result: "OK" },
    { area: "Drying lines", result: "OK" },
    { area: "Chop-box store", result: "ISSUE", note: "drainage board loose · carpenter notified" },
    { area: "Bicycle shed", result: "OK" },
  ],
  notes: "Whole House · top to bottom",
};

async function main() {
  const [school] = await db
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.gesCode, "WR-WAW-014"));
  if (!school) {
    console.error("✗ Asankrangwa not seeded — run `pnpm db:seed` first.");
    process.exit(1);
  }
  const schoolId = school.id;

  const [aggrey] = await db
    .select({ id: houses.id })
    .from(houses)
    .where(and(eq(houses.schoolId, schoolId), eq(houses.name, "Aggrey")));
  if (!aggrey) {
    console.error("✗ Aggrey House missing — run `pnpm db:seed-boarding` first.");
    process.exit(1);
  }
  const houseId = aggrey.id;

  const [hm] = await db.select({ id: users.id }).from(users).where(eq(users.phone, "+233244000004"));
  const staffId = hm?.id ?? null;

  const dorms = await db
    .select({ id: boardingDormitory.id, name: boardingDormitory.name })
    .from(boardingDormitory)
    .where(and(eq(boardingDormitory.schoolId, schoolId), eq(boardingDormitory.houseId, houseId)));
  if (dorms.length === 0) {
    console.error("✗ Aggrey has no dormitories — run `pnpm db:seed-boarding` first.");
    process.exit(1);
  }
  const dormIds = dorms.map((d) => d.id);
  const dormByName = new Map(dorms.map((d) => [d.name, d.id]));

  // Re-run-safe: clear only TODAY's Aggrey inspections + prep (date + house scoped — not baseline).
  await db
    .delete(inspections)
    .where(
      and(
        eq(inspections.schoolId, schoolId),
        inArray(inspections.dormitoryId, dormIds),
        gte(inspections.inspectedAt, dayStart),
        lt(inspections.inspectedAt, dayEnd),
      ),
    );
  await db
    .delete(prepAttendance)
    .where(
      and(
        eq(prepAttendance.schoolId, schoolId),
        eq(prepAttendance.houseId, houseId),
        eq(prepAttendance.sessionDate, todayIso),
      ),
    );

  // DAILY inspections — every dorm PASS 15/15 except Dorm D (PARTIAL 12/15).
  const dailyRows = dorms.map((d, i) => {
    const partial = d.name === "D";
    const findings = partial ? partialDaily : cleanDaily;
    return {
      schoolId,
      dormitoryId: d.id,
      type: "DAILY" as const,
      result: (partial ? "PARTIAL" : "PASS") as "PASS" | "PARTIAL" | "FAIL",
      bunksClean: partial ? 12 : 15,
      bunksTotal: 15,
      findingsJson: findings,
      anomaliesCount: computeAnomalies(findings),
      inspectedAt: utc(6, 12 + i), // staggered 06:12–06:19
      inspectedByUserId: staffId ?? undefined,
    };
  });
  await db.insert(inspections).values(dailyRows);

  // WEEKLY whole-house — anchored to Dorm A, dated this morning 08:05 (PARTIAL: chop-box issue).
  await db.insert(inspections).values({
    schoolId,
    dormitoryId: dormByName.get("A") ?? dormIds[0],
    type: "WEEKLY",
    result: "PARTIAL",
    bunksClean: null,
    bunksTotal: null,
    findingsJson: weeklyFindings,
    anomaliesCount: computeAnomalies(weeklyFindings),
    inspectedAt: utc(8, 5),
    inspectedByUserId: staffId ?? undefined,
  });

  // Prep exceptions — up to 2 active Aggrey boarders NOT on the demo exeats (Samuel/Kojo).
  const boarders = await db
    .select({ id: students.id, code: students.studentCode })
    .from(students)
    .where(
      and(
        eq(students.schoolId, schoolId),
        eq(students.houseId, houseId),
        eq(students.residency, "BOARDER"),
        eq(students.status, "ACTIVE"),
        ne(students.studentCode, "ASK-BRD-AGG-01"),
        ne(students.studentCode, "ASK-BRD-AGG-02"),
      ),
    )
    .limit(2);
  const prepRows = boarders.map((b, i) =>
    i === 0
      ? {
          schoolId,
          studentId: b.id,
          houseId,
          sessionDate: todayIso,
          status: "LATE" as const,
          minutesLate: 8,
          note: "Returned from sanitation duty",
          loggedByUserId: staffId ?? undefined,
        }
      : {
          schoolId,
          studentId: b.id,
          houseId,
          sessionDate: todayIso,
          status: "EXCUSED" as const,
          minutesLate: null,
          note: "Choir practice · chaplaincy cleared",
          loggedByUserId: staffId ?? undefined,
        },
  );
  if (prepRows.length) await db.insert(prepAttendance).values(prepRows);

  await db.insert(auditLog).values({
    schoolId,
    actorUserId: staffId ?? undefined,
    actorRole: "HOUSEMASTER",
    actionType: "created",
    entityType: "boarding_daily_seed",
    entityId: schoolId,
    afterState: {
      dailyInspections: dailyRows.length,
      partialDorm: "D",
      weekly: 1,
      prepExceptions: prepRows.length,
      date: todayIso,
    },
    reason: "Boarding daily-life (INCR-10) demo seed — today's inspections + weekly + prep exceptions",
  });

  console.log(
    `✓ Daily-life seed — ${dailyRows.length} daily inspections (Dorm D partial), 1 weekly row, ` +
      `${prepRows.length} prep exception(s), dated ${todayIso}.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ Daily-life seed failed:", err);
    process.exit(1);
  });
