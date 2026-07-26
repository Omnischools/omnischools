import "@/db/_loadenv";
import { and, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withSchool } from "@/lib/db/rls";
import {
  schools,
  students,
  sickbayHospital,
  sickbayVisit,
  sickbayReferral,
  sickbayReferralCostLine,
} from "@/db/schema";
import { getOutbreakMonitor } from "@/lib/sickbay/surveillance-reads";
import { getReferralHistory, getNhisReconciliation } from "@/lib/sickbay/referral-reads";

/**
 * INCR-27 — the OUTBREAK-MONITOR / 30-day HISTORY / NHIS-RECON verifier (Quinn, AC Q1–Q19). Two proofs
 * against the LIVE dev DB, mirroring scripts/verify-sickbay-referral.ts:
 *
 *   PHASE A · the REAL readers (as the dev superuser). The app-layer PROJECTION + the derived-at-read
 *     counts are the boundary. Runs the exact functions the pages call and asserts: the outbreak
 *     monitor's counts/status ladder (4→Monitor, 8→Amber), the WoW trend, the void/null-category
 *     exclusions, and — the load-bearing PII fact — that NO student token appears anywhere in the
 *     monitor's serialised output. The history's "Diagnosis" column IS the visit's live
 *     working_impression; the recon's serialised output carries NO clinical field (Risk-4).
 *
 *   PHASE B · tenant isolation as `omnischools_app` (the non-superuser role prod connects as), in a
 *     ROLLED-BACK transaction, `SET LOCAL ROLE` + `app.current_school` exactly as withSchool does. The
 *     new surveillance_category column inherits sickbay_visit's tenant_isolation (0063 adds no policy),
 *     so this is the faithful cross-school negative: A's outbreak count + recon exclude B's visits.
 */
let failures = 0;
function ok(cond: boolean, label: string) {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${label}`);
  if (!cond) failures++;
}
class Rollback extends Error {}

const DAY = 86_400_000;
// A student token appearing in the serialised monitor/recon output is a leak (Q7/Q12/Q15).
const STUDENT_TOKENS = ["studentId", "studentName", "firstName", "lastName", "studentCode", "presentingComplaint"];
const CLINICAL_TOKENS = ["workingImpression", "surveillanceCategory", "presentingComplaint", "mensesNote"];

async function phaseA() {
  const rand = Math.random().toString(36).slice(2, 8);
  let schoolId = "";
  const now = new Date();
  const at = (n: number) => new Date(now.getTime() - n * DAY);
  try {
    const [{ id: sId }] = await db
      .insert(schools)
      .values({ name: `QOR-A-${rand}`, gesCode: `QOR-A-${rand}`, schoolType: "SENIOR" })
      .returning({ id: schools.id });
    schoolId = sId;
    const [{ id: studentId }] = await db
      .insert(students)
      .values({ schoolId, studentCode: `QOR-${rand}`, firstName: "Ama", lastName: "Boateng", sex: "FEMALE" })
      .returning({ id: students.id });
    const [{ id: hospitalId }] = await db
      .insert(sickbayHospital)
      .values({ schoolId, name: "Wassa Amenfi Govt. Hospital", acceptsNhis: true, active: true })
      .returning({ id: sickbayHospital.id });

    type Cat = "MALARIA" | "RESPIRATORY" | "DIARRHOEA" | "SKIN" | "EYE" | "INJURY" | "OTHER" | null;
    // A categorised visit is post-assessment, so it is DISPOSED (not "open") — which is also what keeps
    // the partial unique uniq_sickbay_open_visit_student(school,student) from colliding across the set.
    const mkVisit = (presentedAt: Date, category: Cat, opts: { voided?: boolean } = {}) =>
      db.insert(sickbayVisit).values({
        schoolId,
        studentId,
        presentedAt,
        presentingComplaint: "seen at sickbay",
        surveillanceCategory: category ?? undefined,
        disposition: opts.voided ? undefined : "DISCHARGE",
        dispositionAt: opts.voided ? undefined : presentedAt,
        voidedAt: opts.voided ? new Date() : null,
      });

    // Earliest visit 20 days back → a prior 7-day window EXISTS (trend is evaluated, not blank).
    await mkVisit(at(20), "MALARIA");
    // Prior window (7–14d): 2 MALARIA.
    await mkVisit(at(10), "MALARIA");
    await mkVisit(at(10), "MALARIA");
    // Current window (0–7d): 8 MALARIA (→ AMBER), 4 RESPIRATORY (→ MONITOR), 3 EYE (→ NORMAL).
    for (let i = 0; i < 8; i++) await mkVisit(at(1), "MALARIA");
    for (let i = 0; i < 4; i++) await mkVisit(at(1), "RESPIRATORY");
    for (let i = 0; i < 3; i++) await mkVisit(at(1), "EYE");
    // A VOIDED malaria + a NULL-category visit in the current window — both must be EXCLUDED from counts.
    await mkVisit(at(1), "MALARIA", { voided: true });
    await mkVisit(at(1), null);

    const monitor = await getOutbreakMonitor(schoolId, now);
    const byKey = Object.fromEntries(monitor.categories.map((c) => [c.key, c]));

    ok(monitor.priorWindowExists === true, "Q6: a prior 7-day window exists (earliest visit 20d back) — trend is evaluated");
    ok(byKey.MALARIA.count === 8 && byKey.MALARIA.status === "AMBER", `Q4/Q5: MALARIA 8 in window → AMBER (got ${byKey.MALARIA.count}/${byKey.MALARIA.status})`);
    ok(byKey.MALARIA.trend?.label === "↑ from 2", `Q6: MALARIA trend is "↑ from 2" (prior window = 2) (got "${byKey.MALARIA.trend?.label}")`);
    ok(byKey.RESPIRATORY.count === 4 && byKey.RESPIRATORY.status === "MONITOR", `Q4: RESPIRATORY 4 → MONITOR (got ${byKey.RESPIRATORY.count}/${byKey.RESPIRATORY.status})`);
    ok(byKey.EYE.count === 3 && byKey.EYE.status === "NORMAL", `Q4: EYE 3 (< 4) → NORMAL (got ${byKey.EYE.count}/${byKey.EYE.status})`);
    ok(byKey.DIARRHOEA.count === 0 && byKey.DIARRHOEA.trend?.label === "↔ baseline", "Q4: a zero category is a measured baseline, not omitted");
    ok(monitor.totalCases === 15, `Q3: totalCases excludes the voided + null-category visits (expected 15, got ${monitor.totalCases})`);
    ok(monitor.topStatus === "AMBER" && monitor.amberCount === 1 && monitor.monitorCount === 1, "Q4: top status AMBER, 1 amber + 1 monitor category");
    ok(monitor.conditionCount === 6 && !monitor.categories.some((c) => c.key === "OTHER"), "Q2: 6 district-aligned rows, OTHER excluded from the board");

    // 🔴 Q7/Q12 — the single most important PII fact: no student token anywhere in the monitor output.
    const monitorJson = JSON.stringify(monitor);
    const leaked = STUDENT_TOKENS.filter((t) => monitorJson.includes(t));
    ok(leaked.length === 0, `🔴 Q7: the outbreak monitor names NO student (serialised output carries no student token; leaked: [${leaked}])`);

    // ── §R4 — the 30-day history: "Diagnosis" = live working_impression; mix = 7 canonical, counts-only.
    const refVisit = async (impression: string, category: Cat) => {
      const [{ id }] = await db
        .insert(sickbayVisit)
        .values({
          schoolId,
          studentId,
          presentedAt: at(3),
          presentingComplaint: "referred out",
          workingImpression: impression,
          surveillanceCategory: category ?? undefined,
          disposition: "REFER",
          dispositionAt: at(3),
        })
        .returning({ id: sickbayVisit.id });
      return id;
    };
    const mkRef = async (visitId: string, departedAt: Date, status: "INPATIENT" | "RETURNED", oop: string | null) => {
      const [{ id }] = await db
        .insert(sickbayReferral)
        .values({ schoolId, studentId, visitId, hospitalId, status, departedAt, nhisValid: true, reasonReferredOut: "r" })
        .returning({ id: sickbayReferral.id });
      await db.insert(sickbayReferralCostLine).values({
        schoolId,
        referralId: id,
        itemLabel: oop ? "IV artesunate course" : "Consultation",
        nhisCovered: oop === null,
        outOfPocketAmount: oop,
      });
      return id;
    };
    const v1 = await refVisit("Suspected malaria, severe", "MALARIA");
    await mkRef(v1, at(3), "INPATIENT", "45.00"); // valid card + OOP gap → PARTIAL, outstanding
    const v2 = await refVisit("Acute gastroenteritis", "DIARRHOEA");
    await mkRef(v2, at(4), "RETURNED", null); // valid card + no OOP → YES, fully covered

    const h = await getReferralHistory(schoolId, now, { range: "30d", category: null });
    ok(h.total === 2, `Q9: history has the 2 referrals in the 30-day window (got ${h.total})`);
    const impressions = h.rows.map((r) => r.workingImpression).sort();
    ok(impressions.includes("Suspected malaria, severe") && impressions.includes("Acute gastroenteritis"), "🔴 Q9: the Diagnosis column IS the visit's LIVE working_impression");
    const mix = Object.fromEntries(h.categoryMix.map((b) => [b.key, b.count]));
    ok(mix.MALARIA === 1 && mix.DIARRHOEA === 1 && h.categoryMix.length === 2, "Q11: the mix walks the 7 canonical categories via the join (MALARIA 1, DIARRHOEA 1)");
    const nhisSet = h.rows.map((r) => r.nhis).sort();
    ok(nhisSet.includes("PARTIAL") && nhisSet.includes("YES"), "Q10: NHIS tri-state derived (one PARTIAL, one YES)");
    const mixJson = JSON.stringify(h.categoryMix) + JSON.stringify(h.hospitalMix);
    ok(!STUDENT_TOKENS.some((t) => mixJson.includes(t)) && !/Boateng|Ama/.test(mixJson), "🔴 Q12: no mix-bar aggregate exposes a student");

    // ── §R5 — the NHIS reconciliation: Σ OOP>0, covered count, and STRUCTURALLY clinical-free output.
    const recon = await getNhisReconciliation(schoolId, now);
    ok(recon.totalOutstanding === 45, `🔴 Q13: total outstanding = Σ OOP>0 = 45.00 (got ${recon.totalOutstanding})`);
    ok(recon.rows.length === 1 && recon.rows[0].outOfPocket === 45, "Q13: exactly the one referral carrying an out-of-pocket gap is outstanding");
    ok(recon.referralCount === 2 && recon.coveredCount === 1, `Q3: covered count = 1 of 2 (the cedi tile is replaced by an N-of-M COUNT) (got ${recon.coveredCount}/${recon.referralCount})`);
    ok(recon.rows[0].itemLabel.includes("artesunate"), "Q13: the outstanding row shows the cost REASON (item label), never a condition");
    const reconJson = JSON.stringify(recon);
    const reconLeak = CLINICAL_TOKENS.filter((t) => reconJson.includes(t) || reconJson.includes("Suspected malaria"));
    ok(reconLeak.length === 0, `🔴 Q15: the recon output carries NO clinical field (a BURSAR is structurally incapable of seeing a condition; leaked: [${reconLeak}])`);
    ok(reconJson.includes("Boateng"), "Q15: positive control — the recon DOES name the student + amount (money view, condition-free)");

    console.log(`\nPhase A (real-reader projection + derivations) done.`);
  } finally {
    if (schoolId) await db.delete(schools).where(eq(schools.id, schoolId));
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
          .values({ name: `QOR-${label}-${rand}`, gesCode: `QOR-${label}-${rand}`, schoolType: "SENIOR" })
          .returning({ id: schools.id });
        return id;
      };
      const A = await mkSchool("iso-A");
      const B = await mkSchool("iso-B");

      // A gets 5 MALARIA categorised visits + 1 referral/cost line; B gets 9 + 1. The counts must never mix.
      const seed = async (schoolId: string, nVisits: number) => {
        const [{ id: studentId }] = await tx
          .insert(students)
          .values({ schoolId, studentCode: `QORI-${schoolId.slice(0, 4)}`, firstName: "T", lastName: "T", sex: "MALE" })
          .returning({ id: students.id });
        const [{ id: hospitalId }] = await tx.insert(sickbayHospital).values({ schoolId, name: "H" }).returning({ id: sickbayHospital.id });
        for (let i = 0; i < nVisits; i++) {
          await tx.insert(sickbayVisit).values({ schoolId, studentId, presentedAt: new Date(), presentingComplaint: "x", surveillanceCategory: "MALARIA", disposition: "DISCHARGE", dispositionAt: new Date() });
        }
        const [{ id: visitId }] = await tx
          .insert(sickbayVisit)
          .values({ schoolId, studentId, presentedAt: new Date(), presentingComplaint: "x", workingImpression: "wi", surveillanceCategory: "MALARIA", disposition: "REFER", dispositionAt: new Date() })
          .returning({ id: sickbayVisit.id });
        const [{ id: referralId }] = await tx
          .insert(sickbayReferral)
          .values({ schoolId, studentId, visitId, hospitalId, status: "REFERRED", departedAt: new Date(), reasonReferredOut: "r" })
          .returning({ id: sickbayReferral.id });
        await tx.insert(sickbayReferralCostLine).values({ schoolId, referralId, itemLabel: "x", nhisCovered: false, outOfPocketAmount: "10.00" });
      };
      await seed(A, 5);
      await seed(B, 9);

      // Replicate the readers' core reads INSIDE the scoped tx (the real readers use their own pooled
      // connection, invisible to a rolled-back tx). No schoolId predicate → RLS alone is the boundary.
      const nCategorised = async () =>
        (await tx.select({ id: sickbayVisit.id }).from(sickbayVisit).where(isNotNull(sickbayVisit.surveillanceCategory))).length;
      const nReferrals = async () => (await tx.select({ id: sickbayReferral.id }).from(sickbayReferral)).length;
      const nCost = async () => (await tx.select({ id: sickbayReferralCostLine.id }).from(sickbayReferralCostLine)).length;
      const nBVisitsByExplicitId = async () =>
        (await tx.select({ id: sickbayVisit.id }).from(sickbayVisit).where(and(eq(sickbayVisit.schoolId, B), isNull(sickbayVisit.voidedAt)))).length;

      await tx.execute(APP_ROLE);

      // ── Scoped to A: the outbreak population + recon see ONLY A's rows (B invisible) ────────────────
      await tx.execute(setSchool(A));
      ok((await nCategorised()) === 6, "🔴 B1: scoped to A, the outbreak population is A's 6 categorised visits — B's 10 are RLS-hidden");
      ok((await nReferrals()) === 1 && (await nCost()) === 1, "B1: the recon population (referral + cost line) is tenant-isolated to A");
      ok((await nBVisitsByExplicitId()) === 0, "🔴 B1: scoped to A, reading school B's visits by explicit school_id returns 0 (RLS, not just the app predicate)");

      // ── Scoped to B: the inverse (A invisible) ─────────────────────────────────────────────────────
      await tx.execute(setSchool(B));
      ok((await nCategorised()) === 10, "🔴 B2: scoped to B, the outbreak population is B's 10 categorised visits — A's 6 are invisible");
      ok((await nReferrals()) === 1, "B2: scoped to B, the recon sees only B's referral");

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
  console.log(`\n${failures === 0 ? "✓ ALL INCR-27 OUTBREAK/HISTORY/RECON ASSERTIONS PASS" : `✗ ${failures} ASSERTION(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
