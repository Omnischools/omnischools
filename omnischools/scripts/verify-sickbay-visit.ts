import "@/db/_loadenv";
import { and, eq, inArray, isNull, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { withSchool, isUniqueViolation } from "@/lib/db/rls";
import {
  createVisit,
  beginVisit,
  assessVisit,
  addVitals,
  disposeVisit,
  admitPatient,
  dischargeFromWard,
  voidVisit,
  addConsult,
} from "@/lib/actions/sickbay-visit";
import { saveBedCapacity, setSickbayMode } from "@/lib/actions/sickbay-config";
import { openAdmissionBeds, getVisitRecord } from "@/lib/sickbay/visit-reads";
import { visitState } from "@/lib/sickbay/visits";
import { getSickbayConfig } from "@/lib/sickbay/config";
import {
  schools,
  students,
  roles,
  roleAssignments,
  sickbayBed,
  sickbayVisit,
  sickbayAdmission,
  sickbaySettings,
  auditLog,
} from "@/db/schema";

/**
 * DB-backed proof of the INCR-22a invariants the unit tests cannot show: the MATRON-only clinical
 * gate against REAL server actions, the three partial-unique exclusivity invariants against a REAL
 * concurrent-shaped write, and — the two obligations INCR-21 recorded and could not test —
 *
 *   R59  `occupiedBedIds` is real: admit a real patient, then attempt a capacity decrease, and the
 *        R11 reject branch (unit-test-only since 0056) finally fires.
 *   R56  a switch to REFERRAL_ONLY is rejected while any admission is open, naming the beds.
 *
 * Run after `pnpm db:seed` + `pnpm db:seed-sickbay`. Every row it creates is deleted at the end,
 * scoped to the ids it created — nothing else is touched.
 *
 * ⚠ The dev auth shim resolves EVERY session to `DEV_USER` with roles ["ADMIN"], so the MATRON-only
 * actions are asserted to REFUSE here (which is itself AC Z1); the admitted-patient fixture the R56
 * and R59 checks need is therefore inserted directly, and the two CONFIG actions it drives are
 * [ADMIN, HEADMASTER]-gated, so they run for real end-to-end.
 */
let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

/** Every row this script writes carries the marker in its complaint — cleanup is scoped to it. */
const MARKER = "VERIFY-SICKBAY-22A";

/** Run a write expected to violate an invariant; returns the thrown error, or null if it committed. */
async function attempt(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}
const describe = (e: unknown) =>
  e === null ? "(it COMMITTED — the invariant is not enforced)" : ((e as Error).message ?? "").slice(0, 80);

async function main() {
  const [school] = await db.select({ id: schools.id }).from(schools).where(eq(schools.gesCode, "WR-WAW-014"));
  if (!school) throw new Error("seed the demo school first (pnpm db:seed)");

  const [matron] = await db
    .select({ id: roleAssignments.userId })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(and(eq(roleAssignments.schoolId, school.id), eq(roles.code, "MATRON")))
    .limit(1);
  check("a MATRON is assigned in the demo school", !!matron);

  const config = await getSickbayConfig(school.id);
  const generalBeds = config.beds.filter((b) => b.active && !b.isIsolation);
  const isolationBeds = config.beds.filter((b) => b.active && b.isIsolation);
  check("bed inventory is seeded", generalBeds.length > 0 && isolationBeds.length > 0,
    `${generalBeds.length} general · ${isolationBeds.length} isolation`);

  const roster = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.schoolId, school.id), eq(students.status, "ACTIVE")))
    .limit(2);
  check("two active students available", roster.length === 2);
  const [studentA, studentB] = roster;

  // ── Z1 · the clinical gate refuses the (dev-bypass ADMIN) session on EVERY mutation ───────────
  const refusal = "Only the Matron can record clinical information in the sickbay.";
  const gated: [string, Promise<{ ok: boolean; error?: string }>][] = [
    ["createVisit", createVisit({ studentId: studentA.id, presentingComplaint: "headache" })],
    ["beginVisit", beginVisit({ visitId: studentA.id })],
    ["assessVisit", assessVisit({ visitId: studentA.id, workingImpression: "x" })],
    ["addVitals", addVitals({ visitId: studentA.id, tempC: 37 })],
    ["disposeVisit", disposeVisit({ visitId: studentA.id, disposition: "DISCHARGE" })],
    ["admitPatient", admitPatient({ visitId: studentA.id, bedId: generalBeds[0].id, isIsolation: false, overnightPlan: "x" })],
    ["dischargeFromWard", dischargeFromWard({ admissionId: studentA.id })],
    ["voidVisit", voidVisit({ visitId: studentA.id, reason: "x" })],
    ["addConsult", addConsult({ visitId: studentA.id, clinicianName: "Dr X", mode: "PHONE", note: "x" })],
  ];
  for (const [name, p] of gated) {
    const res = await p;
    check(`Z1 ${name} refuses a non-MATRON session`, !res.ok && res.error === refusal, res.error ?? "");
  }
  const visitsAfterGate = await db
    .select({ id: sickbayVisit.id })
    .from(sickbayVisit)
    .where(and(eq(sickbayVisit.schoolId, school.id), eq(sickbayVisit.studentId, studentA.id)));
  check("Z1 the refused createVisit wrote NOTHING", visitsAfterGate.length === 0);

  // ── the admitted-patient fixture (what the matron's admit action produces) ────────────────────
  const bed = generalBeds[generalBeds.length - 1]; // the highest-numbered general bed
  const now = new Date();
  const { visitId, admissionId } = await withSchool(school.id, async (tx) => {
    const [v] = await tx
      .insert(sickbayVisit)
      .values({
        schoolId: school.id,
        studentId: studentA.id,
        presentedAt: now,
        presentingComplaint: `${MARKER} joint pain`,
        startedAt: now,
        attendingUserId: matron?.id ?? null,
        workingImpression: `${MARKER} working impression`,
        assessedAt: now,
        disposition: "ADMIT",
        dispositionAt: now,
      })
      .returning({ id: sickbayVisit.id });
    const [a] = await tx
      .insert(sickbayAdmission)
      .values({
        schoolId: school.id,
        visitId: v.id,
        studentId: studentA.id,
        bedId: bed.id,
        admittedAt: now,
        isIsolation: bed.isIsolation,
        overnightPlan: `${MARKER} overnight plan`,
      })
      .returning({ id: sickbayAdmission.id });
    return { visitId: v.id, admissionId: a.id };
  });
  console.log(`   fixture: visit ${visitId} · admission ${admissionId} · bed ${bed.bedNumber}`);

  // ── R32 · the state derives from the timestamps, read back off real rows ─────────────────────
  const record = await getVisitRecord(school.id, visitId);
  check("R32 a real ADMIT row derives state ADMITTED", !!record &&
    visitState(
      { presentedAt: record.presentedAt, startedAt: record.startedAt, disposition: record.disposition,
        dispositionAt: record.dispositionAt, voidedAt: record.voidedAt },
      record.admission,
    ) === "ADMITTED");

  // ── R58 · the three exclusivity invariants are the DB's, not an app check ─────────────────────
  // ONE OPEN VISIT PER STUDENT. The fixture above is CLOSED (disposition ADMIT) and so is exempt
  // from the partial unique by design — a student may have any number of PAST visits. So the race
  // is staged on a genuinely open one.
  const openVisitB = await withSchool(school.id, async (tx) => {
    const [v] = await tx
      .insert(sickbayVisit)
      .values({
        schoolId: school.id, studentId: studentB.id, presentedAt: new Date(),
        presentingComplaint: `${MARKER} open visit`,
      })
      .returning({ id: sickbayVisit.id });
    return v.id;
  });
  const secondOpenVisit = await attempt(() =>
    withSchool(school.id, async (tx) => {
      await tx.insert(sickbayVisit).values({
        schoolId: school.id, studentId: studentB.id, presentedAt: new Date(),
        presentingComplaint: `${MARKER} second open visit`,
      });
    }),
  );
  check("R58 a second OPEN visit for the same student is refused by the DB",
    secondOpenVisit !== null && isUniqueViolation(secondOpenVisit), describe(secondOpenVisit));
  check("R58 a CLOSED visit is exempt — the student still holds exactly one open visit",
    (await db.select({ id: sickbayVisit.id }).from(sickbayVisit)
      .where(and(eq(sickbayVisit.schoolId, school.id), eq(sickbayVisit.studentId, studentB.id),
        isNull(sickbayVisit.disposition)))).length === 1);

  // ONE OPEN ADMISSION PER BED — the concurrent double-admit race, refused by the DB, not by a
  // read-then-write check in lib/.
  const secondAdmit = await attempt(() =>
    withSchool(school.id, async (tx) => {
      await tx
        .update(sickbayVisit)
        .set({ startedAt: new Date(), disposition: "ADMIT", dispositionAt: new Date() })
        .where(eq(sickbayVisit.id, openVisitB));
      await tx.insert(sickbayAdmission).values({
        schoolId: school.id, visitId: openVisitB, studentId: studentB.id, bedId: bed.id,
        admittedAt: new Date(), isIsolation: bed.isIsolation, overnightPlan: "race",
      });
    }),
  );
  check("R58 a second OPEN admission on the SAME bed is refused by the DB",
    secondAdmit !== null && isUniqueViolation(secondAdmit), describe(secondAdmit));

  // ── R59 · occupiedBedIds is real: the R11 reject branch finally fires ─────────────────────────
  const occupied = await openAdmissionBeds(school.id);
  check("R59 openAdmissionBeds sees the occupied bed", occupied.some((o) => o.bedId === bed.id),
    `${occupied.length} occupied`);

  const decrease = await saveBedCapacity({ general: 0, isolation: isolationBeds.length });
  check(
    "R59 a capacity decrease that would retire an OCCUPIED bed is rejected, nothing saved",
    !decrease.ok && (decrease.error ?? "").includes("unoccupied") && (decrease.error ?? "").includes("Nothing was saved"),
    decrease.error ?? "(it SAVED — the guard is not wired)",
  );
  const bedsAfter = await getSickbayConfig(school.id);
  check("R59 the bed inventory is untouched after the reject",
    bedsAfter.bedCounts.general === generalBeds.length &&
      bedsAfter.bedCounts.isolation === isolationBeds.length,
    `${bedsAfter.bedCounts.general} general · ${bedsAfter.bedCounts.isolation} isolation`);

  // ── R56 · REFERRAL_ONLY is refused while a bed is occupied, naming the beds ───────────────────
  const modeSwitch = await setSickbayMode({ mode: "REFERRAL_ONLY" });
  check(
    "R56 a switch to REFERRAL_ONLY is rejected while an admission is open",
    !modeSwitch.ok &&
      (modeSwitch.error ?? "").includes("still admitted") &&
      (modeSwitch.error ?? "").includes(`bed ${bed.bedNumber}`) &&
      (modeSwitch.error ?? "").includes("Nothing was saved"),
    modeSwitch.error ?? "(it SAVED — the guard is not wired)",
  );
  const [settingsAfter] = await db
    .select({ mode: sickbaySettings.mode })
    .from(sickbaySettings)
    .where(eq(sickbaySettings.schoolId, school.id));
  check("R56 the mode is unchanged after the reject", settingsAfter?.mode !== "REFERRAL_ONLY",
    settingsAfter?.mode ?? "(no settings row)");

  // ── R56 · discharging the ward releases the block ────────────────────────────────────────────
  await withSchool(school.id, async (tx) => {
    await tx
      .update(sickbayAdmission)
      .set({ dischargedAt: new Date() })
      .where(and(eq(sickbayAdmission.schoolId, school.id), eq(sickbayAdmission.id, admissionId)));
  });
  const freed = await openAdmissionBeds(school.id);
  check("R56/R59 a discharged admission no longer occupies its bed", !freed.some((o) => o.bedId === bed.id));

  // ── R43 · the no-diagnosis ceiling holds on every string this module can emit ────────────────
  const emitted = [decrease.error, modeSwitch.error, ...gated.map(() => refusal)].join(" ").toLowerCase();
  check("R43 no error string this module emits contains `diagnos`", !emitted.includes("diagnos"));

  // ── cleanup — MARKER-SCOPED, never a broad `where schoolId` (repo memory: a broad delete once
  // destroyed the baseline academic periods). Only rows whose complaint carries the marker go.
  const mine = await db
    .select({ id: sickbayVisit.id })
    .from(sickbayVisit)
    .where(and(eq(sickbayVisit.schoolId, school.id), like(sickbayVisit.presentingComplaint, `${MARKER}%`)));
  await withSchool(school.id, async (tx) => {
    if (mine.length) {
      // admissions / vitals / consults cascade with the visit (composite FK ON DELETE CASCADE).
      await tx.delete(sickbayVisit).where(inArray(sickbayVisit.id, mine.map((r) => r.id)));
    }
    await tx
      .delete(auditLog)
      .where(and(eq(auditLog.schoolId, school.id), inArray(auditLog.entityId, [visitId, admissionId])));
  });
  const left = await db
    .select({ id: sickbayVisit.id })
    .from(sickbayVisit)
    .where(and(eq(sickbayVisit.schoolId, school.id), like(sickbayVisit.presentingComplaint, `${MARKER}%`)));
  check(`cleanup removed only this script's ${mine.length} marker rows`, left.length === 0);

  console.log(failures === 0 ? "\nAll sickbay visit checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
