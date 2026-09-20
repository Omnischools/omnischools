import "@/db/_loadenv";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { withSchool } from "@/lib/db/rls";
import { reassignBunk } from "@/lib/actions/boarding";
import { decideReassign } from "@/lib/boarding/reassign-decision";
import {
  schools,
  houses,
  students,
  boardingDormitory,
  boardingBunk,
  bunkAllocation,
  auditLog,
} from "@/db/schema";

/**
 * DB-backed proof of the boarding invariants the browser round-trip and the unit tests can't
 * show directly: the atomic reassign (AC C), the one-per-bunk race backstop (AC D — headline),
 * the J3 gender guard, and the cross-House refusal. Run after `pnpm db:seed-boarding`.
 * Idempotent enough — it moves a demo boarder and moves him back.
 */
let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

async function bunkAt(schoolId: string, houseId: string, dorm: string, pos: number) {
  const [row] = await db
    .select({ id: boardingBunk.id })
    .from(boardingBunk)
    .innerJoin(boardingDormitory, eq(boardingBunk.dormitoryId, boardingDormitory.id))
    .where(
      and(
        eq(boardingDormitory.schoolId, schoolId),
        eq(boardingDormitory.houseId, houseId),
        eq(boardingDormitory.name, dorm),
        eq(boardingBunk.positionNumber, pos),
      ),
    );
  return row.id;
}
async function openAllocCount(studentId: string) {
  const rows = await db
    .select({ id: bunkAllocation.id })
    .from(bunkAllocation)
    .where(and(eq(bunkAllocation.studentId, studentId), isNull(bunkAllocation.toAt)));
  return rows.length;
}
async function allocCount(studentId: string) {
  const rows = await db
    .select({ id: bunkAllocation.id })
    .from(bunkAllocation)
    .where(eq(bunkAllocation.studentId, studentId));
  return rows.length;
}
async function currentBunk(studentId: string) {
  const [s] = await db
    .select({ b: students.currentBunkId })
    .from(students)
    .where(eq(students.id, studentId));
  return s.b;
}
async function studentId(schoolId: string, code: string) {
  const [s] = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.schoolId, schoolId), eq(students.studentCode, code)));
  return s?.id ?? null;
}

async function main() {
  const [school] = await db
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.gesCode, "WR-WAW-014"));
  if (!school) {
    console.error("Run `pnpm db:seed` then `pnpm db:seed-boarding` first.");
    process.exit(1);
  }
  const schoolId = school.id;
  const [aggrey] = await db
    .select({ id: houses.id, gender: houses.gender })
    .from(houses)
    .where(and(eq(houses.schoolId, schoolId), eq(houses.name, "Aggrey")));

  const kwame = (await studentId(schoolId, "ASK-24-0147"))!; // MALE, Aggrey (after J3 fix)
  const samuel = (await studentId(schoolId, "ASK-BRD-AGG-01"))!; // Aggrey A-01 (occupied)
  const efua = (await studentId(schoolId, "ASK-24-0146"))!; // FEMALE, Kingsley
  const a02 = await bunkAt(schoolId, aggrey.id, "A", 2); // Kwame's current bunk
  const d10 = await bunkAt(schoolId, aggrey.id, "D", 10); // a vacant Aggrey bunk
  const a01 = await bunkAt(schoolId, aggrey.id, "A", 1); // Samuel's occupied bunk

  // 1) J3 seed coherence — every Aggrey boarder is MALE (BOYS House).
  const aggreyBoarders = await db
    .select({ sex: students.sex })
    .from(students)
    .where(
      and(
        eq(students.schoolId, schoolId),
        eq(students.houseId, aggrey.id),
        eq(students.residency, "BOARDER"),
        eq(students.status, "ACTIVE"),
      ),
    );
  check("seed J3 coherence — all Aggrey boarders are MALE", aggreyBoarders.every((b) => b.sex === "MALE"));
  check("Aggrey House gender is BOYS", aggrey.gender === "BOYS");

  // 2) Reason required (AC C4) — rejected before any write.
  const before = await allocCount(kwame);
  const noReason = await reassignBunk({ studentId: kwame, targetBunkId: d10, reason: "  " });
  check("reason required — blank reason refused", !noReason.ok, noReason.error);
  check("no history written when reason missing", (await allocCount(kwame)) === before);

  // 3) Occupied bunk refused + no orphan row (AC C3).
  const occ = await reassignBunk({ studentId: kwame, targetBunkId: a01, reason: "trying an occupied bunk" });
  check("occupied bunk refused", !occ.ok, occ.error);
  check("occupied refusal wrote no history", (await allocCount(kwame)) === before);
  check("Kwame still in A-02 after occupied refusal", (await currentBunk(kwame)) === a02);

  // 4) Cross-House (⇒ cross-gender) refused via the real action.
  const cross = await reassignBunk({ studentId: efua, targetBunkId: d10, reason: "cross-house attempt" });
  check("cross-House reassign refused", !cross.ok, cross.error);

  // 5) J3 gender guard (pure) with the real seeded Aggrey gender — a FEMALE into a BOYS House.
  const gd = decideReassign({
    reason: "x",
    student: { houseId: aggrey.id, sex: "FEMALE", currentBunkId: null },
    target: { bunkId: d10, houseId: aggrey.id, houseGender: aggrey.gender as "BOYS", occupiedByOther: false },
  });
  check("gender guard refuses FEMALE into BOYS House", !gd.ok && gd.reason === "gender_mismatch");

  // 6) Happy path (AC C1/C2) — atomic move: pointer + append-only history + audit.
  const auditCount = async () =>
    (
      await db
        .select({ id: auditLog.auditId })
        .from(auditLog)
        .where(and(eq(auditLog.schoolId, schoolId), eq(auditLog.actionType, "BUNK_REASSIGNED")))
    ).length;
  const auditBefore = await auditCount();
  const ok = await reassignBunk({ studentId: kwame, targetBunkId: d10, reason: "Verify: end-of-term swap" });
  check("within-House reassign succeeds", ok.ok, ok.error);
  check("pointer moved to D-10", (await currentBunk(kwame)) === d10);
  check("history appended (prior row kept, ≥2 total)", (await allocCount(kwame)) >= before + 1);
  check("exactly one OPEN allocation after move", (await openAllocCount(kwame)) === 1);
  check("BUNK_REASSIGNED audit row written (AC H)", (await auditCount()) === auditBefore + 1);

  // 7) One-per-bunk DB invariant (AC D) — a second student cannot claim D-10 while Kwame holds it.
  let raceRejected = false;
  try {
    await withSchool(schoolId, async (tx) => {
      await tx.update(students).set({ currentBunkId: d10 }).where(eq(students.id, samuel));
    });
  } catch {
    raceRejected = true;
  }
  check("partial-unique blocks a second student on the same bunk", raceRejected);
  check("loser's pointer unchanged (whole-tx rollback)", (await currentBunk(samuel)) === a01);

  // restore Kwame to A-02 (append-only, so this adds one more history row — expected).
  await reassignBunk({ studentId: kwame, targetBunkId: a02, reason: "Verify: restore" });
  check("Kwame restored to A-02", (await currentBunk(kwame)) === a02);

  console.log(failures === 0 ? "\nALL BOARDING CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-boarding failed:", e);
  process.exit(1);
});
