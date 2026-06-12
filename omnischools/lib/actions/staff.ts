"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { normalizeGhanaPhone } from "@/lib/auth";
import { safeRevalidate } from "@/lib/revalidate";
import { STAFF_ROLE_CODES, STAFF_ROLE_LABEL } from "@/lib/staff-roles";
import type { Tx } from "@/lib/db";
import { users, roles, roleAssignments } from "@/db/schema";

type Result = { ok: boolean; error?: string };

/** Ensure the ref_role row exists (prod onboarding seeds only ADMIN/HEADMASTER). */
async function ensureRoleId(tx: Tx, code: (typeof STAFF_ROLE_CODES)[number]) {
  await tx
    .insert(roles)
    .values({ code, label: STAFF_ROLE_LABEL[code] })
    .onConflictDoNothing({ target: roles.code });
  const [r] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.code, code));
  return r.id;
}

async function assign(
  tx: Tx,
  schoolId: string,
  userId: string,
  code: (typeof STAFF_ROLE_CODES)[number],
): Promise<boolean> {
  const roleId = await ensureRoleId(tx, code);
  const existing = await tx
    .select({ id: roleAssignments.id })
    .from(roleAssignments)
    .where(
      and(
        eq(roleAssignments.schoolId, schoolId),
        eq(roleAssignments.userId, userId),
        eq(roleAssignments.roleId, roleId),
      ),
    );
  if (existing.length > 0) return false;
  await tx.insert(roleAssignments).values({ userId, schoolId, roleId });
  return true;
}

// ----------------------------------------------------------------- add staff
const AddStaffSchema = z.object({
  fullName: z.string().min(2, "Enter the staff member's name").max(120),
  phone: z.string().min(7, "Enter a valid phone number"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  role: z.enum(STAFF_ROLE_CODES),
});

export async function addStaff(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = AddStaffSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  const phone = normalizeGhanaPhone(d.phone);
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      await tx
        .insert(users)
        .values({ phone, fullName: d.fullName.trim(), email: d.email || null })
        .onConflictDoNothing({ target: users.phone });
      const [u] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.phone, phone));
      const added = await assign(tx, school.id, u.id, d.role);
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: added ? "created" : "updated",
        entityType: "staff",
        entityId: u.id,
        after: { name: d.fullName, role: d.role },
        reason: "Staff member added",
      });
    });
    safeRevalidate("/staff");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not add staff. Please try again." };
  }
}

// ----------------------------------------------------------- assign more roles
const AssignSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(STAFF_ROLE_CODES),
});

export async function assignStaffRole(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = AssignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      const added = await assign(tx, school.id, parsed.data.userId, parsed.data.role);
      if (added) {
        await recordAudit(tx, {
          schoolId: school.id,
          actorUserId: actor.id ?? undefined,
          actorRole: actor.role,
          actionType: "updated",
          entityType: "staff",
          entityId: parsed.data.userId,
          after: { role: parsed.data.role },
          reason: "Role assigned",
        });
      }
    });
    safeRevalidate("/staff");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not assign role." };
  }
}

// --------------------------------------------------------------- remove role
const RemoveSchema = z.object({ assignmentId: z.string().uuid() });

export async function removeStaffRole(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = RemoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const actor = await resolveActor(school.id);
  try {
    const outcome = await withSchool(school.id, async (tx) => {
      const [a] = await tx
        .select({
          id: roleAssignments.id,
          userId: roleAssignments.userId,
          code: roles.code,
        })
        .from(roleAssignments)
        .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
        .where(
          and(
            eq(roleAssignments.id, parsed.data.assignmentId),
            eq(roleAssignments.schoolId, school.id),
          ),
        );
      if (!a) return { error: "Role not found." };
      if (a.code === "ADMIN") {
        const admins = await tx
          .select({ id: roleAssignments.id })
          .from(roleAssignments)
          .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
          .where(and(eq(roleAssignments.schoolId, school.id), eq(roles.code, "ADMIN")));
        if (admins.length <= 1) {
          return { error: "Can't remove the only administrator." };
        }
      }
      await tx
        .delete(roleAssignments)
        .where(
          and(
            eq(roleAssignments.id, parsed.data.assignmentId),
            eq(roleAssignments.schoolId, school.id),
          ),
        );
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "deleted",
        entityType: "staff",
        entityId: a.userId,
        before: { role: a.code },
        reason: "Role removed",
      });
      return { ok: true as const };
    });
    if ("error" in outcome) return { ok: false, error: outcome.error };
    safeRevalidate("/staff");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not remove role." };
  }
}
