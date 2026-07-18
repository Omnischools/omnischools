import "../_loadenv";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  schools,
  students,
  users,
  auditLog,
  academicPeriod,
  boardingCalendarEvent,
  boardingApprovedVisitor,
  boardingVisit,
  boardingVisitNotification,
} from "@/db/schema";

/**
 * Boarding visiting-day (INCR-12) demo seed for Asankrangwa — a coherent "visiting Sunday setup" for the
 * digital Visitor's Book (surface 06). Marker-scoped + re-run-safe: bounded to a demo student set + the
 * resolved VISITING events (tables nothing else populates in dev), it deletes those rows then re-inserts.
 *
 * Demonstrates every AC trap on one screen:
 *   • J. Manu — pastoral-active, Dean-approved 5-of-6 approved visitors (the pastoral row highlight,
 *     DISTINCT from a security flag), RSVP for his mother → VERIFIED, allocated the library quad.
 *   • Efua — a PENDING_REVIEW cousin (list not yet approved) → her RSVP reads "+1 NEEDS REVIEW" (gold),
 *     the list-match affordance that opens the editor.
 *   • Kojo — a walk-in NOT on the list → FLAGGED (never turned away; needs an HM authorise to admit).
 *   • VERIFIED RSVPs across four Houses (J. Manu / Kofi / Abena / Samuel) for the RSVP-by-House counters.
 *   • A past FORMS_1_2 event carries an ARRIVED-not-departed visit → reads as overstaying on-read, so the
 *     overstay sweep (console SMS, no discipline) is demonstrable at ?date=<past event>.
 *
 * Run AFTER db:seed + db:seed-boarding. `pnpm db:seed-visiting`.
 */

const HM_PHONE = "+233244000004";

async function main() {
  const [school] = await db.select({ id: schools.id }).from(schools).where(eq(schools.gesCode, "WR-WAW-014"));
  if (!school) {
    console.error("✗ Asankrangwa not seeded — run `pnpm db:seed` first.");
    process.exit(1);
  }
  const schoolId = school.id;

  // Resolve the current SENIOR academic year (mirrors lib/boarding/period.getCurrentPeriod).
  const todayIso = new Date().toISOString().slice(0, 10);
  const periods = await db
    .select({ academicYear: academicPeriod.academicYear, startsOn: academicPeriod.startsOn })
    .from(academicPeriod)
    .where(and(eq(academicPeriod.schoolId, schoolId), eq(academicPeriod.productLine, "SENIOR")))
    .orderBy(desc(academicPeriod.startsOn));
  if (periods.length === 0) {
    console.error("✗ No SENIOR academic period — run `pnpm db:seed` first.");
    process.exit(1);
  }
  const academicYear =
    (periods.find((p) => p.startsOn <= todayIso) ?? periods[periods.length - 1]).academicYear;

  // VISITING events for the year. Default event = next upcoming (matches the board default); overstay
  // event = the most recent PAST one (an ARRIVED-not-departed visit there reads as overstaying now).
  const visitingEvents = await db
    .select({ id: boardingCalendarEvent.id, eventDate: boardingCalendarEvent.eventDate, formScope: boardingCalendarEvent.formScope })
    .from(boardingCalendarEvent)
    .where(
      and(
        eq(boardingCalendarEvent.schoolId, schoolId),
        eq(boardingCalendarEvent.academicYear, academicYear),
        eq(boardingCalendarEvent.eventType, "VISITING"),
      ),
    )
    .orderBy(boardingCalendarEvent.eventDate);
  if (visitingEvents.length === 0) {
    console.error("✗ No VISITING calendar event — run `pnpm db:seed-boarding` (INCR-8 config) first.");
    process.exit(1);
  }
  const nextEvent = visitingEvents.find((e) => e.eventDate >= todayIso) ?? visitingEvents[visitingEvents.length - 1];
  const pastEvent = [...visitingEvents].reverse().find((e) => e.eventDate < todayIso) ?? null;
  const eventIds = [nextEvent.id, ...(pastEvent ? [pastEvent.id] : [])];

  const [hm] = await db.select({ id: users.id }).from(users).where(eq(users.phone, HM_PHONE));
  const staffId = hm?.id ?? null;

  // Demo boarders (F0 spine — coherent with the roster + the resumption cameo).
  const codes = [
    "ASK-24-0118", // J. Manu · Aggrey · pastoral, 5 approved
    "ASK-BRD-AGG-01", // Samuel · Aggrey · father approved
    "ASK-BRD-AGG-02", // Kojo · Aggrey · the flagged walk-in
    "ASK-24-0149", // Kofi · Guggisberg · mother approved
    "ASK-24-0146", // Efua · Kingsley · aunt approved + cousin pending
    "ASK-24-0142", // Abena · Slessor · mother approved
  ];
  const rows = await db
    .select({ id: students.id, houseId: students.houseId, code: students.studentCode })
    .from(students)
    .where(and(eq(students.schoolId, schoolId), inArray(students.studentCode, codes)));
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const stu = (code: string) => byCode.get(code);
  const studentIds = rows.map((r) => r.id);

  // --- Re-run-safe cleanup (marker-scoped to the demo events + demo students) ---
  if (eventIds.length) {
    await db
      .delete(boardingVisitNotification)
      .where(and(eq(boardingVisitNotification.schoolId, schoolId), inArray(boardingVisitNotification.calendarEventId, eventIds)));
    // Deleting the visits cascades their visit-scoped notifications (ARRIVAL_CONFIRM/OVERSTAY).
    await db
      .delete(boardingVisit)
      .where(and(eq(boardingVisit.schoolId, schoolId), inArray(boardingVisit.calendarEventId, eventIds)));
  }
  if (studentIds.length) {
    await db
      .delete(boardingApprovedVisitor)
      .where(and(eq(boardingApprovedVisitor.schoolId, schoolId), inArray(boardingApprovedVisitor.studentId, studentIds)));
  }

  // --- Approved-visitor lists (per student) ---
  type AV = typeof boardingApprovedVisitor.$inferInsert;
  const av = (
    code: string,
    name: string,
    relationship: string,
    status: "APPROVED" | "PENDING_REVIEW",
    opts: { phone?: string; idHint?: string; pastoral?: boolean } = {},
  ): AV | null => {
    const s = stu(code);
    if (!s) return null;
    return {
      schoolId,
      studentId: s.id,
      name,
      relationship,
      phone: opts.phone ?? null,
      idHint: opts.idHint ?? null,
      status,
      pastoralReview: opts.pastoral ?? false,
      addedByUserId: staffId ?? undefined,
      approvedByUserId: status === "APPROVED" ? staffId ?? undefined : undefined,
      approvedAt: status === "APPROVED" ? new Date() : null,
    };
  };
  const approvedRows = [
    // J. Manu — pastoral, Dean-reviewed 5-of-6 (surface verbatim).
    av("ASK-24-0118", "Mrs Esi Manu", "Mother", "APPROVED", { phone: "+233244000091", idHint: "Ghana Card" }),
    av("ASK-24-0118", "Mr Daniel Manu", "Grandfather (paternal)", "APPROVED", { pastoral: true, idHint: "NHIS" }),
    av("ASK-24-0118", "Margaret Manu", "Sister", "APPROVED", { pastoral: true }),
    av("ASK-24-0118", "Mrs A. Boateng", "Aunt (maternal)", "APPROVED", {}),
    av("ASK-24-0118", "Pastor R. Boamah", "Family pastor", "APPROVED", {}),
    // Samuel — father.
    av("ASK-BRD-AGG-01", "Mr E. Owusu", "Father", "APPROVED", { phone: "+233201112233", idHint: "Ghana Card" }),
    // Kofi — mother.
    av("ASK-24-0149", "Mrs A. Asare", "Mother", "APPROVED", { phone: "+233209988776" }),
    // Efua — aunt approved + cousin PENDING (the "+1 NEEDS REVIEW" case).
    av("ASK-24-0146", "Aunt R. Mensah", "Aunt", "APPROVED", {}),
    av("ASK-24-0146", "Felix Mensah", "Cousin", "PENDING_REVIEW", { idHint: "student ID" }),
    // Abena — mother.
    av("ASK-24-0142", "Mrs G. Adjei", "Mother", "APPROVED", { phone: "+233244778899" }),
  ].filter((r): r is AV => r !== null);

  const inserted = approvedRows.length
    ? await db
        .insert(boardingApprovedVisitor)
        .values(approvedRows)
        .returning({ id: boardingApprovedVisitor.id, studentId: boardingApprovedVisitor.studentId, name: boardingApprovedVisitor.name })
    : [];
  const avId = (code: string, name: string): string | null => {
    const s = stu(code);
    if (!s) return null;
    return inserted.find((r) => r.studentId === s.id && r.name === name)?.id ?? null;
  };

  // --- Visits (indicated arrivals + the live/overstay demos) ---
  type Visit = typeof boardingVisit.$inferInsert;
  const visits: Visit[] = [];
  const rsvp = (
    code: string,
    visitorName: string,
    relationship: string,
    verification: "VERIFIED" | "FLAGGED",
    eventId: string,
    opts: { approvedName?: string; phone?: string; zoneKey?: string } = {},
  ) => {
    const s = stu(code);
    if (!s || !s.houseId) return;
    visits.push({
      schoolId,
      studentId: s.id,
      houseId: s.houseId,
      calendarEventId: eventId,
      approvedVisitorId: opts.approvedName ? avId(code, opts.approvedName) : null,
      visitorName,
      visitorPhone: opts.phone ?? null,
      relationship,
      status: "RSVP",
      verification,
      zoneKey: opts.zoneKey ?? null,
      rsvpByUserId: staffId ?? undefined,
    });
  };
  const arrived = (
    code: string,
    visitorName: string,
    relationship: string,
    verification: "VERIFIED" | "FLAGGED",
    eventId: string,
    opts: { approvedName?: string; departed?: boolean; zoneKey?: string; hoursIso?: string } = {},
  ) => {
    const s = stu(code);
    if (!s || !s.houseId) return;
    const at = opts.hoursIso ? new Date(opts.hoursIso) : new Date();
    visits.push({
      schoolId,
      studentId: s.id,
      houseId: s.houseId,
      calendarEventId: eventId,
      approvedVisitorId: opts.approvedName ? avId(code, opts.approvedName) : null,
      visitorName,
      relationship,
      status: opts.departed ? "DEPARTED" : "ARRIVED",
      verification,
      zoneKey: opts.zoneKey ?? null,
      rsvpByUserId: staffId ?? undefined,
      arrivedAt: at,
      arrivedByUserId: staffId ?? undefined,
      departedAt: opts.departed ? new Date(at.getTime() + 2 * 3600_000) : null,
      departedByUserId: opts.departed ? staffId ?? undefined : undefined,
    });
  };

  const nextId = nextEvent.id;
  // Default (upcoming) event — pre-arrival RSVPs across Houses.
  rsvp("ASK-24-0118", "Mrs Esi Manu", "Mother", "VERIFIED", nextId, { approvedName: "Mrs Esi Manu", phone: "+233244000091", zoneKey: "library_quad" });
  rsvp("ASK-BRD-AGG-01", "Mr E. Owusu", "Father", "VERIFIED", nextId, { approvedName: "Mr E. Owusu", zoneKey: "main_lawn" });
  rsvp("ASK-24-0149", "Mrs A. Asare", "Mother", "VERIFIED", nextId, { approvedName: "Mrs A. Asare", zoneKey: "main_lawn" });
  rsvp("ASK-24-0142", "Mrs G. Adjei", "Mother", "VERIFIED", nextId, { approvedName: "Mrs G. Adjei" });
  // Efua — RSVP for the PENDING cousin → FLAGGED → "+1 NEEDS REVIEW".
  rsvp("ASK-24-0146", "Felix Mensah", "Cousin", "FLAGGED", nextId, { approvedName: "Felix Mensah" });
  // Kojo — a walk-in NOT on the list → FLAGGED, arrived (needs HM authorise).
  arrived("ASK-BRD-AGG-02", "Mr K. Danso", "Family friend", "FLAGGED", nextId, { zoneKey: "dining_annex" });

  // Past FORMS_1_2 event — an ARRIVED-not-departed visit reads as overstaying on-read (overstay demo),
  // plus one complete two-stamp (arrived → departed) so the depart path is visible.
  if (pastEvent) {
    arrived("ASK-24-0118", "Mrs Esi Manu", "Mother", "VERIFIED", pastEvent.id, {
      approvedName: "Mrs Esi Manu",
      zoneKey: "library_quad",
      hoursIso: `${pastEvent.eventDate}T13:00:00Z`,
    });
    arrived("ASK-BRD-AGG-01", "Mr E. Owusu", "Father", "VERIFIED", pastEvent.id, {
      approvedName: "Mr E. Owusu",
      departed: true,
      zoneKey: "main_lawn",
      hoursIso: `${pastEvent.eventDate}T12:30:00Z`,
    });
  }

  if (visits.length) await db.insert(boardingVisit).values(visits);

  await db.insert(auditLog).values({
    schoolId,
    actorUserId: staffId ?? undefined,
    actorRole: "HOUSEMASTER",
    actionType: "created",
    entityType: "boarding_visiting_seed",
    entityId: schoolId,
    afterState: {
      nextEvent: nextEvent.eventDate,
      pastEvent: pastEvent?.eventDate ?? null,
      approvedVisitors: inserted.length,
      visits: visits.length,
      pastoral: "ASK-24-0118",
      needsReview: "ASK-24-0146 (cousin pending)",
      flaggedWalkIn: "ASK-BRD-AGG-02",
    },
    reason: "Boarding visiting-day (INCR-12) demo seed — RSVPs across Houses, J. Manu pastoral 5-of-6, a pending cousin, a flagged walk-in, an overstay-capable past event",
  });

  console.log(
    `✓ Visiting seed — ${inserted.length} approved visitors, ${visits.length} visits ` +
      `(J. Manu pastoral/VERIFIED, Efua cousin +1 NEEDS REVIEW, Kojo flagged walk-in), ` +
      `default event ${nextEvent.eventDate}${pastEvent ? `, overstay demo at ?date=${pastEvent.eventDate}` : ""}.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ Visiting seed failed:", err);
    process.exit(1);
  });
