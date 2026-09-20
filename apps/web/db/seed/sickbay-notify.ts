import "../_loadenv";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  houses,
  notificationLog,
  schools,
  sickbayNotification,
  sickbayReferral,
  sickbayVisit,
  students,
} from "@/db/schema";
import {
  housemasterNotificationBody,
  parentAdmissionConfirmBody,
  parentReferralConfirmBody,
} from "@/lib/sickbay/notify";

/**
 * Sickbay NOTIFY demo seed (SHS module 4.4 / INCR-26). Populates the §02 referral parent-comms thread
 * and the §05 visit comms fan-out for whatever referral + admission visit already exist for
 * Asankrangwa — the base seed ships no clinical spine, so this ATTACHES to live anchors and NO-OPS
 * cleanly when none exist (create a referral / admit a visit in the app first, then re-run).
 *
 * 🔴 MARKER-SCOPED + RE-RUN-SAFE (repo memory `seed-cleanup-must-be-scoped`). Cleanup touches ONLY:
 *   • sickbay_notification rows with `created_by_user_id IS NULL` for this school — a LIVE send ALWAYS
 *     attributes the acting matron, so a null actor is uniquely this seed's;
 *   • notification_log rows with `provider = 'seed'` for this school.
 * It never broad-deletes by school_id alone on a shared table.
 *
 * 🔴 CONSOLE HONESTY: a LIVE send is QUEUED/console. This seed ALSO stages `provider='seed'` log rows
 * carrying SENT/FAILED — the ONLY place those statuses appear — to exercise the §03 delivery visuals
 * of the FUTURE Hubtel dispatch (F-F), never asserting a real console delivery.
 *
 * §03 is a TODAY view: seed rows are dated `now`, so they render on the timeline the day you seed.
 *
 * `pnpm tsx db/seed/sickbay-notify.ts`   (run AFTER `pnpm db:seed` + a referral/admission exists)
 */
const GES_CODE = "WR-WAW-014";

async function main() {
  const [school] = await db.select({ id: schools.id }).from(schools).where(eq(schools.gesCode, GES_CODE));
  if (!school) {
    console.error("✗ Asankrangwa not seeded yet — run `pnpm db:seed` first.");
    process.exit(1);
  }
  const schoolId = school.id;
  const sName = "Asankrangwa SHS";

  // ---- Marker-scoped cleanup (system-null-actor notifications + seed-provider logs). ----
  await db
    .delete(sickbayNotification)
    .where(and(eq(sickbayNotification.schoolId, schoolId), isNull(sickbayNotification.createdByUserId)));
  await db
    .delete(notificationLog)
    .where(and(eq(notificationLog.schoolId, schoolId), eq(notificationLog.provider, "seed")));

  const now = Date.now();
  const at = (minsAgo: number) => new Date(now - minsAgo * 60_000);

  // A seed notification_log row (the future-dispatch visual — SENT/FAILED, never on a LIVE console row).
  const seedLog = async (studentId: string, message: string, status: "SENT" | "FAILED" | "QUEUED") => {
    const [row] = await db
      .insert(notificationLog)
      .values({ schoolId, studentId, phone: "", message, status, provider: "seed" })
      .returning({ id: notificationLog.id });
    return row.id;
  };

  // ---- §02 thread + §03 tier-3 row — the first non-voided referral. ----
  const [ref] = await db
    .select({
      id: sickbayReferral.id,
      studentId: sickbayReferral.studentId,
      visitId: sickbayReferral.visitId,
      hospitalId: sickbayReferral.hospitalId,
    })
    .from(sickbayReferral)
    .where(and(eq(sickbayReferral.schoolId, schoolId), isNull(sickbayReferral.voidedAt)))
    .limit(1);

  let threadCount = 0;
  if (ref) {
    const ctx = await studentCtx(schoolId, ref.studentId);
    const confirmBody = parentReferralConfirmBody(ctx.shortName, sName, "Asankrangwa Government Hospital");
    const confirmLog = await seedLog(ref.studentId, confirmBody, "SENT"); // §03 delivery visual (F-F)
    const wardBody = `Update: ${ctx.shortName} admitted to the ward, IV started, fever coming down. — Matron`;
    const wardLog = await seedLog(ref.studentId, wardBody, "SENT");

    const base = {
      schoolId,
      studentId: ref.studentId,
      visitId: ref.visitId,
      referralId: ref.id,
      tier: 3 as const,
      recipient: "PARENT" as const,
      createdByUserId: null,
    };
    await db.insert(sickbayNotification).values([
      {
        ...base,
        channel: "CALL",
        direction: "OUTBOUND",
        triggerLabel: "referral",
        body: "Told the parent about the referral and that the Matron is accompanying. Reassured no need to rush from work — will update at every reassessment.",
        privateNote: "Mother sounded shaken but accepted. Told her visiting hours from 17:00 if she wanted, no need before.",
        answered: true,
        callDurationSeconds: 252,
        sentAt: at(520),
      },
      {
        ...base,
        channel: "SMS",
        direction: "OUTBOUND",
        triggerLabel: "auto",
        body: confirmBody,
        notificationLogId: confirmLog,
        sentAt: at(518),
      },
      {
        ...base,
        channel: "CALL",
        direction: "OUTBOUND",
        triggerLabel: "attempted",
        body: "Wanted to confirm the SMS arrived and admission was complete. Will retry.",
        answered: false,
        sentAt: at(480),
      },
      {
        ...base,
        channel: "CALL",
        direction: "INBOUND",
        triggerLabel: "parent-initiated",
        body: "She'd seen the SMS. Confirmed the NHIS card was being used at the ER. Reassured her.",
        privateNote: "Also asked how she was emotionally. Told her: scared but composed.",
        answered: true,
        callDurationSeconds: 364,
        sentAt: at(435),
      },
      {
        ...base,
        channel: "SMS",
        direction: "OUTBOUND",
        triggerLabel: "update",
        body: wardBody,
        notificationLogId: wardLog,
        sentAt: at(270),
      },
      {
        // The scheduled DUE row (§03 `.future` / §5 render-on-read; the matron sends it manually).
        ...base,
        channel: "SMS",
        direction: "OUTBOUND",
        triggerLabel: "scheduled",
        body: "Evening status update — improving overnight, reassess at 08:00.",
        scheduledFor: at(-90), // 90 min in the FUTURE relative to seed time → renders DUE later today
      },
    ]);
    threadCount = 6;
  }

  // ---- §05 fan-out — the first admission visit (tier-2 parent + HM). ----
  const [adm] = await db
    .select({ id: sickbayVisit.id, studentId: sickbayVisit.studentId })
    .from(sickbayVisit)
    .where(and(eq(sickbayVisit.schoolId, schoolId), eq(sickbayVisit.disposition, "ADMIT"), isNull(sickbayVisit.voidedAt)))
    .limit(1);

  let fanoutCount = 0;
  if (adm) {
    const ctx = await studentCtx(schoolId, adm.studentId);
    const parentBody = parentAdmissionConfirmBody(ctx.shortName, sName);
    const parentLog = await seedLog(adm.studentId, parentBody, "SENT");
    const base = {
      schoolId,
      studentId: adm.studentId,
      visitId: adm.id,
      referralId: null,
      tier: 2 as const,
      createdByUserId: null,
    };
    await db.insert(sickbayNotification).values([
      {
        ...base,
        channel: "CALL",
        direction: "OUTBOUND",
        recipient: "PARENT",
        triggerLabel: "admission",
        body: `${ctx.shortName} is admitted to the sickbay and comfortable. We are following the standing care plan. Please call back any time.`,
        answered: true,
        callDurationSeconds: 192,
        sentAt: at(300),
      },
      {
        ...base,
        channel: "SMS",
        direction: "OUTBOUND",
        recipient: "PARENT",
        triggerLabel: "admission",
        body: parentBody,
        notificationLogId: parentLog,
        sentAt: at(299),
      },
      {
        // 🔴 the HM awareness row — the FIXED medical-detail-light template, no condition.
        ...base,
        channel: "IN_APP",
        direction: "OUTBOUND",
        recipient: "HOUSEMASTER",
        triggerLabel: "hm-awareness",
        body: housemasterNotificationBody(ctx.shortName, ctx.houseName),
        answered: true,
        sentAt: at(297),
      },
    ]);
    fanoutCount = 3;
  }

  if (threadCount === 0 && fanoutCount === 0) {
    console.log(
      "• No referral or admission visit exists for Asankrangwa yet — nothing to attach. Create a referral / admit a visit in the app, then re-run.",
    );
  } else {
    console.log(`✓ Sickbay notify seed: ${threadCount} thread row(s) + ${fanoutCount} §05 fan-out row(s).`);
  }
  process.exit(0);
}

async function studentCtx(schoolId: string, studentId: string): Promise<{ shortName: string; houseName: string | null }> {
  const [s] = await db
    .select({ firstName: students.firstName, lastName: students.lastName, houseName: houses.name })
    .from(students)
    .leftJoin(houses, and(eq(houses.schoolId, schoolId), eq(houses.id, students.houseId)))
    .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)))
    .limit(1);
  return { shortName: s ? `${s.firstName.charAt(0)}. ${s.lastName}` : "the student", houseName: s?.houseName ?? null };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
