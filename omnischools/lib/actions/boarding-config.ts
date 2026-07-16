"use server";
/**
 * Boarding programme config editing (SHS module 4.2 / INCR-8 · surface 01). Every mutation is
 * gated server-side to BOARDING_SCHOOL_SCOPED_ROLES (ADMIN / HEADMASTER / DEAN_OF_BOARDING) — a
 * plain HOUSEMASTER reads the surface but every write here is rejected (AC H2/H4) — and writes one
 * audit_log row with a before→after snapshot ("audit catches everything" · AC I). No versioning
 * table (Kofi OQ3). NO per-student bunk assignment here (that is F0 / surface 02) and NO SMS or
 * billing write anywhere in INCR-8.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, BOARDING_SCHOOL_SCOPED_ROLES } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import {
  houses,
  boardingSettings,
  boardingDormitory,
  boardingBunk,
  dailyScheduleTemplate,
  boardingCalendarEvent,
} from "@/db/schema";
import { GES_DEFAULT_BOARDING_SETTINGS } from "@/lib/boarding/defaults";

type Result = { ok: boolean; error?: string };
const PROGRAMME_PATH = "/senior/boarding/programme";

/** Shared write gate — returns the school + actor, or an error Result if the role can't write. */
async function authorizeWrite(): Promise<
  { ok: true; schoolId: string; actor: { id: string | null; role: string } } | { ok: false; error: string }
> {
  const { school } = await requireSchool();
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, BOARDING_SCHOOL_SCOPED_ROLES)) {
    return { ok: false, error: "Your role cannot edit the boarding programme." };
  }
  const actor = await resolveActor(school.id);
  return { ok: true, schoolId: school.id, actor };
}

const t = (max: number) => z.string().trim().min(1).max(max);

// ---- 1) Policy cards → boarding_settings (upsert on school_id) ----
const SettingsSchema = z.object({
  exeatScheduledPerTerm: z.coerce.number().int().min(0).max(99),
  exeatReturnBy: t(20),
  exeatFeeOwingMustCollect: z.boolean(),
  exeatSpecialApprover: t(120),
  exeatParentInitiated: z.boolean(),
  exeatDressCode: t(120),
  exeatCardSigner: t(120),
  visitingCadence: t(80),
  visitingHoursStart: t(20),
  visitingHoursEnd: t(20),
  visitingLunchTime: t(20),
  visitingDormitoriesRule: t(80),
  visitingApprovedVisitors: t(120),
  visitingBookOwner: t(120),
  inspectionDailyStart: t(20),
  inspectionDailyEnd: t(20),
  inspectionDailyScope: t(120),
  inspectionWeekly: t(80),
  inspectionWeeklyScope: t(120),
  inspectionScrubbing: t(80),
  inspectionWashingDays: t(80),
  inspectionInspector: t(120),
});

export async function updateBoardingSettings(input: unknown): Promise<Result> {
  const auth = await authorizeWrite();
  if (!auth.ok) return auth;
  const parsed = SettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid settings." };
  }
  const d = parsed.data;
  try {
    await withSchool(auth.schoolId, async (tx) => {
      const [before] = await tx
        .select()
        .from(boardingSettings)
        .where(eq(boardingSettings.schoolId, auth.schoolId))
        .limit(1);
      await tx
        .insert(boardingSettings)
        .values({ schoolId: auth.schoolId, ...d, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: boardingSettings.schoolId,
          set: { ...d, updatedAt: new Date() },
        });
      await recordAudit(tx, {
        schoolId: auth.schoolId,
        actorUserId: auth.actor.id ?? undefined,
        actorRole: auth.actor.role,
        actionType: "updated",
        entityType: "boarding_settings",
        entityId: auth.schoolId,
        before: before ?? GES_DEFAULT_BOARDING_SETTINGS,
        after: d,
        reason: "Boarding policy config updated",
      });
    });
    safeRevalidate(PROGRAMME_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the policy settings." };
  }
}

// ---- 2) Daily-rhythm template → daily_schedule_template (upsert on [school,dayType,formScope]) ----
const BlockSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("section"), label: t(160) }),
  z.object({
    kind: z.literal("activity"),
    range: t(40),
    duration: z.string().trim().max(20).optional(),
    activity: t(160),
    note: z.string().trim().max(200).optional(),
    who: t(80),
  }),
]);
const ScheduleSchema = z.object({
  dayType: z.enum(["WEEKDAY", "SATURDAY", "SUNDAY", "VISITING_SUNDAY"]),
  formScope: t(20),
  activities: z.array(BlockSchema).min(1).max(60),
  active: z.boolean().optional(),
});

export async function upsertScheduleTemplate(input: unknown): Promise<Result> {
  const auth = await authorizeWrite();
  if (!auth.ok) return auth;
  const parsed = ScheduleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid schedule." };
  }
  const { dayType, formScope, activities, active } = parsed.data;
  try {
    await withSchool(auth.schoolId, async (tx) => {
      const [before] = await tx
        .select({ activitiesJson: dailyScheduleTemplate.activitiesJson })
        .from(dailyScheduleTemplate)
        .where(
          and(
            eq(dailyScheduleTemplate.schoolId, auth.schoolId),
            eq(dailyScheduleTemplate.dayType, dayType),
            eq(dailyScheduleTemplate.formScope, formScope),
          ),
        )
        .limit(1);
      await tx
        .insert(dailyScheduleTemplate)
        .values({
          schoolId: auth.schoolId,
          dayType,
          formScope,
          activitiesJson: activities,
          active: active ?? true,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            dailyScheduleTemplate.schoolId,
            dailyScheduleTemplate.dayType,
            dailyScheduleTemplate.formScope,
          ],
          set: { activitiesJson: activities, active: active ?? true, updatedAt: new Date() },
        });
      await recordAudit(tx, {
        schoolId: auth.schoolId,
        actorUserId: auth.actor.id ?? undefined,
        actorRole: auth.actor.role,
        actionType: "updated",
        entityType: "daily_schedule_template",
        entityId: `${dayType}/${formScope}`,
        before: before?.activitiesJson ?? null,
        after: activities,
        reason: `Daily rhythm updated · ${dayType} / ${formScope}`,
      });
    });
    safeRevalidate(PROGRAMME_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the schedule template." };
  }
}

// ---- 3) Calendar events → boarding_calendar_event (VISITING/EXEAT only; create/update/delete) ----
const EventCore = z.object({
  academicYear: t(12),
  eventType: z.enum(["VISITING", "EXEAT_WINDOW"]),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  label: t(160),
  formScope: z.string().trim().max(20).nullish(),
  sequence: z.coerce.number().int().min(1).max(20).nullish(),
});

export async function createCalendarEvent(input: unknown): Promise<Result> {
  const auth = await authorizeWrite();
  if (!auth.ok) return auth;
  const parsed = EventCore.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid event." };
  }
  const d = parsed.data;
  try {
    await withSchool(auth.schoolId, async (tx) => {
      const [row] = await tx
        .insert(boardingCalendarEvent)
        .values({
          schoolId: auth.schoolId,
          academicYear: d.academicYear,
          eventType: d.eventType,
          eventDate: d.eventDate,
          label: d.label,
          formScope: d.formScope ?? null,
          sequence: d.sequence ?? null,
        })
        .returning({ id: boardingCalendarEvent.id });
      await recordAudit(tx, {
        schoolId: auth.schoolId,
        actorUserId: auth.actor.id ?? undefined,
        actorRole: auth.actor.role,
        actionType: "created",
        entityType: "boarding_calendar_event",
        entityId: row?.id,
        after: d,
        reason: `Calendar ${d.eventType} added · ${d.eventDate}`,
      });
    });
    safeRevalidate(PROGRAMME_PATH);
    return { ok: true };
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "23505") {
      return { ok: false, error: "An event of that type already exists on that date." };
    }
    return { ok: false, error: "Could not add the calendar event." };
  }
}

const UpdateEventSchema = EventCore.extend({ id: z.string().uuid() });

export async function updateCalendarEvent(input: unknown): Promise<Result> {
  const auth = await authorizeWrite();
  if (!auth.ok) return auth;
  const parsed = UpdateEventSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid event." };
  }
  const { id, ...d } = parsed.data;
  try {
    const outcome = await withSchool(auth.schoolId, async (tx) => {
      const [before] = await tx
        .select()
        .from(boardingCalendarEvent)
        .where(
          and(
            eq(boardingCalendarEvent.schoolId, auth.schoolId),
            eq(boardingCalendarEvent.id, id),
          ),
        )
        .limit(1);
      if (!before) return { error: "That event no longer exists." };
      await tx
        .update(boardingCalendarEvent)
        .set({
          academicYear: d.academicYear,
          eventType: d.eventType,
          eventDate: d.eventDate,
          label: d.label,
          formScope: d.formScope ?? null,
          sequence: d.sequence ?? null,
        })
        .where(
          and(
            eq(boardingCalendarEvent.schoolId, auth.schoolId),
            eq(boardingCalendarEvent.id, id),
          ),
        );
      await recordAudit(tx, {
        schoolId: auth.schoolId,
        actorUserId: auth.actor.id ?? undefined,
        actorRole: auth.actor.role,
        actionType: "updated",
        entityType: "boarding_calendar_event",
        entityId: id,
        before,
        after: d,
        reason: `Calendar event edited · ${d.eventDate}`,
      });
      return { ok: true as const };
    });
    if ("error" in outcome) return { ok: false, error: outcome.error };
    safeRevalidate(PROGRAMME_PATH);
    return { ok: true };
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "23505") {
      return { ok: false, error: "An event of that type already exists on that date." };
    }
    return { ok: false, error: "Could not update the calendar event." };
  }
}

export async function deleteCalendarEvent(input: unknown): Promise<Result> {
  const auth = await authorizeWrite();
  if (!auth.ok) return auth;
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid event." };
  try {
    await withSchool(auth.schoolId, async (tx) => {
      const [before] = await tx
        .select()
        .from(boardingCalendarEvent)
        .where(
          and(
            eq(boardingCalendarEvent.schoolId, auth.schoolId),
            eq(boardingCalendarEvent.id, parsed.data.id),
          ),
        )
        .limit(1);
      await tx
        .delete(boardingCalendarEvent)
        .where(
          and(
            eq(boardingCalendarEvent.schoolId, auth.schoolId),
            eq(boardingCalendarEvent.id, parsed.data.id),
          ),
        );
      await recordAudit(tx, {
        schoolId: auth.schoolId,
        actorUserId: auth.actor.id ?? undefined,
        actorRole: auth.actor.role,
        actionType: "deleted",
        entityType: "boarding_calendar_event",
        entityId: parsed.data.id,
        before: before ?? null,
        reason: "Calendar event removed",
      });
    });
    safeRevalidate(PROGRAMME_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not remove the calendar event." };
  }
}

// ---- 4) House identity → houses (name/colour/gender/capacity/hm/founded/named) ----
const HOUSE_COLOUR = /^#?[0-9a-fA-F]{6}$/;
const HouseSchema = z.object({
  houseId: z.string().uuid(),
  name: t(60),
  colour: z
    .string()
    .trim()
    .regex(HOUSE_COLOUR, "Colour must be a 6-digit hex, e.g. #B43A2F")
    .nullish(),
  gender: z.enum(["BOYS", "GIRLS", "COED"]).nullish(),
  capacity: z.coerce.number().int().min(0).max(5000).nullish(),
  hmUserId: z.string().uuid().nullish(),
  foundedYear: z.coerce.number().int().min(1800).max(2100).nullish(),
  namedAfter: z.string().trim().max(160).nullish(),
});

export async function updateHouse(input: unknown): Promise<Result> {
  const auth = await authorizeWrite();
  if (!auth.ok) return auth;
  const parsed = HouseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid House details." };
  }
  const { houseId, ...d } = parsed.data;
  const colour = d.colour ? (d.colour.startsWith("#") ? d.colour : `#${d.colour}`) : null;
  try {
    const outcome = await withSchool(auth.schoolId, async (tx) => {
      const [before] = await tx
        .select()
        .from(houses)
        .where(and(eq(houses.schoolId, auth.schoolId), eq(houses.id, houseId)))
        .limit(1);
      if (!before) return { error: "That House no longer exists." };
      await tx
        .update(houses)
        .set({
          name: d.name,
          colour,
          gender: d.gender ?? null,
          capacity: d.capacity ?? null,
          hmUserId: d.hmUserId ?? null,
          foundedYear: d.foundedYear ?? null,
          namedAfter: d.namedAfter ?? null,
        })
        .where(and(eq(houses.schoolId, auth.schoolId), eq(houses.id, houseId)));
      await recordAudit(tx, {
        schoolId: auth.schoolId,
        actorUserId: auth.actor.id ?? undefined,
        actorRole: auth.actor.role,
        actionType: "updated",
        entityType: "house",
        entityId: houseId,
        before,
        after: { ...d, colour },
        reason: `House identity updated · ${d.name}`,
      });
      return { ok: true as const };
    });
    if ("error" in outcome) return { ok: false, error: outcome.error };
    safeRevalidate(PROGRAMME_PATH);
    return { ok: true };
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "23505") {
      return { ok: false, error: "Another House already uses that name." };
    }
    return { ok: false, error: "Could not save the House." };
  }
}

// ---- 5) Provision a dormitory + its bunks (over the 0044 spine; NOT per-student assignment) ----
const DormSchema = z.object({
  houseId: z.string().uuid(),
  name: t(20),
  sectionLabel: z.string().trim().max(60).nullish(),
  bunkCount: z.coerce.number().int().min(1).max(60),
});

export async function addDormitory(input: unknown): Promise<Result> {
  const auth = await authorizeWrite();
  if (!auth.ok) return auth;
  const parsed = DormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid dormitory." };
  }
  const { houseId, name, sectionLabel, bunkCount } = parsed.data;
  try {
    const outcome = await withSchool(auth.schoolId, async (tx) => {
      const [house] = await tx
        .select({ id: houses.id })
        .from(houses)
        .where(and(eq(houses.schoolId, auth.schoolId), eq(houses.id, houseId)))
        .limit(1);
      if (!house) return { error: "That House no longer exists." };
      const [dorm] = await tx
        .insert(boardingDormitory)
        .values({ schoolId: auth.schoolId, houseId, name, sectionLabel: sectionLabel ?? null, bunkCount })
        .returning({ id: boardingDormitory.id });
      await tx.insert(boardingBunk).values(
        Array.from({ length: bunkCount }, (_, i) => ({
          schoolId: auth.schoolId,
          dormitoryId: dorm.id,
          positionNumber: i + 1,
        })),
      );
      await recordAudit(tx, {
        schoolId: auth.schoolId,
        actorUserId: auth.actor.id ?? undefined,
        actorRole: auth.actor.role,
        actionType: "created",
        entityType: "boarding_dormitory",
        entityId: dorm.id,
        after: { houseId, name, sectionLabel: sectionLabel ?? null, bunkCount },
        reason: `Dormitory ${name} provisioned · ${bunkCount} bunks`,
      });
      return { ok: true as const };
    });
    if ("error" in outcome) return { ok: false, error: outcome.error };
    safeRevalidate(PROGRAMME_PATH);
    return { ok: true };
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "23505") {
      return { ok: false, error: "That House already has a dormitory with that name." };
    }
    return { ok: false, error: "Could not provision the dormitory." };
  }
}
