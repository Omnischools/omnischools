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
  vlcPastoralCase,
  vlcPastoralFlag,
  vlcPastoralJournal,
  vlcPastoralNote,
  vlcPastoralObservation,
  vlcPastoralParagraph,
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
  // Marker-scoped + re-run-safe: drop this school's casework FIRST (the case FKs the flag), then the flag.
  // The 43b character paragraph (LEAF, per-student) is dropped too — it is independent of the flag/case.
  await db.delete(vlcPastoralParagraph).where(eq(vlcPastoralParagraph.schoolId, schoolId));
  await db.delete(vlcPastoralCase).where(eq(vlcPastoralCase.schoolId, schoolId));
  await db.delete(vlcPastoralJournal).where(eq(vlcPastoralJournal.schoolId, schoolId));
  await db.delete(vlcPastoralNote).where(eq(vlcPastoralNote.schoolId, schoolId));
  await db.delete(vlcPastoralObservation).where(eq(vlcPastoralObservation.schoolId, schoolId));
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

    // ---- 7) Casework (INCR-43a) — the confidential document the flag points into. On the SAME flag:
    // a few APPEND-ONLY journal entries, ≥2 FM notes (incl. the case-opener), ≥1 PG observation (the PG
    // named as `observed_by` DATA), and ONE editable case summary on the flag (1:1). The FM records it
    // all; there is no student/PG writer. Session-less entries are legal (entry date derives to
    // created_at). All four are REDACTED (`vlc_pastoral_*`). ----
    const at = (iso: string) => new Date(`${iso}T00:00:00Z`);
    await db.insert(vlcPastoralJournal).values([
      {
        schoolId,
        studentId: joseph.id,
        recordedByUserId: fmUserId ?? undefined,
        body: "First session back after the two-session absence. Reflection submitted — twenty-eight words, but submitted. That alone matters more than the words right now.",
        createdAt: at("2026-04-16"),
      },
      {
        schoolId,
        studentId: joseph.id,
        recordedByUserId: fmUserId ?? undefined,
        body: "On Patriotism he wrote about his father's mason work — finishing the row even when no one is watching. Went quiet in plenary, asked to step out, came back.",
        createdAt: at("2026-05-07"),
      },
      {
        schoolId,
        studentId: joseph.id,
        recordedByUserId: fmUserId ?? undefined,
        body: "I want my small words to be the same as my big words. That is discipline I think. Not exercise. Word-keeping.",
        createdAt: at("2026-05-14"),
      },
    ]);
    await db.insert(vlcPastoralNote).values([
      {
        schoolId,
        studentId: joseph.id,
        authorUserId: fmUserId ?? undefined,
        body: "Case opener · bereavement. Mother called yesterday evening — Joseph's father died Saturday 7 Feb. Have notified subject teachers. Family situation also flagged in finance — mother enquiring about boarding-fee concessions for next semester.",
        createdAt: at("2026-02-19"),
      },
      {
        schoolId,
        studentId: joseph.id,
        authorUserId: fmUserId ?? undefined,
        body: "V7B plenary — Akua Gyamfi (PG) flagged him at 3:08 PM during share-back. Joseph became tearful, stepped out, returned. Not crisis level — concern level — but the second flag in three weeks. Considering the Friday Dean check-in.",
        createdAt: at("2026-05-14"),
      },
    ]);
    await db.insert(vlcPastoralObservation).values({
      schoolId,
      studentId: joseph.id,
      observedBy: "Prince Otoo",
      recordedByUserId: fmUserId ?? undefined,
      body: "In small group today Joseph led the conversation about what discipline looks like outside school. Stronger in small group than in plenary — several people built on what he said.",
      createdAt: at("2026-01-22"),
    });
    await db.insert(vlcPastoralCase).values({
      schoolId,
      flagId: flag.id,
      summary:
        "Joseph's father died unexpectedly 7 February 2026. Mother now sole provider. Academic performance steady — no slip in Maths or English. Social engagement returning gradually. VLC engagement is the most sensitive surface — values material (Compassion, Patriotism, Service) is closest to the bone for him right now. Hold the journal lightly. Watch for triggers. He is doing the work.",
      openedAt: at("2026-02-19"),
      lastRevisedAt: at("2026-05-14"),
      lastRevisedByUserId: fmUserId ?? undefined,
    });

    await db.insert(auditLog).values({
      schoolId,
      actorRole: "FORM_MASTER",
      actionType: "created",
      entityType: "vlc_pastoral_case", // REDACTED (vlc_pastoral_* prefix) — metadata only, no bodies
      entityId: flag.id,
      reason: "VLC casework demo seed (INCR-43a)",
    });

    console.log(
      "✓ Seeded VLC casework — 3 journal entries, 2 FM notes, 1 PG observation, 1 case on Joseph Manu. Confidential (REDACTED).",
    );

    // ---- 8) Character paragraph (INCR-43b) — ONE FM-authored school-leaver reference paragraph for Joseph,
    // as a DRAFT (locked_at NULL → editable; the FM may still Edit / Lock it). FM-authored free text, NO
    // machine derivation (owner #6). Per-student (1:1), REDACTED (`vlc_pastoral_*` prefix). This is the ONE
    // VLC element the Headmaster may read — but only once FINALISED, so this draft stays FM+Dean-visible. ----
    await db.insert(vlcPastoralParagraph).values({
      schoolId,
      studentId: joseph.id,
      authorUserId: fmUserId ?? undefined,
      updatedByUserId: fmUserId ?? undefined,
      body:
        "Joseph completed his lower-secondary years at this school with a quiet, dependable steadiness that " +
        "grew more evident as the year went on. He is at his strongest in small-group work, where he listens " +
        "closely and helps others find their footing before offering his own view; classmates build on what " +
        "he says. A family bereavement early in the year tested him, and he carried it with a maturity beyond " +
        "his age — returning to the work rather than retreating from it. He writes plainly and honestly about " +
        "wanting his small words to match his big ones. I would recommend him for a service-project lead role " +
        "in the coming year, subject to his readiness at that point.",
      // locked_at intentionally UNSET → DRAFT.
    });

    await db.insert(auditLog).values({
      schoolId,
      actorRole: "FORM_MASTER",
      actionType: "created",
      entityType: "vlc_pastoral_paragraph", // REDACTED (vlc_pastoral_* prefix) — metadata only, no body
      entityId: joseph.id,
      reason: "VLC character paragraph demo seed (INCR-43b)",
    });

    console.log(
      "✓ Seeded VLC character paragraph — 1 FM-authored draft on Joseph Manu (locked_at NULL). Confidential (REDACTED).",
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ VLC seed failed:", err);
    process.exit(1);
  });
