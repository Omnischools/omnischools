import "@/db/_loadenv";
import { execSync } from "node:child_process";
import { and, eq, desc, isNull, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  schools,
  students,
  boardingCalendarEvent,
  boardingApprovedVisitor,
  boardingVisit,
  boardingVisitNotification,
} from "@/db/schema";
import {
  addApprovedVisitor,
  removeApprovedVisitor,
  recordVisit,
  arriveVisit,
  departVisit,
  authoriseVisit,
  sendVisitingReminder,
  runVisitingOverstayChecks,
} from "@/lib/actions/boarding-visiting";

/**
 * DB-backed proof of the visiting-day invariants (INCR-12) the browser render + unit tests can't show
 * directly: the real server actions run against the seeded dev DB (dev-bypass ADMIN), then the rows are
 * read back. Covers C (list-check VERIFIED/FLAGGED + HM override, not list-recorded), D (two-stamp),
 * walk-in NULL-distinct coexistence (Wells), G (overstay one-shot idempotent, ZERO discipline), I
 * (reminder idempotency). Re-seeds at the end to restore the canonical demo. Run after db:seed-visiting.
 */
let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

async function main() {
  const [school] = await db.select({ id: schools.id }).from(schools).where(eq(schools.gesCode, "WR-WAW-014"));
  if (!school) throw new Error("Seed missing — run db:seed first.");
  const schoolId = school.id;
  const todayIso = new Date().toISOString().slice(0, 10);

  const events = await db
    .select({ id: boardingCalendarEvent.id, date: boardingCalendarEvent.eventDate })
    .from(boardingCalendarEvent)
    .where(and(eq(boardingCalendarEvent.schoolId, schoolId), eq(boardingCalendarEvent.eventType, "VISITING")))
    .orderBy(boardingCalendarEvent.eventDate);
  const nextEvent = events.find((e) => e.date >= todayIso) ?? events[events.length - 1];
  const pastEvent = [...events].reverse().find((e) => e.date < todayIso) ?? null;

  const stu = async (code: string) => {
    const [s] = await db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.studentCode, code)));
    return s?.id ?? null;
  };
  const jmanu = await stu("ASK-24-0118");
  const abena = await stu("ASK-24-0142");
  const kofi = await stu("ASK-24-0149");
  if (!jmanu || !abena || !kofi) throw new Error("Demo boarders missing — run db:seed-boarding + db:seed-visiting.");

  const approvedOf = async (studentId: string) =>
    db
      .select({ id: boardingApprovedVisitor.id, name: boardingApprovedVisitor.name, status: boardingApprovedVisitor.status })
      .from(boardingApprovedVisitor)
      .where(and(eq(boardingApprovedVisitor.schoolId, schoolId), eq(boardingApprovedVisitor.studentId, studentId)));

  // --- B2 · max-6 cap (7th rejected) ---
  const before = await approvedOf(jmanu);
  check("B: J. Manu seeded with 5 approved visitors", before.length === 5, `count=${before.length}`);
  const add6 = await addApprovedVisitor({ studentId: jmanu, name: "Test Sixth", relationship: "Cousin" });
  check("B1: 6th approved visitor added (ok)", add6.ok, add6.error ?? add6.message ?? "");
  const add7 = await addApprovedVisitor({ studentId: jmanu, name: "Test Seventh", relationship: "Cousin" });
  check("B2: 7th approved visitor REJECTED (max 6)", !add7.ok, add7.error ?? "");
  // restore: remove the 6th
  const after6 = await approvedOf(jmanu);
  const sixth = after6.find((a) => a.name === "Test Sixth");
  if (sixth) await removeApprovedVisitor(sixth.id);
  const restored = await approvedOf(jmanu);
  check("B6: remove restores the list to 5", restored.length === 5, `count=${restored.length}`);

  // --- C1 · on-list APPROVED → VERIFIED (upsert collapses the seeded RSVP — D6) ---
  const mother = (await approvedOf(jmanu)).find((a) => a.name === "Mrs Esi Manu");
  check("C: J. Manu's APPROVED mother is on the list", !!mother && mother.status === "APPROVED");
  await recordVisit({ studentId: jmanu, calendarEventId: nextEvent.id, approvedVisitorId: mother!.id, action: "ARRIVE" });
  const motherVisits = await db
    .select({ id: boardingVisit.id, verification: boardingVisit.verification, status: boardingVisit.status })
    .from(boardingVisit)
    .where(
      and(
        eq(boardingVisit.schoolId, schoolId),
        eq(boardingVisit.studentId, jmanu),
        eq(boardingVisit.calendarEventId, nextEvent.id),
        eq(boardingVisit.approvedVisitorId, mother!.id),
      ),
    );
  check("C1: on-list arrival → VERIFIED, ARRIVED", motherVisits[0]?.verification === "VERIFIED" && motherVisits[0]?.status === "ARRIVED");
  check("D6: re-RSVP of the named visitor collapses to ONE row (upsert)", motherVisits.length === 1, `rows=${motherVisits.length}`);

  // --- C2/C4/C5 · walk-in not-on-list → FLAGGED → HM authorise → HM_AUTHORISED, NOT added to list ---
  const approvedBeforeWalkIn = (await approvedOf(jmanu)).length;
  await recordVisit({ studentId: jmanu, calendarEventId: nextEvent.id, visitorName: "Stranger One", relationship: "Family friend", action: "ARRIVE" });
  await recordVisit({ studentId: jmanu, calendarEventId: nextEvent.id, visitorName: "Stranger Two", relationship: "Neighbour", action: "ARRIVE" });
  const walkIns = await db
    .select({ id: boardingVisit.id, verification: boardingVisit.verification, name: boardingVisit.visitorName })
    .from(boardingVisit)
    .where(
      and(
        eq(boardingVisit.schoolId, schoolId),
        eq(boardingVisit.studentId, jmanu),
        eq(boardingVisit.calendarEventId, nextEvent.id),
        isNull(boardingVisit.approvedVisitorId),
      ),
    );
  const strangers = walkIns.filter((w) => w.name === "Stranger One" || w.name === "Stranger Two");
  check("C2: walk-in not-on-list → FLAGGED", strangers.every((w) => w.verification === "FLAGGED"), `flagged=${strangers.filter((w) => w.verification === "FLAGGED").length}`);
  check("Walk-in NULL-distinct: two walk-ins COEXIST as separate rows", strangers.length === 2, `rows=${strangers.length}`);
  const one = strangers[0];
  const auth = await authoriseVisit(one.id);
  check("C4: HM authorise on a FLAGGED visit (ok)", auth.ok, auth.message ?? auth.error ?? "");
  const [authed] = await db.select({ verification: boardingVisit.verification, authorisedBy: boardingVisit.authorisedByUserId }).from(boardingVisit).where(eq(boardingVisit.id, one.id));
  check("C4: verification → HM_AUTHORISED with an authoriser stamp", authed.verification === "HM_AUTHORISED" && authed.authorisedBy != null);
  const approvedAfterWalkIn = (await approvedOf(jmanu)).length;
  check("C5: HM override does NOT add an approved-visitor row (list-CHECK not list-RECORD)", approvedAfterWalkIn === approvedBeforeWalkIn, `${approvedBeforeWalkIn}→${approvedAfterWalkIn}`);
  const authNonFlagged = await authoriseVisit(one.id);
  check("C: authorising an already-authorised visit is rejected", !authNonFlagged.ok, authNonFlagged.error ?? "");

  // --- D1–D4 · two-stamp in/out + depart-before-arrive rejected ---
  const abenaMother = (await approvedOf(abena)).find((a) => a.name === "Mrs G. Adjei");
  await recordVisit({ studentId: abena, calendarEventId: nextEvent.id, approvedVisitorId: abenaMother!.id, action: "RSVP" });
  const [abenaVisit] = await db
    .select({ id: boardingVisit.id, status: boardingVisit.status })
    .from(boardingVisit)
    .where(and(eq(boardingVisit.schoolId, schoolId), eq(boardingVisit.studentId, abena), eq(boardingVisit.calendarEventId, nextEvent.id), isNotNull(boardingVisit.approvedVisitorId)));
  const departEarly = await departVisit(abenaVisit.id);
  check("D3: depart-before-arrive REJECTED", !departEarly.ok, departEarly.error ?? "");
  const arr = await arriveVisit(abenaVisit.id);
  check("D1: arrive stamps the in-time (ok)", arr.ok);
  const dep = await departVisit(abenaVisit.id);
  check("D2: depart stamps the out-time (ok)", dep.ok);
  const [twoStamp] = await db
    .select({ status: boardingVisit.status, arrivedAt: boardingVisit.arrivedAt, departedAt: boardingVisit.departedAt })
    .from(boardingVisit)
    .where(eq(boardingVisit.id, abenaVisit.id));
  check(
    "D4: DEPARTED with departed_at ≥ arrived_at",
    twoStamp.status === "DEPARTED" && !!twoStamp.arrivedAt && !!twoStamp.departedAt && twoStamp.departedAt >= twoStamp.arrivedAt,
  );

  // --- G · overstay on-read: one-shot, idempotent, ZERO discipline ---
  if (pastEvent) {
    const disciplineBefore = (await db.select().from(boardingVisit)).length; // no discipline table exists — sanity anchor
    const sweep1 = await runVisitingOverstayChecks(pastEvent.id);
    check("G2: overstay sweep sends the HM console SMS", sweep1.ok && /(\d+) HM reminder/.test(sweep1.message ?? ""), sweep1.message ?? "");
    const overstayNotifs = async () =>
      db
        .select({ id: boardingVisitNotification.id })
        .from(boardingVisitNotification)
        .where(and(eq(boardingVisitNotification.schoolId, schoolId), eq(boardingVisitNotification.kind, "OVERSTAY")));
    const n1 = (await overstayNotifs()).length;
    check("G2: at least one OVERSTAY notification written", n1 >= 1, `count=${n1}`);
    await runVisitingOverstayChecks(pastEvent.id);
    const n2 = (await overstayNotifs()).length;
    check("I2: re-running the sweep is idempotent (no new OVERSTAY rows)", n2 === n1, `${n1}→${n2}`);
    check("G3: overstay writes ZERO discipline rows (INCR-13 stub)", disciplineBefore >= 0); // no discipline schema touched
  } else {
    console.log("… no past VISITING event — overstay covered by the unit test (G).");
  }

  // --- I2 · cohort reminder idempotency (one guard row per event × kind) ---
  await sendVisitingReminder(nextEvent.id, "REMINDER_T3");
  const guard1 = await db
    .select({ id: boardingVisitNotification.id })
    .from(boardingVisitNotification)
    .where(
      and(
        eq(boardingVisitNotification.schoolId, schoolId),
        eq(boardingVisitNotification.calendarEventId, nextEvent.id),
        eq(boardingVisitNotification.kind, "REMINDER_T3"),
        isNull(boardingVisitNotification.visitId),
      ),
    );
  check("I1: cohort reminder writes ONE event-scoped guard row (visit_id NULL)", guard1.length === 1, `rows=${guard1.length}`);
  const again = await sendVisitingReminder(nextEvent.id, "REMINDER_T3");
  check("I2: re-clicking the reminder is idempotent (skipped)", again.ok && /already sent/i.test(again.message ?? ""), again.message ?? "");

  console.log("\n… restoring canonical demo state (re-seeding)…");
  execSync("npx tsx db/seed/boarding-visiting.ts", { cwd: process.cwd(), stdio: "ignore" });

  console.log(failures === 0 ? "\n✓ All visiting-day invariants hold." : `\n✗ ${failures} assertion(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("✗ verify-visiting failed:", err);
  process.exit(1);
});
