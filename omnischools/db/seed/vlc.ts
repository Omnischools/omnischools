import "../_loadenv";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  academicPeriod,
  auditLog,
  classes,
  roleAssignments,
  roles,
  schools,
  students,
  users,
  vlcPastoralFlag,
  vlcPeerGuide,
  vlcProgramme,
  vlcSession,
  vlcSessionAttendance,
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

  // ---- 5) Session register (INCR-42a) — one demo held session + a few P/L/A rows. ----
  // Marker-scoped + re-run-safe: delete only THIS school's two new tables, child → parent
  // (attendance → session). Sessions are FM-created (not provisioned at signup), so this is demo data
  // only — present-by-default, so a row exists ONLY for a LATE/ABSENT student.
  await db.delete(vlcSessionAttendance).where(eq(vlcSessionAttendance.schoolId, schoolId));
  await db.delete(vlcSession).where(eq(vlcSession.schoolId, schoolId));

  // The value/session to run: Value 7 (Patriotism) slot B — the surface's Service-project session — else
  // any active template. The class: the first senior-form class that has students + a Form Master.
  const [tpl] = await db
    .select({ id: vlcSessionTemplate.id })
    .from(vlcSessionTemplate)
    .innerJoin(vlcValue, and(eq(vlcValue.schoolId, vlcSessionTemplate.schoolId), eq(vlcValue.id, vlcSessionTemplate.valueId)))
    .where(and(eq(vlcSessionTemplate.schoolId, schoolId), eq(vlcValue.ordinal, 7), eq(vlcSessionTemplate.slot, "B")))
    .limit(1);
  const [anyTpl] = tpl
    ? [tpl]
    : await db
        .select({ id: vlcSessionTemplate.id })
        .from(vlcSessionTemplate)
        .where(eq(vlcSessionTemplate.schoolId, schoolId))
        .limit(1);

  const sessionClassRows = await db
    .select({ id: classes.id, name: classes.name, level: classes.level, ct: classes.classTeacherUserId })
    .from(classes)
    .where(eq(classes.schoolId, schoolId));
  const sessionStudents = await db
    .select({ id: students.id, classId: students.classId })
    .from(students)
    .where(and(eq(students.schoolId, schoolId), eq(students.status, "ACTIVE")));
  const targetClass = sessionClassRows.find(
    (c) => classFormNumber(c.level, c.name) !== null && sessionStudents.some((s) => s.classId === c.id),
  );

  if (anyTpl && targetClass) {
    const today = new Date().toISOString().slice(0, 10);
    const [session] = await db
      .insert(vlcSession)
      .values({
        schoolId,
        classId: targetClass.id,
        sessionTemplateId: anyTpl.id,
        sessionDate: today,
        heldByUserId: targetClass.ct ?? undefined,
      })
      .returning({ id: vlcSession.id });
    // Present-by-default: mark the first 2 in-class students LATE + the next 4 ABSENT (the rest present).
    const inClass = sessionStudents.filter((s) => s.classId === targetClass.id);
    const rows = [
      ...inClass.slice(0, 2).map((s) => ({ studentId: s.id, status: "LATE" as const, minutesLate: 5 })),
      ...inClass.slice(2, 6).map((s) => ({ studentId: s.id, status: "ABSENT" as const, minutesLate: null })),
    ];
    if (rows.length) {
      await db.insert(vlcSessionAttendance).values(
        rows.map((r) => ({
          schoolId,
          sessionId: session.id,
          studentId: r.studentId,
          status: r.status,
          minutesLate: r.minutesLate ?? undefined,
        })),
      );
    }
    await db.insert(auditLog).values({
      schoolId,
      actorRole: "ADMIN",
      actionType: "created",
      entityType: "vlc_session",
      entityId: session.id,
      afterState: { classId: targetClass.id, sessionDate: today, notPresentRows: rows.length },
      reason: "VLC session register demo seed (INCR-42a)",
    });
    console.log(
      `✓ Seeded VLC session — ${targetClass.name} on ${today}, ${rows.length} not-present rows (present-by-default).`,
    );
  } else {
    console.log("… no eligible class with students / no session template — VLC session skipped.");
  }

  // ---- 6) Pastoral flag (INCR-42b) — the module's FIRST CONFIDENTIAL row. EXACTLY ONE active flag on
  // Joseph Manu (ASK-24-0118, Form 2 GA A): CONCERN, context "Group B plenary share-back", surfaced_by
  // "Akua Gyamfi (PG)" (a DISPLAY attribution — the PG never writes), raised_by the class's Form Master
  // (the recorder). Marker-scoped + re-run-safe: delete only THIS school's flags first. No other student
  // is flagged. The seed audit row is the REDACTED `vlc_pastoral_flag` entity (metadata only).
  await db.delete(vlcPastoralFlag).where(eq(vlcPastoralFlag.schoolId, schoolId));

  const [joseph] = await db
    .select({ id: students.id, classId: students.classId })
    .from(students)
    .where(and(eq(students.schoolId, schoolId), eq(students.studentCode, "ASK-24-0118")))
    .limit(1);

  if (!joseph?.classId) {
    console.log("… Joseph Manu (ASK-24-0118) not seeded — pastoral flag skipped.");
  } else {
    // The surface's FM for Joseph is Mr A. Mensah, but the base roster left Form 2 GA A's class_teacher
    // unset. Pin it to the FORM_MASTER holder when it is null (targeted + idempotent) so the OWN-CLASS read
    // gate resolves to a real FM — the demo round-trip (a gated FM sees the callout) depends on it. That
    // teacher is the flag's raised_by. A Dean sees it school-wide regardless.
    const [cls] = await db
      .select({ ct: classes.classTeacherUserId })
      .from(classes)
      .where(and(eq(classes.schoolId, schoolId), eq(classes.id, joseph.classId)))
      .limit(1);
    let fmUserId = cls?.ct ?? null;
    if (!fmUserId) {
      const [fm] = await db
        .select({ id: users.id })
        .from(roleAssignments)
        .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
        .innerJoin(users, eq(roleAssignments.userId, users.id))
        .where(and(eq(roleAssignments.schoolId, schoolId), eq(roles.code, "FORM_MASTER")))
        .limit(1);
      fmUserId = fm?.id ?? null;
      if (fmUserId) {
        await db
          .update(classes)
          .set({ classTeacherUserId: fmUserId })
          .where(and(eq(classes.schoolId, schoolId), eq(classes.id, joseph.classId)));
      }
    }

    const [flag] = await db
      .insert(vlcPastoralFlag)
      .values({
        schoolId,
        studentId: joseph.id,
        severity: "CONCERN",
        context: "Group B plenary share-back",
        surfacedBy: "Akua Gyamfi (PG)",
        raisedByUserId: fmUserId ?? undefined,
      })
      .returning({ id: vlcPastoralFlag.id });

    await db.insert(auditLog).values({
      schoolId,
      actorRole: "FORM_MASTER",
      actionType: "raised",
      entityType: "vlc_pastoral_flag",
      entityId: flag.id,
      reason: "Pastoral flag raised", // REDACTED — metadata only, no context/severity/surfaced_by
    });

    console.log(
      "✓ Seeded VLC pastoral flag — Joseph Manu (CONCERN), surfaced by a PG. Confidential (REDACTED).",
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ VLC seed failed:", err);
    process.exit(1);
  });
