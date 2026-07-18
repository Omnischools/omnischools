import "../_loadenv";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  schools,
  students,
  users,
  auditLog,
  academicPeriod,
  boardingArrival,
} from "@/db/schema";
import type { ResumptionChecklist } from "@/lib/boarding/resumption";

/**
 * Boarding resumption (INCR-11) demo seed for Asankrangwa — a coherent "resumption-in-progress": a
 * handful of F0 boarders checked in across the morning windows, ONE with a partial/missing prospectus
 * item, ONE fee-owing arrival (flag, never a block), J. Manu clean (his cross-batch cameo), and ONE
 * boarder deliberately left unrecorded so the derived "unaccounted past window" surfaces once his
 * window closes. Everything is RESUMPTION mode against the current SENIOR semester, dated TODAY (UTC)
 * so the live board (default date=today) picks it up.
 *
 * MARKER-SCOPED + RE-RUN-SAFE: deletes only THIS school's RESUMPTION boarding_arrival rows for the
 * resolved SENIOR period (a table nothing else populates), then re-inserts. Run AFTER db:seed +
 * db:seed-boarding. `pnpm db:seed-resumption`.
 */

const todayIso = new Date().toISOString().slice(0, 10);
const utc = (h: number, m = 0) =>
  new Date(`${todayIso}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);

const clean = (): ResumptionChecklist => ({
  chop_box: "ok",
  mattress: "ok",
  mackintosh: "ok",
  mosquito_net: "ok",
  bucket: "ok",
  bible_or_quran: "ok",
});

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

  // Resolve the current SENIOR semester (mirrors lib/boarding/period.getCurrentPeriod).
  const periods = await db
    .select({
      periodId: academicPeriod.periodId,
      startsOn: academicPeriod.startsOn,
      endsOn: academicPeriod.endsOn,
    })
    .from(academicPeriod)
    .where(and(eq(academicPeriod.schoolId, schoolId), eq(academicPeriod.productLine, "SENIOR")))
    .orderBy(desc(academicPeriod.startsOn));
  if (periods.length === 0) {
    console.error("✗ No SENIOR academic period — run `pnpm db:seed` (SHS onboarding) first.");
    process.exit(1);
  }
  const cur =
    periods.find((p) => p.startsOn <= todayIso && p.endsOn >= todayIso) ??
    periods.find((p) => p.startsOn <= todayIso) ??
    periods[periods.length - 1];
  const periodId = cur.periodId;

  const [hm] = await db.select({ id: users.id }).from(users).where(eq(users.phone, "+233244000004"));
  const staffId = hm?.id ?? null;

  // The demo boarders (F0 spine — coherent with the roster). One left OUT of the arrivals set below
  // is the "unaccounted" (Kwame ASK-24-0147).
  const codes = [
    "ASK-24-0118", // J. Manu · Aggrey · clean (his cameo)
    "ASK-BRD-AGG-01", // Samuel · Aggrey · one item missing
    "ASK-BRD-AGG-02", // Kojo · Aggrey · fee-owing
    "ASK-24-0149", // Kofi · Guggisberg · clean
    "ASK-24-0146", // Efua · Kingsley · partial
    "ASK-24-0142", // Abena · Slessor · clean
  ];
  const rows = await db
    .select({ id: students.id, houseId: students.houseId, code: students.studentCode })
    .from(students)
    .where(and(eq(students.schoolId, schoolId), inArray(students.studentCode, codes)));
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const stu = (code: string) => byCode.get(code);

  // Re-run-safe: clear THIS school's RESUMPTION arrivals for this period (nothing else writes them).
  await db
    .delete(boardingArrival)
    .where(
      and(
        eq(boardingArrival.schoolId, schoolId),
        eq(boardingArrival.academicPeriodId, periodId),
        eq(boardingArrival.mode, "RESUMPTION"),
      ),
    );

  type Row = typeof boardingArrival.$inferInsert;
  const arrivals: Row[] = [];
  const add = (code: string, checklist: ResumptionChecklist, at: Date, feeSnapshot?: string, note?: string) => {
    const s = stu(code);
    if (!s || !s.houseId) return;
    arrivals.push({
      schoolId,
      studentId: s.id,
      houseId: s.houseId,
      academicPeriodId: periodId,
      mode: "RESUMPTION",
      checklistJson: checklist,
      feeOwingSnapshot: feeSnapshot,
      note: note ?? null,
      checkedAt: at,
      checkedByUserId: staffId ?? undefined,
    });
  };

  // J. Manu — clean, fees clear, arrived 08:14 (cameo).
  add("ASK-24-0118", clean(), utc(8, 14));
  // Kofi + Abena — clean.
  add("ASK-24-0149", clean(), utc(7, 40));
  add("ASK-24-0142", clean(), utc(9, 20));
  // Samuel — one item missing (mackintosh) → prospectus shortfall issue.
  add(
    "ASK-BRD-AGG-01",
    { ...clean(), mackintosh: "missing" },
    utc(8, 50),
    undefined,
    "Mackintosh short · parent bringing this evening · permitted in",
  );
  // Efua — mattress partial + net missing.
  add("ASK-24-0146", { ...clean(), mattress: "partial", mosquito_net: "missing" }, utc(10, 5));
  // Kojo — fee-owing (flag, never blocks) → fee-shortfall issue.
  add(
    "ASK-BRD-AGG-02",
    clean(),
    utc(9, 55),
    "340.00",
    "Fee shortfall · mother paying by mobile money before 6 PM · conditional admission",
  );
  // ASK-24-0147 (Kwame) is intentionally NOT recorded → derived unaccounted once his window closes.

  if (arrivals.length) await db.insert(boardingArrival).values(arrivals);

  await db.insert(auditLog).values({
    schoolId,
    actorUserId: staffId ?? undefined,
    actorRole: "HOUSEMASTER",
    actionType: "created",
    entityType: "boarding_resumption_seed",
    entityId: schoolId,
    afterState: {
      mode: "RESUMPTION",
      periodId,
      arrivals: arrivals.length,
      partialOrMissing: 2,
      feeOwing: 1,
      unaccountedLeftOut: "ASK-24-0147",
      date: todayIso,
    },
    reason: "Boarding resumption (INCR-11) demo seed — arrivals across windows, a shortfall, a fee-owing, an unaccounted",
  });

  console.log(
    `✓ Resumption seed — ${arrivals.length} arrivals (J. Manu clean, Samuel MAC missing, Efua partial, Kojo fee-owing), ` +
      `1 boarder left unrecorded (Kwame → derived unaccounted), dated ${todayIso}.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ Resumption seed failed:", err);
    process.exit(1);
  });
