"use server";
/**
 * Basic SPORTS-house CRUD (OC-295-A · /settings/houses). A sports house is the Basic-school
 * analogue of the SHS boarding house — pupils are grouped into Houses for sports/athletics. It
 * lives in the SAME `houses` table, discriminated by `kind='SPORTS'`; every all-house boarding
 * read is fenced to `kind='BOARDING'` so the two never mix in a COMBINED school.
 *
 * Every mutation here is gated server-side to SPORTS_HOUSE_WRITE_ROLES (ADMIN / HEADMASTER) — a
 * hand-crafted POST from any other role is refused — and writes one audit_log row. `kind` is set
 * to 'SPORTS' on create and is NEVER accepted or written on edit (immutable). Every write is
 * additionally scoped to `kind='SPORTS'` so this surface can never rename/archive a boarding house.
 * Archive is a SOFT delete (`active=false`) — a hard delete would SET NULL every pupil's house_id
 * (students.house_id is ON DELETE SET NULL), silently detaching them.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool, isUniqueViolation } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SPORTS_HOUSE_WRITE_ROLES } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import { houses } from "@/db/schema";

type Result = { ok: boolean; error?: string; id?: string };
const HOUSES_PATH = "/settings/houses";

// Same 6-hex rule as the boarding House-identity editor (with or without a leading #).
const HOUSE_COLOUR = /^#?[0-9a-fA-F]{6}$/;
const NameSchema = z.string().trim().min(1, "Enter a house name").max(60);
const ColourSchema = z
  .string()
  .trim()
  .regex(HOUSE_COLOUR, "Colour must be a 6-digit hex, e.g. #B43A2F")
  .nullish();

const normColour = (c: string | null | undefined) =>
  c ? (c.startsWith("#") ? c : `#${c}`) : null;

/** Shared write gate — management only (ADMIN / HEADMASTER), else an error Result. */
async function authorizeWrite(): Promise<
  { ok: true; schoolId: string; actor: { id: string | null; role: string } } | { ok: false; error: string }
> {
  const { school } = await requireSchool();
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, SPORTS_HOUSE_WRITE_ROLES)) {
    return { ok: false, error: "Your role cannot manage sports houses." };
  }
  const actor = await resolveActor(school.id);
  return { ok: true, schoolId: school.id, actor };
}

const CreateSchema = z.object({ name: NameSchema, colour: ColourSchema });

export async function createSportsHouse(input: unknown): Promise<Result> {
  const auth = await authorizeWrite();
  if (!auth.ok) return auth;
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid house details." };
  }
  const name = parsed.data.name;
  const colour = normColour(parsed.data.colour);
  try {
    const id = await withSchool(auth.schoolId, async (tx) => {
      const [row] = await tx
        .insert(houses)
        .values({ schoolId: auth.schoolId, name, colour, kind: "SPORTS" })
        .returning({ id: houses.id });
      await recordAudit(tx, {
        schoolId: auth.schoolId,
        actorUserId: auth.actor.id ?? undefined,
        actorRole: auth.actor.role,
        actionType: "created",
        entityType: "house",
        entityId: row.id,
        after: { name, colour, kind: "SPORTS" },
        reason: `Sports house created · ${name}`,
      });
      return row.id;
    });
    safeRevalidate(HOUSES_PATH);
    return { ok: true, id };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, error: "Another house already uses that name." };
    }
    return { ok: false, error: "Could not create the sports house." };
  }
}

// kind is deliberately NOT in this schema — it is immutable and never accepted on edit.
const UpdateSchema = z.object({
  houseId: z.string().uuid(),
  name: NameSchema,
  colour: ColourSchema,
});

export async function updateSportsHouse(input: unknown): Promise<Result> {
  const auth = await authorizeWrite();
  if (!auth.ok) return auth;
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid house details." };
  }
  const { houseId, name } = parsed.data;
  const colour = normColour(parsed.data.colour);
  try {
    const outcome = await withSchool(auth.schoolId, async (tx) => {
      // Scope BOTH the read and the write to kind='SPORTS' — a boarding house id can never be
      // edited from this surface, and `kind` itself is never in the SET.
      const [before] = await tx
        .select()
        .from(houses)
        .where(
          and(
            eq(houses.schoolId, auth.schoolId),
            eq(houses.id, houseId),
            eq(houses.kind, "SPORTS"),
          ),
        )
        .limit(1);
      if (!before) return { error: "That sports house no longer exists." };
      await tx
        .update(houses)
        .set({ name, colour })
        .where(
          and(
            eq(houses.schoolId, auth.schoolId),
            eq(houses.id, houseId),
            eq(houses.kind, "SPORTS"),
          ),
        );
      await recordAudit(tx, {
        schoolId: auth.schoolId,
        actorUserId: auth.actor.id ?? undefined,
        actorRole: auth.actor.role,
        actionType: "updated",
        entityType: "house",
        entityId: houseId,
        before,
        after: { name, colour },
        reason: `Sports house updated · ${name}`,
      });
      return { ok: true as const };
    });
    if ("error" in outcome) return { ok: false, error: outcome.error };
    safeRevalidate(HOUSES_PATH);
    return { ok: true };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, error: "Another house already uses that name." };
    }
    return { ok: false, error: "Could not save the sports house." };
  }
}

const ArchiveSchema = z.object({ houseId: z.string().uuid() });

export async function archiveSportsHouse(input: unknown): Promise<Result> {
  const auth = await authorizeWrite();
  if (!auth.ok) return auth;
  const parsed = ArchiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { houseId } = parsed.data;
  try {
    const outcome = await withSchool(auth.schoolId, async (tx) => {
      // Soft delete only — never a hard delete (students.house_id is ON DELETE SET NULL). Scoped to
      // kind='SPORTS' so a boarding house can never be archived from this surface.
      const [before] = await tx
        .select({ id: houses.id, name: houses.name, active: houses.active })
        .from(houses)
        .where(
          and(
            eq(houses.schoolId, auth.schoolId),
            eq(houses.id, houseId),
            eq(houses.kind, "SPORTS"),
          ),
        )
        .limit(1);
      if (!before) return { error: "That sports house no longer exists." };
      await tx
        .update(houses)
        .set({ active: false })
        .where(
          and(
            eq(houses.schoolId, auth.schoolId),
            eq(houses.id, houseId),
            eq(houses.kind, "SPORTS"),
          ),
        );
      await recordAudit(tx, {
        schoolId: auth.schoolId,
        actorUserId: auth.actor.id ?? undefined,
        actorRole: auth.actor.role,
        actionType: "updated",
        entityType: "house",
        entityId: houseId,
        before,
        after: { active: false },
        reason: `Sports house archived · ${before.name}`,
      });
      return { ok: true as const };
    });
    if ("error" in outcome) return { ok: false, error: outcome.error };
    safeRevalidate(HOUSES_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not archive the sports house." };
  }
}
