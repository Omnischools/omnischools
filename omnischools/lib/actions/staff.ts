"use server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { normalizeGhanaPhone } from "@/lib/auth";
import { sendSms } from "@/lib/sms";
import { sendEmail } from "@/lib/email";
import { safeRevalidate } from "@/lib/revalidate";
import { resolveRole } from "@/lib/staff-roles";
import type { Tx } from "@/lib/db";
import {
  users,
  roles,
  roleAssignments,
  classes,
  timetableSlots,
  invites,
  staffProfiles,
} from "@/db/schema";

type Result = { ok: boolean; error?: string };

/** Empty string / whitespace → null; otherwise the trimmed value. */
const nz = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
};

/** The optional staff-profile fields shared by the importer and the edit form. */
const profileFields = {
  dateOfBirth: z.string().optional().or(z.literal("")),
  gender: z.string().optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  emergencyContact: z.string().optional().or(z.literal("")),
  qualificationLevel: z.string().optional().or(z.literal("")), // resolved code
  highestQualification: z.string().optional().or(z.literal("")),
  undergraduate: z.string().optional().or(z.literal("")),
  ntcLicenceNumber: z.string().optional().or(z.literal("")),
  ntcLicenceExpiry: z.string().optional().or(z.literal("")),
  specialisations: z.string().optional().or(z.literal("")),
} as const;

type ProfileInput = {
  dateOfBirth?: string;
  gender?: string;
  address?: string;
  emergencyContact?: string;
  qualificationLevel?: string;
  highestQualification?: string;
  undergraduate?: string;
  ntcLicenceNumber?: string;
  ntcLicenceExpiry?: string;
  specialisations?: string;
};

/** True if the row carries any non-empty profile value worth persisting. */
function hasProfileData(p: ProfileInput): boolean {
  return [
    p.dateOfBirth,
    p.gender,
    p.address,
    p.emergencyContact,
    p.qualificationLevel,
    p.highestQualification,
    p.undergraduate,
    p.ntcLicenceNumber,
    p.ntcLicenceExpiry,
    p.specialisations,
  ].some((v) => nz(v) !== null);
}

/**
 * Upsert the (schoolId, userId) staff_profile row. Empty strings store as null;
 * date columns take "YYYY-MM-DD" strings straight through (the validator/import
 * guarantees they're either a valid ISO date or "").
 */
async function upsertStaffProfile(
  tx: Tx,
  schoolId: string,
  userId: string,
  p: ProfileInput,
): Promise<void> {
  const values = {
    dateOfBirth: nz(p.dateOfBirth),
    gender: nz(p.gender),
    address: nz(p.address),
    emergencyContact: nz(p.emergencyContact),
    qualificationLevel: nz(p.qualificationLevel),
    highestQualification: nz(p.highestQualification),
    undergraduate: nz(p.undergraduate),
    ntcLicenceNumber: nz(p.ntcLicenceNumber),
    ntcLicenceExpiry: nz(p.ntcLicenceExpiry),
    specialisations: nz(p.specialisations),
  };
  await tx
    .insert(staffProfiles)
    .values({ schoolId, userId, ...values })
    .onConflictDoUpdate({
      target: [staffProfiles.schoolId, staffProfiles.userId],
      set: { ...values, updatedAt: new Date() },
    });
}

/** Find-or-create the ref_role row (standard or custom) and return its id. */
async function ensureRoleId(tx: Tx, code: string, label: string) {
  await tx
    .insert(roles)
    .values({ code, label })
    .onConflictDoNothing({ target: roles.code });
  const [r] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.code, code));
  return r.id;
}

async function assign(
  tx: Tx,
  schoolId: string,
  userId: string,
  code: string,
  label: string,
): Promise<boolean> {
  const roleId = await ensureRoleId(tx, code, label);
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
  role: z.string().min(2, "Choose or enter a role").max(60),
});

export async function addStaff(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = AddStaffSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  const phone = normalizeGhanaPhone(d.phone);
  const role = resolveRole(d.role);
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
      const added = await assign(tx, school.id, u.id, role.code, role.label);
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: added ? "created" : "updated",
        entityType: "staff",
        entityId: u.id,
        after: { name: d.fullName, role: role.label },
        reason: "Staff member added",
      });
    });
    safeRevalidate("/staff");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not add staff. Please try again." };
  }
}

// --------------------------------------------------------------- bulk import
const INVITE_TTL_DAYS = 14;
const ImportStaffSchema = z.object({
  rows: z
    .array(
      z.object({
        fullName: z.string().min(2).max(120),
        phone: z.string().min(7),
        email: z.string().email().optional().or(z.literal("")),
        role: z.string().min(2).max(60),
        ...profileFields,
      }),
    )
    .min(1, "No rows to import")
    .max(500),
  sendInvites: z.boolean().optional(),
});

export async function importStaff(
  input: unknown,
): Promise<Result & { created?: number; invited?: number }> {
  const { school } = await requireSchool();
  const parsed = ImportStaffSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid import" };
  }
  const { rows, sendInvites } = parsed.data;
  const actor = await resolveActor(school.id);

  try {
    const out = await withSchool(school.id, async (tx) => {
      let created = 0;
      let invited = 0;
      const notify: {
        phone: string;
        email: string | null;
        roleLabel: string;
        token: string;
      }[] = [];

      for (const r of rows) {
        const phone = normalizeGhanaPhone(r.phone);
        const role = resolveRole(r.role);
        await tx
          .insert(users)
          .values({ phone, fullName: r.fullName.trim(), email: r.email || null })
          .onConflictDoNothing({ target: users.phone });
        const [u] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.phone, phone));
        const added = await assign(tx, school.id, u.id, role.code, role.label);
        if (added) created++;

        // Optional extended profile — only persist when the row carries any.
        if (hasProfileData(r)) {
          await upsertStaffProfile(tx, school.id, u.id, r);
        }

        if (sendInvites) {
          const token = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
          await tx.insert(invites).values({
            schoolId: school.id,
            token,
            role: role.code,
            fullName: r.fullName.trim(),
            email: r.email || null,
            phone,
            expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400_000),
            invitedByUserId: actor.id ?? null,
          });
          invited++;
          notify.push({ phone, email: r.email || null, roleLabel: role.label, token });
        }
      }

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "staff_batch",
        after: { count: created, invited },
        reason: "Bulk staff import",
      });
      return { created, invited, notify };
    });

    // best-effort invite notifications (stubbed providers; mirrors createInvite)
    if (sendInvites && out.notify.length > 0) {
      const base = process.env.NEXT_PUBLIC_SITE_URL ?? "";
      const sender = school.shortName ?? "Omnischools";
      for (const n of out.notify) {
        const link = `${base}/accept/${n.token}`;
        try {
          await sendSms(
            n.phone,
            `${sender}: You've been added as ${n.roleLabel}. Set up your account: ${link}`,
          );
          if (n.email) {
            await sendEmail({
              to: n.email,
              subject: `You're invited to ${school.name} on Omnischools`,
              html: `<p>You've been added as <b>${n.roleLabel}</b> at ${school.name}.</p><p><a href="${link}">Accept the invite & set your password</a>.</p>`,
            });
          }
        } catch {
          /* ignore provider failures — invite rows still exist */
        }
      }
    }

    safeRevalidate("/staff");
    return { ok: true, created: out.created, invited: out.invited };
  } catch {
    return { ok: false, error: "Could not import staff. Please try again." };
  }
}

// -------------------------------------------------------- save staff profile
/**
 * Upsert the optional extended profile for one staff member. Backs the profile
 * edit form. All fields optional; empty strings clear (store null). Dates are
 * "YYYY-MM-DD" strings (or "") and pass straight into the date columns.
 */
const SaveStaffProfileSchema = z.object({
  userId: z.string().uuid(),
  ...profileFields,
});

export async function saveStaffProfile(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = SaveStaffProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      await upsertStaffProfile(tx, school.id, d.userId, d);
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "staff_profile",
        entityId: d.userId,
        reason: "Staff profile updated",
      });
    });
    safeRevalidate("/staff");
    safeRevalidate(`/staff/${d.userId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the staff profile." };
  }
}

// ----------------------------------------------------------- edit staff record
const UpdateStaffSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string().min(2, "Enter the staff member's name").max(120),
  phone: z.string().min(7, "Enter a valid phone number"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
});

export async function updateStaff(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = UpdateStaffSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  const phone = normalizeGhanaPhone(d.phone);
  const actor = await resolveActor(school.id);
  try {
    const outcome = await withSchool(school.id, async (tx) => {
      // only edit someone who is actually our staff
      const [ra] = await tx
        .select({ id: roleAssignments.id })
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.schoolId, school.id),
            eq(roleAssignments.userId, d.userId),
          ),
        )
        .limit(1);
      if (!ra) return { error: "Not a staff member at this school." };
      // phone is the login identity — make sure it isn't already taken
      const [clash] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.phone, phone))
        .limit(1);
      if (clash && clash.id !== d.userId) {
        return { error: "Another account already uses that phone number." };
      }
      await tx
        .update(users)
        .set({ fullName: d.fullName.trim(), phone, email: d.email || null })
        .where(eq(users.id, d.userId));
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "staff",
        entityId: d.userId,
        after: { name: d.fullName },
        reason: "Staff record edited",
      });
      return { ok: true as const };
    });
    if ("error" in outcome) return { ok: false, error: outcome.error };
    safeRevalidate("/staff");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not update staff." };
  }
}

// --------------------------------------------------------------- delete staff
/**
 * Remove staff from THIS school: drop all their role assignments here and clear
 * them as class-teacher / timetable teacher. Their login identity (the user row,
 * keyed by phone) is kept — they may belong to other schools. Refuses to delete
 * the last administrator. Returns an error string (not throwing) when blocked.
 */
async function removeStaffMembers(
  tx: Tx,
  schoolId: string,
  userIds: string[],
): Promise<{ error?: string }> {
  const admins = await tx
    .select({ userId: roleAssignments.userId })
    .from(roleAssignments)
    .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
    .where(and(eq(roleAssignments.schoolId, schoolId), eq(roles.code, "ADMIN")));
  const adminIds = new Set(admins.map((a) => a.userId));
  const removingAdmins = userIds.filter((id) => adminIds.has(id));
  if (removingAdmins.length > 0 && removingAdmins.length >= adminIds.size) {
    return { error: "Can't remove the only administrator." };
  }

  await tx
    .update(classes)
    .set({ classTeacherUserId: null })
    .where(
      and(
        eq(classes.schoolId, schoolId),
        inArray(classes.classTeacherUserId, userIds),
      ),
    );
  await tx
    .update(timetableSlots)
    .set({ teacherUserId: null })
    .where(
      and(
        eq(timetableSlots.schoolId, schoolId),
        inArray(timetableSlots.teacherUserId, userIds),
      ),
    );
  await tx
    .delete(roleAssignments)
    .where(
      and(
        eq(roleAssignments.schoolId, schoolId),
        inArray(roleAssignments.userId, userIds),
      ),
    );
  return {};
}

const DeleteStaffSchema = z.object({ userId: z.string().uuid() });

export async function deleteStaff(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = DeleteStaffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const actor = await resolveActor(school.id);
  try {
    const outcome = await withSchool(school.id, async (tx) => {
      const res = await removeStaffMembers(tx, school.id, [parsed.data.userId]);
      if (res.error) return res;
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "deleted",
        entityType: "staff",
        entityId: parsed.data.userId,
        reason: "Staff removed from school",
      });
      return { ok: true as const };
    });
    if ("error" in outcome) return { ok: false, error: outcome.error };
    safeRevalidate("/staff");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not remove staff." };
  }
}

const DeleteStaffBulkSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(200),
});

export async function deleteStaffBulk(
  input: unknown,
): Promise<Result & { deleted?: number }> {
  const { school } = await requireSchool();
  const parsed = DeleteStaffBulkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Select at least one staff member" };
  const ids = Array.from(new Set(parsed.data.userIds));
  const actor = await resolveActor(school.id);
  try {
    const outcome = await withSchool(school.id, async (tx) => {
      const res = await removeStaffMembers(tx, school.id, ids);
      if (res.error) return res;
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "deleted",
        entityType: "staff_batch",
        after: { count: ids.length },
        reason: "Staff removed from school (bulk)",
      });
      return { ok: true as const };
    });
    if ("error" in outcome) return { ok: false, error: outcome.error };
    safeRevalidate("/staff");
    return { ok: true, deleted: ids.length };
  } catch {
    return { ok: false, error: "Could not remove the selected staff." };
  }
}

// ----------------------------------------------------------- assign more roles
const AssignSchema = z.object({
  userId: z.string().uuid(),
  role: z.string().min(2, "Choose or enter a role").max(60),
});

export async function assignStaffRole(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = AssignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const role = resolveRole(parsed.data.role);
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      const added = await assign(tx, school.id, parsed.data.userId, role.code, role.label);
      if (added) {
        await recordAudit(tx, {
          schoolId: school.id,
          actorUserId: actor.id ?? undefined,
          actorRole: actor.role,
          actionType: "updated",
          entityType: "staff",
          entityId: parsed.data.userId,
          after: { role: role.label },
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
