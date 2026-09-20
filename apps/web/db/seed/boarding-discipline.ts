import "../_loadenv";
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  schools,
  students,
  users,
  classes,
  houses,
  auditLog,
  roleAssignments,
  roles,
  boardingInfractions,
  bondArtefacts,
  deboardinizationRecords,
} from "@/db/schema";

/**
 * Boarding discipline & deboardinization (INCR-13) demo seed for Asankrangwa — surface 07 on one screen.
 * Marker-scoped + re-run-safe: it deletes the infractions of the demo boarder set + the dedicated
 * ASK-DEB-* off-roll students (whose deletion cascades their infractions/records), then re-inserts.
 *
 * Demonstrates every AC trap:
 *   • A ledger across six Houses — Notes / Warnings / a Bond / a Suspension (grouped by severity).
 *   • 3 dedicated off-roll students (residency=DEBOARDINIZED, never touching the live roster) — one is
 *     Board-review-pending (a filed motion). Penalty snapshots with fee_penalty_invoice_id LEFT NULL.
 *   • One bond-in-flight (student + HM signed, Senior HM pending → "Awaiting 1 signature").
 *   • J. Manu (ASK-24-0118) is pastorally flagged → he is NOT laddered; the pastoral card renders him
 *     Dean-routed (reconciling Lucy's drift: the surface named A. Quartey; the stub flags J. Manu).
 *
 * Run AFTER db:seed + db:seed-boarding. `pnpm db:seed-discipline`.
 */

async function main() {
  const [school] = await db.select({ id: schools.id }).from(schools).where(eq(schools.gesCode, "WR-WAW-014"));
  if (!school) {
    console.error("✗ Asankrangwa not seeded — run `pnpm db:seed` first.");
    process.exit(1);
  }
  const schoolId = school.id;

  const houseRows = await db.select({ id: houses.id, name: houses.name }).from(houses).where(eq(houses.schoolId, schoolId));
  const houseId = (name: string) => houseRows.find((h) => h.name === name)?.id ?? null;

  const userByRole = async (code: string) => {
    const [r] = await db
      .select({ id: users.id })
      .from(roleAssignments)
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .innerJoin(users, eq(roleAssignments.userId, users.id))
      .where(and(eq(roleAssignments.schoolId, schoolId), eq(roles.code, code)))
      .limit(1);
    return r?.id ?? null;
  };
  const [phoneHm] = await db.select({ id: users.id }).from(users).where(eq(users.phone, "+233244000004"));
  const hmId = (await userByRole("HOUSEMASTER")) ?? phoneHm?.id ?? null;
  const deanId = (await userByRole("DEAN_OF_BOARDING")) ?? hmId;
  const headId = (await userByRole("HEADMASTER")) ?? hmId;

  // A class to hang the off-roll demo students on (any senior class).
  const [anyClass] = await db.select({ id: classes.id }).from(classes).where(eq(classes.schoolId, schoolId)).limit(1);
  const classId = anyClass?.id ?? null;

  // Baseline demo boarders (F0 spine) used for the ledger. ASK-24-0118 (J. Manu) is DELIBERATELY absent
  // — he is pastorally flagged and must NOT be laddered.
  const ledgerCodes = ["ASK-24-0147", "ASK-24-0149", "ASK-24-0146", "ASK-24-0142", "ASK-24-0144", "ASK-BRD-AGG-01", "ASK-BRD-AGG-02"];
  const baseRows = await db
    .select({ id: students.id, code: students.studentCode, houseId: students.houseId })
    .from(students)
    .where(and(eq(students.schoolId, schoolId), inArray(students.studentCode, ledgerCodes)));
  const byCode = new Map(baseRows.map((r) => [r.code, r]));

  // --- Re-run-safe cleanup ---
  // 1) The dedicated off-roll demo students (their deletion cascades infractions + records + allocs).
  await db.delete(students).where(and(eq(students.schoolId, schoolId), like(students.studentCode, "ASK-DEB-%")));
  // 2) The baseline demo boarders' infractions (cascades their bonds).
  const baseIds = baseRows.map((r) => r.id);
  if (baseIds.length) {
    await db.delete(boardingInfractions).where(and(eq(boardingInfractions.schoolId, schoolId), inArray(boardingInfractions.studentId, baseIds)));
  }

  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

  // --- Ledger infractions (Notes / Warnings / Bond / Suspension across Houses) ---
  type Inf = typeof boardingInfractions.$inferInsert;
  const infRows: Inf[] = [];
  const inf = (code: string, severity: Inf["severity"], narrative: string, at: Date): string | null => {
    const s = byCode.get(code);
    if (!s) return null;
    infRows.push({ schoolId, studentId: s.id, houseId: s.houseId, severity, narrativeText: narrative, status: "OPEN", sourceKind: "MANUAL", loggedByUserId: hmId ?? undefined, loggedAt: at });
    return code;
  };
  // 3 open Notes → the "Warning eligible" auto-escalation prompt fires.
  inf("ASK-24-0147", "NOTE", "Late to roll call · third instance this week · approaching auto-escalation.", daysAgo(2));
  inf("ASK-24-0149", "NOTE", "Missed morning duties · second instance this semester.", daysAgo(2));
  inf("ASK-24-0142", "NOTE", "Wearing unauthorised dress in dorm after lights out.", daysAgo(3));
  // Warnings (parent-notified in the live flow — the seed writes directly, no SMS).
  inf("ASK-24-0146", "WARNING", "Receiving a visitor at an unauthorised time · refused to leave the gate.", daysAgo(2));
  inf("ASK-BRD-AGG-01", "WARNING", "Repeated late prep arrival · three strikes, promoted from Note.", daysAgo(4));
  // A Suspension.
  inf("ASK-BRD-AGG-02", "SUSPENSION", "Fighting with a peer during prep · injury minor · parent collected.", daysAgo(3));

  const insertedInf = infRows.length
    ? await db.insert(boardingInfractions).values(infRows).returning({ id: boardingInfractions.id, studentId: boardingInfractions.studentId, severity: boardingInfractions.severity })
    : [];

  // --- A Bond in flight (student + HM signed, Senior HM pending) ---
  const ama = byCode.get("ASK-24-0144");
  if (ama) {
    const [bondInf] = await db
      .insert(boardingInfractions)
      .values({ schoolId, studentId: ama.id, houseId: ama.houseId, severity: "BOND", narrativeText: "Bullying of a Form 1 dormmate over two days · counselling scheduled.", status: "OPEN", sourceKind: "MANUAL", loggedByUserId: hmId ?? undefined, loggedAt: daysAgo(1) })
      .returning({ id: boardingInfractions.id });
    await db.insert(bondArtefacts).values({
      schoolId,
      infractionId: bondInf.id,
      bondText:
        "do hereby acknowledge that I engaged in repeated bullying of a Form 1 dormmate, contrary to the rules of the school and the bond of mutual care that binds this House. I undertake, before my Housemistress and the Senior Housemaster, that I shall not repeat such conduct, and I commit to weekly counselling with the Padre for the duration of this semester.",
      studentSignatureAt: daysAgo(0), // student signed
      hmWitnessUserId: hmId ?? undefined,
      hmWitnessAt: daysAgo(0), // HM witnessed
      // Senior HM slot LEFT unsigned → "Awaiting 1 signature".
    });
  }

  // --- 3 dedicated off-roll (DEBOARDINIZED) demo students + their records ---
  type OffRoll = {
    code: string;
    first: string;
    last: string;
    exHouse: string;
    offence: string;
    effectiveAgo: number;
    penaltyDays: number | null;
    perDay: number | null;
    adjusted: number | null;
    reason: string | null;
    boardReview: string | null; // motion → Board-review-pending
  };
  const offRoll: OffRoll[] = [
    {
      code: "ASK-DEB-002",
      first: "Michael",
      last: "Yeboah",
      exHouse: "Guggisberg",
      offence: "Fighting + damage to property · second offence after a Semester 1 bond · assault on a House Prefect during lights-out enforcement.",
      effectiveAgo: 89,
      penaltyDays: null, // no return attempt → no penalty
      perDay: null,
      adjusted: null,
      reason: null,
      boardReview: null,
    },
    {
      code: "ASK-DEB-001",
      first: "Peter",
      last: "Annan",
      exHouse: "Fraser",
      offence: "Repeated unauthorised exit + housing a deboardinized student · sneaked out four nights running · admitted harbouring a removed peer.",
      effectiveAgo: 97,
      penaltyDays: 4,
      perDay: 125,
      adjusted: 510, // GHS 1,500 → 510 at the Head's discretion (surface PEN-2026-009)
      reason: "partial",
      boardReview: null,
    },
    {
      code: "ASK-DEB-003",
      first: "Kwesi",
      last: "Donkor",
      exHouse: "Aggrey",
      offence: "Theft of provisions from dormitory chop boxes · second offence · signed a false bond declaration · attempted an unauthorised return.",
      effectiveAgo: 2,
      penaltyDays: 1,
      perDay: 136,
      adjusted: null,
      reason: null,
      boardReview:
        "Fri 16 May, 10:00 GMT — Headmaster has filed a motion for Bond reinstatement on grounds of the student's age (14) and admission of remorse. Parent attending. Outcome appended to record.",
    },
  ];

  for (const o of offRoll) {
    const [stu] = await db
      .insert(students)
      .values({
        schoolId,
        studentCode: o.code,
        firstName: o.first,
        lastName: o.last,
        sex: "MALE" as const,
        status: "ACTIVE" as const,
        classId,
        programme: "GENERAL_ARTS" as const,
        residency: "DEBOARDINIZED" as const, // off the boarding roll (excluded from boarder cohorts)
        houseId: houseId(o.exHouse), // ex-House snapshot for display
        currentBunkId: null, // no bunk — released at deboardinization
        enrolledOn: "2024-09-09",
      })
      .returning({ id: students.id });

    const [dinf] = await db
      .insert(boardingInfractions)
      .values({
        schoolId,
        studentId: stu.id,
        houseId: houseId(o.exHouse),
        severity: "DEBOARDINIZATION",
        narrativeText: o.offence,
        status: "OPEN",
        sourceKind: "MANUAL",
        loggedByUserId: headId ?? undefined,
        loggedAt: daysAgo(o.effectiveAgo),
      })
      .returning({ id: boardingInfractions.id });

    const eff = daysAgo(o.effectiveAgo);
    await db.insert(deboardinizationRecords).values({
      schoolId,
      studentId: stu.id,
      infractionId: dinf.id,
      hmSignUserId: hmId ?? undefined,
      hmSignAt: eff,
      seniorHmSignUserId: deanId ?? undefined,
      seniorHmSignAt: eff,
      headmasterSignUserId: headId ?? undefined,
      headmasterSignAt: eff,
      effectiveAt: eff, // in effect — 3 co-signs present (the CHECK is satisfied)
      boardReviewAt: o.boardReview ? daysAgo(0) : null,
      boardDecisionText: o.boardReview, // the filed motion (Board-review-pending)
      // 🟥 fee_penalty_invoice_id LEFT NULL — the invoice-write STUB (no billing coupling).
      penaltyDays: o.penaltyDays,
      penaltyPerDayAmount: o.perDay != null ? o.perDay.toFixed(2) : null,
      penaltyAdjustedAmount: o.adjusted != null ? o.adjusted.toFixed(2) : null,
      penaltyAdjustmentReason: o.reason,
    });
  }

  await db.insert(auditLog).values({
    schoolId,
    actorUserId: headId ?? undefined,
    actorRole: "HEADMASTER",
    actionType: "created",
    entityType: "boarding_discipline_seed",
    entityId: schoolId,
    afterState: {
      ledgerInfractions: insertedInf.length,
      bondInFlight: ama ? "ASK-24-0144 (2 of 3 signed)" : null,
      deboardinized: offRoll.map((o) => o.code),
      boardReviewPending: "ASK-DEB-003",
      pastoralFlagged: "ASK-24-0118 (Dean-routed, not laddered)",
      invoiceWrite: "STUB — fee_penalty_invoice_id NULL on every record",
    },
    reason: "Boarding discipline (INCR-13) demo seed — ledger across Houses, 3 deboardinized (one Board-review-pending), a bond in flight, J. Manu pastoral (Dean-routed). Penalty display-only, no invoice write.",
  });

  console.log(
    `✓ Discipline seed — ${insertedInf.length} ledger infractions, 1 bond in flight, 3 deboardinized ` +
      `(ASK-DEB-001/002/003; DEB-003 Board-review-pending), J. Manu pastoral/Dean-routed. Penalty display-only, fee_penalty_invoice_id NULL.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ Discipline seed failed:", err);
    process.exit(1);
  });
