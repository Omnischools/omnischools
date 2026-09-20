import "../_loadenv";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  schools,
  houses,
  students,
  users,
  auditLog,
  academicPeriod,
  boardingCalendarEvent,
  boardingExeat,
  studentGuardians,
} from "@/db/schema";

/**
 * Boarding exeat (INCR-9) demo seed for Asankrangwa — a coherent set of exeats over the F0 boarders:
 * a special in flight, a scheduled-window queue (incl. a fee-collection row + an owed special + a
 * plain REQUESTED clean row for bulk-approve), two returns-today, and one overdue exeat to exercise
 * the late-return SMS chain. Also seeds a primary guardian phone (insert-if-absent) for each exeat
 * boarder so the console SMS chain has a recipient.
 *
 * MARKER-SCOPED + RE-RUN-SAFE: it only ever touches boarding_exeat rows whose ref_code is in the
 * fixed DEMO_REFS set (deleting them cascades their exeat_notification rows) and never broad-deletes
 * shared data. Run AFTER db:seed + db:seed-boarding. `pnpm db:seed-exeat`.
 */

const ACADEMIC_YEAR = "2025/26";
const DEMO_REFS = [
  "ASA-EX-2026-0341",
  "ASA-EX-2026-0342",
  "ASA-EX-2026-0343",
  "ASA-EX-2026-0344",
  "ASA-EX-2026-0345",
  "ASA-EX-2026-0346",
  "ASA-EX-2026-0347",
  "ASA-EX-2026-0350",
];

const now = new Date();
const at = (dayOffset: number, h: number, m = 0): Date => {
  const d = new Date(now);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d;
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

  const [hm] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phone, "+233244000004")); // Mr A. Mensah (HM)
  const staffId = hm?.id ?? null;

  // Current SHS semester (quota scope) — the latest-started period.
  const periods = await db
    .select({ periodId: academicPeriod.periodId, startsOn: academicPeriod.startsOn })
    .from(academicPeriod)
    .where(eq(academicPeriod.schoolId, schoolId));
  if (periods.length === 0) {
    console.error("✗ No academic periods for Asankrangwa — run `pnpm db:seed` first.");
    process.exit(1);
  }
  const periodId = periods.sort((a, b) => (a.startsOn < b.startsOn ? 1 : -1))[0].periodId;

  // The next scheduled EXEAT_WINDOW (link scheduled exeats to it, informational).
  const [window] = await db
    .select({ id: boardingCalendarEvent.id })
    .from(boardingCalendarEvent)
    .where(
      and(
        eq(boardingCalendarEvent.schoolId, schoolId),
        eq(boardingCalendarEvent.academicYear, ACADEMIC_YEAR),
        eq(boardingCalendarEvent.eventType, "EXEAT_WINDOW"),
      ),
    )
    .limit(1);
  const windowId = window?.id ?? null;

  // Resolve the demo boarders by student_code → id + house_id.
  const codes = [
    "ASK-BRD-AGG-01", // Samuel Adjei · Aggrey — special in flight
    "ASK-24-0118", // Joseph Manu · Aggrey — scheduled auto-approved
    "ASK-24-0147", // Kwame Boakye · Aggrey — scheduled REQUESTED (bulk-approve)
    "ASK-24-0149", // Kofi Adjei · Guggisberg — fee collection
    "ASK-24-0146", // Efua Sarpong · Kingsley — owed special (awaiting Sr HM)
    "ASK-24-0142", // Abena Mensah · Slessor — returned today
    "ASK-24-0144", // Ama Asante · Aryee — returned today
    "ASK-BRD-AGG-02", // Kojo Owusu · Aggrey — overdue
  ];
  const stuRows = await db
    .select({ id: students.id, code: students.studentCode, houseId: students.houseId })
    .from(students)
    .where(and(eq(students.schoolId, schoolId), inArray(students.studentCode, codes)));
  const stu = new Map(stuRows.map((r) => [r.code, r]));
  const need = (code: string) => {
    const r = stu.get(code);
    if (!r || !r.houseId) throw new Error(`Demo boarder ${code} missing/houseless — run db:seed-boarding first.`);
    return r;
  };

  // 1) Primary guardian phone per demo boarder (insert-if-absent) so the SMS chain has a recipient.
  let guardiansAdded = 0;
  for (let i = 0; i < codes.length; i += 1) {
    const r = stu.get(codes[i]);
    if (!r) continue;
    const existing = await db
      .select({ id: studentGuardians.id })
      .from(studentGuardians)
      .where(
        and(
          eq(studentGuardians.schoolId, schoolId),
          eq(studentGuardians.studentId, r.id),
          eq(studentGuardians.isPrimary, true),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      await db.insert(studentGuardians).values({
        schoolId,
        studentId: r.id,
        name: "Demo Parent",
        relationship: "GUARDIAN",
        phone: `+23324450${String(i).padStart(4, "0")}`,
        isPrimary: true,
      });
      guardiansAdded += 1;
    }
  }

  // 2) Re-run-safe wipe of ONLY the demo exeats (notifications cascade on delete).
  await db
    .delete(boardingExeat)
    .where(and(eq(boardingExeat.schoolId, schoolId), inArray(boardingExeat.refCode, DEMO_REFS)));

  const base = (code: string) => ({
    schoolId,
    studentId: need(code).id,
    houseId: need(code).houseId!,
    academicPeriodId: periodId,
    requestedByUserId: staffId ?? undefined,
  });

  const rows: (typeof boardingExeat.$inferInsert)[] = [
    // 1 — Special in flight (all 5 stages; return in the future) → in-flight timeline + card.
    {
      ...base("ASK-BRD-AGG-01"),
      calendarEventId: null,
      exeatType: "SPECIAL",
      status: "DEPARTED",
      refCode: "ASA-EX-2026-0341",
      reason: "Grandmother hospitalised · parent-initiated",
      parentInitiated: true,
      departAt: at(-2, 11, 30),
      returnBy: at(2, 16, 0),
      requestedAt: at(-3, 7, 58),
      hmApprovedAt: at(-3, 9, 42),
      hmApprovedByUserId: staffId ?? undefined,
      srHmSignedAt: at(-3, 10, 14),
      srHmSignedByUserId: staffId ?? undefined,
      departedAt: at(-2, 11, 30),
      departedByUserId: staffId ?? undefined,
      feeOwingSnapshot: null,
    },
    // 2 — Scheduled, auto-approved (fees clear) → AUTO-APPROVED in the queue.
    {
      ...base("ASK-24-0118"),
      calendarEventId: windowId,
      exeatType: "SCHEDULED",
      status: "HM_APPROVED",
      refCode: "ASA-EX-2026-0342",
      reason: "Visit mother · post-bereavement · home Kumasi",
      parentInitiated: true,
      departAt: at(7, 13, 0),
      returnBy: at(8, 16, 0),
      requestedAt: at(-1, 9, 0),
      hmApprovedAt: at(-1, 9, 1),
      hmApprovedByUserId: staffId ?? undefined,
      feeOwingSnapshot: null,
    },
    // 3 — Scheduled, still REQUESTED + clean → picked up by "Approve all clean".
    {
      ...base("ASK-24-0147"),
      calendarEventId: windowId,
      exeatType: "SCHEDULED",
      status: "REQUESTED",
      refCode: "ASA-EX-2026-0343",
      reason: "Routine · home Sunyani · with parents",
      parentInitiated: true,
      departAt: at(7, 13, 0),
      returnBy: at(8, 16, 0),
      requestedAt: at(0, 8, 30),
      feeOwingSnapshot: null,
    },
    // 4 — Fee-collection (routed, snapshot frozen) → FEE · owed in the queue.
    {
      ...base("ASK-24-0149"),
      calendarEventId: windowId,
      exeatType: "FEE_COLLECTION",
      status: "HM_APPROVED",
      refCode: "ASA-EX-2026-0344",
      reason: "Fee collection · GHS 340.00 outstanding",
      parentInitiated: true,
      departAt: at(7, 13, 0),
      returnBy: at(8, 16, 0),
      requestedAt: at(-1, 10, 0),
      hmApprovedAt: at(-1, 10, 2),
      hmApprovedByUserId: staffId ?? undefined,
      feeOwingSnapshot: "340.00",
    },
    // 5 — Owed special (soft-warn, stays SPECIAL) awaiting Senior HM signature.
    {
      ...base("ASK-24-0146"),
      calendarEventId: null,
      exeatType: "SPECIAL",
      status: "HM_APPROVED",
      refCode: "ASA-EX-2026-0345",
      reason: "Dental appointment · Kumasi · doctor's note attached",
      parentInitiated: true,
      departAt: at(6, 9, 0),
      returnBy: at(6, 18, 0),
      requestedAt: at(-1, 8, 0),
      hmApprovedAt: at(-1, 8, 30),
      hmApprovedByUserId: staffId ?? undefined,
      feeOwingSnapshot: "215.00",
    },
    // 6 & 7 — Returns today (on time).
    {
      ...base("ASK-24-0142"),
      calendarEventId: null,
      exeatType: "SPECIAL",
      status: "RETURNED",
      refCode: "ASA-EX-2026-0346",
      reason: "Church anniversary",
      parentInitiated: true,
      departAt: at(-2, 13, 0),
      returnBy: at(0, 16, 0),
      requestedAt: at(-3, 9, 0),
      hmApprovedAt: at(-3, 9, 30),
      hmApprovedByUserId: staffId ?? undefined,
      srHmSignedAt: at(-3, 10, 0),
      srHmSignedByUserId: staffId ?? undefined,
      departedAt: at(-2, 13, 0),
      departedByUserId: staffId ?? undefined,
      returnedAt: at(0, 8, 15),
      returnedByUserId: staffId ?? undefined,
      feeOwingSnapshot: null,
    },
    {
      ...base("ASK-24-0144"),
      calendarEventId: null,
      exeatType: "SPECIAL",
      status: "RETURNED",
      refCode: "ASA-EX-2026-0347",
      reason: "Medical follow-up",
      parentInitiated: true,
      departAt: at(-2, 13, 0),
      returnBy: at(0, 16, 0),
      requestedAt: at(-3, 9, 0),
      hmApprovedAt: at(-3, 9, 30),
      hmApprovedByUserId: staffId ?? undefined,
      srHmSignedAt: at(-3, 10, 0),
      srHmSignedByUserId: staffId ?? undefined,
      departedAt: at(-2, 13, 0),
      departedByUserId: staffId ?? undefined,
      returnedAt: at(0, 9, 42),
      returnedByUserId: staffId ?? undefined,
      feeOwingSnapshot: null,
    },
    // 8 — Overdue (departed, return_by well in the past) → late band + all 3 chain stages due.
    {
      ...base("ASK-BRD-AGG-02"),
      calendarEventId: null,
      exeatType: "SCHEDULED",
      status: "DEPARTED",
      refCode: "ASA-EX-2026-0350",
      reason: "Routine · home Tarkwa · STC bus",
      parentInitiated: true,
      departAt: at(-1, 13, 0),
      returnBy: at(0, now.getHours() - 2, 0),
      requestedAt: at(-2, 9, 0),
      hmApprovedAt: at(-2, 9, 1),
      hmApprovedByUserId: staffId ?? undefined,
      departedAt: at(-1, 13, 0),
      departedByUserId: staffId ?? undefined,
      feeOwingSnapshot: null,
    },
  ];

  await db.insert(boardingExeat).values(rows);

  await db.insert(auditLog).values({
    schoolId,
    actorUserId: staffId ?? undefined,
    actorRole: "HOUSEMASTER",
    actionType: "created",
    entityType: "boarding_exeat_seed",
    entityId: schoolId,
    afterState: { exeats: rows.length, guardiansAdded },
    reason: "Boarding exeat (INCR-9) demo seed",
  });

  console.log(
    `✓ Exeat seed — ${rows.length} exeats (1 special in flight, 1 auto-approved, 1 requested-clean, ` +
      `1 fee-collection, 1 owed special, 2 returns-today, 1 overdue), ${guardiansAdded} guardian phone(s) added.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ Exeat seed failed:", err);
    process.exit(1);
  });
