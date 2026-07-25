import "@/db/_loadenv";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withSchool } from "@/lib/db/rls";
import {
  schools,
  students,
  users,
  sickbayHospital,
  sickbayVisit,
  sickbayReferral,
  sickbayReferralUpdate,
  sickbayReferralCostLine,
} from "@/db/schema";
import {
  getActiveReferrals,
  getReferralDetail,
  getReferralCostLines,
} from "@/lib/sickbay/referral-reads";
import { referredOutStudentIds, medicalHoldStudentIds } from "@/lib/sickbay/medical-hold";

/**
 * INCR-25b — the referral PROJECTION-MATRIX + tenant-isolation verifier (Quinn, AC RF3/RF9/RF10 +
 * R192/R193/R195). Two independent proofs against the LIVE dev DB:
 *
 *   PHASE A · the REAL readers (as the dev superuser). A superuser bypasses RLS, so the app-layer
 *     PROJECTION is the boundary here (R195) — this runs the exact functions the pages call and asserts
 *     the field-set each role's reader returns: MATRON/HEADMASTER get full clinical
 *     (working_impression, frozen handoff, menses, ward updates); BURSAR (`getReferralCostLines`) gets
 *     ONLY the diagnosis-free cost keys; HOUSEMASTER (`referredOutStudentIds`) gets a Set of ids and
 *     nothing else. The medical-hold R193 boundary ("Mark returned drops the student the next civil
 *     day") is proven against the live SQL. Fixtures are COMMITTED (the readers open their own pooled
 *     connection, so a rolled-back tx would be invisible to them) then deleted in `finally`.
 *
 *   PHASE B · tenant isolation as `omnischools_app` (the non-superuser role prod connects as), in a
 *     ROLLED-BACK transaction, `SET LOCAL ROLE` + `app.current_school` exactly as withSchool does. The
 *     0062 `tenant_isolation` policy on sickbay_referral is only enforced off the superuser, so this is
 *     the faithful cross-school negative: A's session reads 0 of B's rows and a cross-tenant relocate
 *     is refused.
 */
let failures = 0;
function ok(cond: boolean, label: string) {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${label}`);
  if (!cond) failures++;
}
class Rollback extends Error {}

const CLINICAL_KEYS = [
  "workingImpression",
  "mensesNote",
  "reasonReferredOut",
  "preReferralCare",
  "handoffLabs",
  "lastMeal",
  "travelNote",
  "presentingComplaint",
];

async function phaseA() {
  const rand = Math.random().toString(36).slice(2, 8);
  let schoolId = "";
  let hmUserId = "";
  try {
    // ── Fixture (committed) ──────────────────────────────────────────────────────────────────────
    const [{ id: sId }] = await db
      .insert(schools)
      .values({ name: `QVR-A-${rand}`, gesCode: `QVR-A-${rand}`, schoolType: "SENIOR" })
      .returning({ id: schools.id });
    schoolId = sId;

    const [{ id: hmId }] = await db
      .insert(users)
      .values({ phone: `+233900${rand}`.slice(0, 15), fullName: `Kwesi Headmaster` })
      .returning({ id: users.id });
    hmUserId = hmId;

    const [{ id: studentId }] = await db
      .insert(students)
      .values({ schoolId, studentCode: `QVR-${rand}`, firstName: "Yaa", lastName: "Aidoo", sex: "FEMALE" })
      .returning({ id: students.id });

    const [{ id: hospitalId }] = await db
      .insert(sickbayHospital)
      .values({ schoolId, name: "St. Theresa's Hospital", acceptsNhis: true, active: true })
      .returning({ id: sickbayHospital.id });

    const [{ id: visitId }] = await db
      .insert(sickbayVisit)
      .values({
        schoolId,
        studentId,
        presentedAt: new Date("2026-05-10T06:30:00Z"),
        presentingComplaint: "Severe abdominal pain, 2 days",
        workingImpression: "Suspected appendicitis", // R190 — the LIVE "Diagnosis" line
        disposition: "REFER",
        dispositionAt: new Date("2026-05-10T07:00:00Z"),
      })
      .returning({ id: sickbayVisit.id });

    const departedAt = new Date("2026-05-10T07:15:00Z");
    const returnedAt = new Date("2026-05-12T14:00:00Z");
    const [{ id: referralId }] = await db
      .insert(sickbayReferral)
      .values({
        schoolId,
        studentId,
        visitId,
        hospitalId,
        hmAuthorisedByUserId: hmUserId,
        hmAuthorisedAt: departedAt,
        status: "INPATIENT",
        departedAt,
        hospitalWard: "Surgical B",
        hospitalBed: "12",
        transportMode: "School van",
        attendingClinicianName: "Dr. Mensah",
        nhisCardNumber: "NHIS-9842-1276-5503",
        nhisValid: true,
        reasonReferredOut: "Acute abdomen — needs surgical review",
        handoffLabs: "Temp 38.9, WBC pending",
        lastMeal: "06:00 light",
        mensesNote: "LMP 3 weeks ago", // 🔴 Class-4 PII — must render to MATRON, never to BURSAR/HM
        travelNote: "Guardian met at gate",
      })
      .returning({ id: sickbayReferral.id });

    await db.insert(sickbayReferralUpdate).values({
      schoolId,
      referralId,
      occurredAt: new Date("2026-05-11T09:00:00Z"),
      clinicianName: "Dr. Mensah",
      clinicianAffiliation: "St. Theresa's",
      body: "Post-op stable, observing overnight",
    });

    await db.insert(sickbayReferralCostLine).values([
      { schoolId, referralId, itemLabel: "Appendectomy", provider: "St. Theresa's", nhisCovered: true, outOfPocketAmount: null },
      { schoolId, referralId, itemLabel: "Private room top-up", provider: "St. Theresa's", nhisCovered: false, outOfPocketAmount: "45.00" },
    ]);

    const now = new Date("2026-05-11T10:00:00Z");

    // ── MATRON/HEADMASTER · getActiveReferrals — full clinical projection (§01) ───────────────────
    const active = await getActiveReferrals(schoolId, now);
    ok(active.stats.activeCount === 1, `A1: getActiveReferrals returns the one open referral (got ${active.stats.activeCount})`);
    const row = active.rows[0];
    ok(!!row && row.workingImpression === "Suspected appendicitis", "A1: the clinical reader carries the LIVE working_impression");
    ok(!!row && row.nhisCardNumber === "NHIS-9842-1276-5503" && row.status === "INPATIENT", "A1: NHIS snapshot + status present for the clinical reader");
    ok(!!row && row.latestUpdate?.includes("Post-op stable") === true, "A1: the ward update reaches the clinical list");

    // ── MATRON/HEADMASTER · getReferralDetail — full clinical + handoff + menses (§02) ────────────
    const detail = await getReferralDetail(schoolId, referralId, now);
    ok(!!detail, "A2: getReferralDetail resolves the referral of this school");
    if (detail) {
      ok(detail.workingImpression === "Suspected appendicitis", "A2: detail carries the working_impression");
      ok(detail.reasonReferredOut === "Acute abdomen — needs surgical review", "A2: detail carries the frozen reason_referred_out");
      ok(detail.mensesNote === "LMP 3 weeks ago", "A2: detail carries the Class-4 menses note (clinical gate only)");
      ok(detail.handoffLabs === "Temp 38.9, WBC pending", "A2: detail carries the frozen handoff labs");
      ok(detail.updates.length === 1, `A2: detail carries the append-only update (got ${detail.updates.length})`);
      ok(detail.costLines.length === 2, `A2: detail carries both cost lines (got ${detail.costLines.length})`);
      ok(detail.hmAuthorisedByName !== null, "A2: the HM co-signer name resolves");
    }

    // ── BURSAR · getReferralCostLines — diagnosis-free by construction (R195) ──────────────────────
    const cost = await getReferralCostLines(schoolId, referralId);
    ok(cost.lines.length === 2, `A3: BURSAR reader returns both cost lines (got ${cost.lines.length})`);
    const costKeys = cost.lines.length ? Object.keys(cost.lines[0]).sort() : [];
    const EXPECT_COST_KEYS = ["id", "itemLabel", "nhisCovered", "outOfPocketAmount", "provider"];
    ok(
      JSON.stringify(costKeys) === JSON.stringify(EXPECT_COST_KEYS),
      `A3: BURSAR cost line has EXACTLY the diagnosis-free five keys (got ${costKeys.join(",")})`,
    );
    const costLeak = cost.lines.some((l) => CLINICAL_KEYS.some((k) => k in (l as unknown as Record<string, unknown>)));
    ok(!costLeak, "A3: NO clinical key on any BURSAR cost line (a leaked working_impression would RED here)");
    ok(cost.totalOutOfPocket === 45, `A3: total out-of-pocket derived correctly (got ${cost.totalOutOfPocket})`);

    // ── HOUSEMASTER · referredOutStudentIds — off-campus EXISTENCE only (a Set of ids) ────────────
    // 🔴 R192 defect: the helper interpolates a raw JS Date into its sql fragment (`<= ${asOf}`), which
    // THROWS under drizzle-orm@0.45 + postgres.js@3.4 ("Received an instance of Date"). Its default arg
    // is `new Date()`, so EVERY invocation crashes. No shipped surface calls it yet (INCR-28's boarding
    // headcount is the first consumer), but as an R192 deliverable it does not run. One-line fix:
    // interpolate `${asOf.toISOString()}` on both bounds (the medical-hold arm already uses a string).
    let offCampus: Set<string> | null = null;
    try {
      offCampus = await referredOutStudentIds(schoolId, now);
    } catch (e) {
      offCampus = null;
      ok(false, `🔴 A4/RF9: referredOutStudentIds THREW at runtime — ${(e as Error).message.split("\n")[0].slice(0, 90)}`);
    }
    if (offCampus) {
      ok(offCampus instanceof Set, "A4: HOUSEMASTER projection is a Set (existence only — no object to leak a field)");
      ok(offCampus.has(studentId) && offCampus.size === 1, `A4: the one referred-out student is present (size ${offCampus.size})`);
    }

    // ── A4b · the PREDICATE LOGIC is sound (only the Date-encoding is broken) — replicate the
    //         referredOutStudentIds instant-semantics with an ISO-serialised bound (the one-line fix). ─
    const isoOffCampus = async (asOf: Date) =>
      withSchool(schoolId, async (tx) => {
        const r = await tx
          .select({ studentId: sickbayReferral.studentId })
          .from(sickbayReferral)
          .where(
            and(
              eq(sickbayReferral.schoolId, schoolId),
              sql`${sickbayReferral.voidedAt} IS NULL`,
              sql`${sickbayReferral.departedAt} <= ${asOf.toISOString()}`,
              sql`(${sickbayReferral.returnedAt} IS NULL OR ${sickbayReferral.returnedAt} > ${asOf.toISOString()})`,
            ),
          );
        return new Set(r.map((x) => x.studentId));
      });
    ok((await isoOffCampus(new Date("2026-05-11T10:00:00Z"))).has(studentId), "A4b: predicate logic sound — off-campus while open (the fix returns this)");

    // ── R193 · the medical-hold boundary — open ⇒ held, then Mark returned drops it the NEXT civil day.
    const holdOn = (dateStr: string) =>
      withSchool(schoolId, (tx) => medicalHoldStudentIds(tx, schoolId, dateStr, [studentId]));
    // While OPEN (returned_at NULL): held on the departure day and every day after.
    ok((await holdOn("2026-05-10")).has(studentId), "A5: OPEN referral is held on the departure day (2026-05-10)");
    ok((await holdOn("2026-05-13")).has(studentId), "A5: OPEN referral is still held days later (2026-05-13)");
    // Mark returned at 2026-05-12 14:00 (what markReferralReturned writes: status RETURNED + returned_at).
    await db
      .update(sickbayReferral)
      .set({ status: "RETURNED", returnedAt: returnedAt })
      .where(and(eq(sickbayReferral.schoolId, schoolId), eq(sickbayReferral.id, referralId)));
    ok((await holdOn("2026-05-12")).has(studentId), "A5: still held ON the return day itself (2026-05-12)");
    ok(!(await holdOn("2026-05-13")).has(studentId), "🔴 A5: DROPPED the next civil day after return (2026-05-13) — the R193 half-open boundary");
    // …and the referredOutStudentIds instant-predicate (via the fix) drops it right after the return.
    ok((await isoOffCampus(new Date("2026-05-12T13:00:00Z"))).has(studentId), "A4b: off-campus at an instant BEFORE the return time");
    ok(!(await isoOffCampus(new Date("2026-05-12T15:00:00Z"))).has(studentId), "A4b: off-campus set EXCLUDES the student at an instant AFTER return");

    console.log(`\nPhase A (real-reader projection) done.`);
  } finally {
    if (schoolId) await db.delete(schools).where(eq(schools.id, schoolId));
    if (hmUserId) await db.delete(users).where(eq(users.id, hmUserId));
  }
}

async function phaseB() {
  const rand = Math.random().toString(36).slice(2, 8);
  const APP_ROLE = sql`set local role omnischools_app`;
  const RESET_ROLE = sql`reset role`;
  const setSchool = (id: string) => sql`select set_config('app.current_school', ${id}, true)`;

  try {
    await db.transaction(async (tx) => {
      const mkSchool = async (label: string) => {
        const [{ id }] = await tx
          .insert(schools)
          .values({ name: `QVR-${label}-${rand}`, gesCode: `QVR-${label}-${rand}`, schoolType: "SENIOR" })
          .returning({ id: schools.id });
        return id;
      };
      const A = await mkSchool("iso-A");
      const B = await mkSchool("iso-B");

      const mk = async (schoolId: string) => {
        const [{ id: studentId }] = await tx
          .insert(students)
          .values({ schoolId, studentCode: `QVRI-${schoolId.slice(0, 4)}`, firstName: "T", lastName: "T", sex: "MALE" })
          .returning({ id: students.id });
        const [{ id: hospitalId }] = await tx
          .insert(sickbayHospital)
          .values({ schoolId, name: "H" })
          .returning({ id: sickbayHospital.id });
        const [{ id: visitId }] = await tx
          .insert(sickbayVisit)
          .values({ schoolId, studentId, presentedAt: new Date(), presentingComplaint: "x", disposition: "REFER", dispositionAt: new Date() })
          .returning({ id: sickbayVisit.id });
        const [{ id: referralId }] = await tx
          .insert(sickbayReferral)
          .values({ schoolId, studentId, visitId, hospitalId, status: "REFERRED", departedAt: new Date(), reasonReferredOut: "r" })
          .returning({ id: sickbayReferral.id });
        await tx
          .insert(sickbayReferralCostLine)
          .values({ schoolId, referralId, itemLabel: "x", nhisCovered: false, outOfPocketAmount: "10.00" });
        return { referralId };
      };
      const a = await mk(A);
      await mk(B);

      const nReferrals = async () => (await tx.select({ id: sickbayReferral.id }).from(sickbayReferral)).length;
      const nCost = async () => (await tx.select({ id: sickbayReferralCostLine.id }).from(sickbayReferralCostLine)).length;
      const refused = async (fn: () => Promise<unknown>): Promise<boolean> => {
        try {
          await tx.transaction(async () => {
            await fn();
          });
          return false;
        } catch {
          return true;
        }
      };

      await tx.execute(APP_ROLE);

      // ── B1 · A's session reads ONLY A's referral (school B invisible) ─────────────────────────────
      await tx.execute(setSchool(A));
      ok((await nReferrals()) === 1, `B1: scoped to A, sickbay_referral shows exactly A's 1 row (RLS hides B)`);
      ok((await nCost()) === 1, "B1: sickbay_referral_cost_line is tenant-isolated too (A sees 1)");

      // ── B2 · scoped to B, A's rows are invisible (the inverse) ────────────────────────────────────
      await tx.execute(setSchool(B));
      ok((await nReferrals()) === 1, "B2: scoped to B, A's referral is invisible (B sees only its own 1)");

      // ── B3 · a cross-tenant relocate A→B is refused ──────────────────────────────────────────────
      await tx.execute(setSchool(A));
      const relocate = await refused(() =>
        tx.update(sickbayReferral).set({ schoolId: B }).where(eq(sickbayReferral.id, a.referralId)),
      );
      ok(relocate, "B3: relocating A's referral into school B is REFUSED (tenant boundary)");

      // ── B4 · a foreign-school write is refused / no-op ───────────────────────────────────────────
      const foreignVoid = await tx
        .update(sickbayReferral)
        .set({ voidedAt: new Date() })
        .where(and(eq(sickbayReferral.id, a.referralId)))
        .returning({ id: sickbayReferral.id });
      // scoped to A this SHOULD succeed (positive control that the session is not simply dead)
      ok(foreignVoid.length === 1, "B4: scoped to A, A's own referral IS writable (positive control)");

      await tx.execute(RESET_ROLE);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  console.log(`\nPhase B (omnischools_app tenant isolation) done.`);
}

async function main() {
  await phaseA();
  await phaseB();
  console.log(
    `\n${failures === 0 ? "✓ ALL SICKBAY-REFERRAL PROJECTION + ISOLATION ASSERTIONS PASS" : `✗ ${failures} ASSERTION(S) FAILED`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
