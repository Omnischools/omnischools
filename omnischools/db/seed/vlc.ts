import "../_loadenv";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  academicPeriod,
  auditLog,
  classes,
  schools,
  students,
  vlcPeerGuide,
  vlcProgramme,
  vlcSessionTemplate,
  vlcTraining,
  vlcTrainingAbsence,
  vlcValue,
} from "@/db/schema";
import { VLC_CADENCE, VLC_PHASES, VLC_VALUES, vlcSessionCount } from "@/lib/vlc/defaults";
import { classFormNumber, isPeerGuideEligibleForm } from "@/lib/vlc/eligibility";

/**
 * VLC F0 (INCR-40) demo seed for Asankrangwa — the config the setup surface draws: ONE configured
 * programme row (the Wednesday 2:30 PM cadence + the five phase durations) + the canonical 11 values
 * + their 22 session templates, all from lib/vlc/defaults (the frozen source of truth). Nothing
 * operational: no session, no attendance, no journal, no pastoral flag (INCR-41+).
 *
 * MARKER-SCOPED + RE-RUN-SAFE. The three vlc_* tables belong to this module alone, so a school-scoped
 * wipe is safe here in the way a `where schoolId` on a shared table never is (repo memory
 * `seed-cleanup-must-be-scoped`). Cleanup touches ONLY this school's vlc rows; academic_period,
 * classes and everything else are read-only here. Idempotent.
 *
 * `pnpm db:seed-vlc` — run AFTER `pnpm db:seed`.
 */

const GES_CODE = "WR-WAW-014";
const minOf = (field: string) => VLC_PHASES.find((p) => p.field === field)!.defaultMin;

async function main() {
  const [school] = await db
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.gesCode, GES_CODE));
  if (!school) {
    console.error("✗ Asankrangwa not seeded yet — run `pnpm db:seed` first.");
    process.exit(1);
  }
  const schoolId = school.id;

  // ---- 1) Marker-scoped cleanup, child → parent (templates → values → programme). ----
  await db.delete(vlcSessionTemplate).where(eq(vlcSessionTemplate.schoolId, schoolId));
  await db.delete(vlcValue).where(eq(vlcValue.schoolId, schoolId));
  await db.delete(vlcProgramme).where(eq(vlcProgramme.schoolId, schoolId));

  // ---- 2) The programme row — Wednesday 2:30 PM, the 5 default durations, configured. ----
  await db.insert(vlcProgramme).values({
    schoolId,
    sessionDay: VLC_CADENCE.sessionDay,
    sessionStart: VLC_CADENCE.sessionStart,
    openerMin: minOf("openerMin"),
    smallGroupMin: minOf("smallGroupMin"),
    plenaryMin: minOf("plenaryMin"),
    reflectionMin: minOf("reflectionMin"),
    closeMin: minOf("closeMin"),
    configuredAt: new Date(),
  });

  // ---- 3) The 11 values (returning ids), then the 22 templates keyed to them. ----
  const valueRows = await db
    .insert(vlcValue)
    .values(
      VLC_VALUES.map((v) => ({
        schoolId,
        ordinal: v.ordinal,
        nameEn: v.nameEn,
        nameTwi: v.nameTwi,
        termGroup: v.termGroup,
      })),
    )
    .returning({ id: vlcValue.id, ordinal: vlcValue.ordinal });
  const idByOrdinal = new Map(valueRows.map((r) => [r.ordinal, r.id]));

  await db.insert(vlcSessionTemplate).values(
    VLC_VALUES.flatMap((v) =>
      v.sessions.map((s) => ({
        schoolId,
        valueId: idByOrdinal.get(v.ordinal)!,
        slot: s.slot,
        title: s.title,
        prompt: s.prompt,
      })),
    ),
  );

  await db.insert(auditLog).values({
    schoolId,
    actorRole: "ADMIN",
    actionType: "created",
    entityType: "vlc_programme",
    entityId: schoolId,
    afterState: {
      cadence: `${VLC_CADENCE.sessionDay}·${VLC_CADENCE.sessionStart}`,
      values: VLC_VALUES.length,
      sessions: vlcSessionCount(VLC_VALUES),
    },
    reason: "VLC F0 demo seed (INCR-40)",
  });

  console.log(
    `✓ Seeded VLC — Wednesday ${VLC_CADENCE.sessionStart} programme, ${VLC_VALUES.length} values, ` +
      `${vlcSessionCount(VLC_VALUES)} session templates.`,
  );

  // ---- 4) Peer Guides (INCR-41) — a representative roster + two trainings + a couple of absences. ----
  // Marker-scoped + re-run-safe: delete only THIS school's three PG tables, child → parent (absence →
  // training + peer_guide). Everything else (classes, students, academic_period) is read-only here.
  await db.delete(vlcTrainingAbsence).where(eq(vlcTrainingAbsence.schoolId, schoolId));
  await db.delete(vlcTraining).where(eq(vlcTraining.schoolId, schoolId));
  await db.delete(vlcPeerGuide).where(eq(vlcPeerGuide.schoolId, schoolId));

  // The tenure scope — the current SENIOR semester (latest that has begun). No SENIOR period → skip.
  const today = new Date().toISOString().slice(0, 10);
  const periodRows = await db
    .select({
      periodId: academicPeriod.periodId,
      academicYear: academicPeriod.academicYear,
    })
    .from(academicPeriod)
    .where(and(eq(academicPeriod.schoolId, schoolId), eq(academicPeriod.productLine, "SENIOR")))
    .orderBy(desc(academicPeriod.startsOn));
  const period = periodRows[0];

  if (!period) {
    console.log("… no SENIOR academic_period for this school — Peer Guides roster skipped.");
  } else {
    const classRows = await db
      .select({ id: classes.id, name: classes.name, level: classes.level })
      .from(classes)
      .where(eq(classes.schoolId, schoolId));
    const studentRows = await db
      .select({
        id: students.id,
        classId: students.classId,
        sex: students.sex,
      })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.status, "ACTIVE")));

    // Appoint the first boy + first girl of each eligible (F2/F3) class (up to 2). Thin classes yield a
    // single PG — a DERIVED vacancy, exactly the surface's "vacancy open" state (no ballot; OC2).
    const appointments: { studentId: string; classId: string }[] = [];
    for (const c of classRows) {
      if (!isPeerGuideEligibleForm(classFormNumber(c.level, c.name))) continue;
      const inClass = studentRows.filter((s) => s.classId === c.id);
      const boy = inClass.find((s) => s.sex === "MALE");
      const girl = inClass.find((s) => s.sex === "FEMALE");
      for (const s of [boy, girl].filter(Boolean).slice(0, 2)) {
        appointments.push({ studentId: s!.id, classId: c.id });
      }
    }

    const pgRows = appointments.length
      ? await db
          .insert(vlcPeerGuide)
          .values(
            appointments.map((a) => ({
              schoolId,
              studentId: a.studentId,
              classId: a.classId,
              academicPeriodId: period.periodId,
            })),
          )
          .returning({ id: vlcPeerGuide.id })
      : [];

    // Two trainings for the period's academic year — one past (DONE) + one upcoming (NEXT). Dates are
    // demo-fixed within the 2025/26 SHS window; the DONE/NEXT split derives from scheduled_date vs today.
    const trainingRows = await db
      .insert(vlcTraining)
      .values([
        {
          schoolId,
          academicYear: period.academicYear,
          scheduledDate: "2026-06-23",
          title: "Listening · the discipline of holding space",
          description: "Active listening drills · paired exercises · silence as a tool",
          durationMin: 90,
        },
        {
          schoolId,
          academicYear: period.academicYear,
          scheduledDate: "2026-08-30",
          title: "Service projects · planning & running Value 7B",
          description: "Prep for the Patriotism→Service paired session block",
          durationMin: 120,
        },
      ])
      .returning({ id: vlcTraining.id, scheduledDate: vlcTraining.scheduledDate });

    // A couple of absences on the DONE training (present-by-default: a row ONLY for a non-present PG).
    const doneTraining = trainingRows.find((t) => t.scheduledDate < today) ?? trainingRows[0];
    if (doneTraining && pgRows.length) {
      await db
        .insert(vlcTrainingAbsence)
        .values(
          pgRows.slice(0, Math.min(1, pgRows.length)).map((pg) => ({
            schoolId,
            trainingId: doneTraining.id,
            peerGuideId: pg.id,
            excused: true,
            note: "Away on an approved exeat",
          })),
        );
    }

    await db.insert(auditLog).values({
      schoolId,
      actorRole: "ADMIN",
      actionType: "created",
      entityType: "vlc_peer_guide",
      afterState: { peerGuides: pgRows.length, trainings: trainingRows.length },
      reason: "VLC Peer Guides demo seed (INCR-41)",
    });

    console.log(
      `✓ Seeded Peer Guides — ${pgRows.length} appointments, ${trainingRows.length} trainings.`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ VLC seed failed:", err);
    process.exit(1);
  });
