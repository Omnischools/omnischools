"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool, withoutTenantScope } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { normalizeGhanaPhone, createPasswordUser } from "@/lib/auth";
import { sendSms } from "@/lib/sms";
import { sendEmail } from "@/lib/email";
import { safeRevalidate } from "@/lib/revalidate";
import { STAFF_ROLE_CODES, STAFF_ROLE_LABEL } from "@/lib/staff-roles";
import { invites, users, roles, roleAssignments } from "@/db/schema";

type Result = { ok: boolean; error?: string };

const INVITE_TTL_DAYS = 14;

// ----------------------------------------------------------------- create
const CreateInviteSchema = z.object({
  role: z.enum(STAFF_ROLE_CODES),
  fullName: z.string().min(2, "Enter a name").max(120),
  phone: z.string().min(7, "A phone number is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  assignments: z
    .array(
      z.object({
        classId: z.string().uuid().optional(),
        subjectId: z.string().uuid().optional(),
        formMaster: z.boolean().optional(),
      }),
    )
    .optional(),
});

export async function createInvite(input: unknown): Promise<Result & { token?: string }> {
  const { school } = await requireSchool();
  const parsed = CreateInviteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  const phone = normalizeGhanaPhone(d.phone);
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000);
  const actor = await resolveActor(school.id);

  try {
    await withSchool(school.id, async (tx) => {
      await tx.insert(invites).values({
        schoolId: school.id,
        token,
        role: d.role,
        fullName: d.fullName.trim(),
        email: d.email || null,
        phone,
        assignments: d.assignments ?? null,
        expiresAt,
        invitedByUserId: actor.id ?? null,
      });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "invite",
        after: { role: d.role, name: d.fullName },
        reason: "Invite sent",
      });
    });

    const base = process.env.NEXT_PUBLIC_SITE_URL ?? "";
    const link = `${base}/accept/${token}`;
    const sender = school.shortName ?? "Omnischools";
    await sendSms(
      phone,
      `${sender}: You've been added as ${STAFF_ROLE_LABEL[d.role]}. Set up your account: ${link}`,
    );
    if (d.email) {
      await sendEmail({
        to: d.email,
        subject: `You're invited to ${school.name} on Omnischools`,
        html: `<p>You've been added as <b>${STAFF_ROLE_LABEL[d.role]}</b> at ${school.name}.</p><p><a href="${link}">Accept the invite & set your password</a>.</p>`,
      });
    }
    safeRevalidate("/staff");
    return { ok: true, token };
  } catch {
    return { ok: false, error: "Could not create the invite." };
  }
}

// ----------------------------------------------------------------- revoke
export async function revokeInvite(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const id = z
    .string()
    .uuid()
    .safeParse((input as { id?: string })?.id);
  if (!id.success) return { ok: false, error: "Invalid input" };
  try {
    await withSchool(school.id, (tx) =>
      tx
        .update(invites)
        .set({ status: "REVOKED" })
        .where(and(eq(invites.id, id.data), eq(invites.schoolId, school.id))),
    );
    safeRevalidate("/staff");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not revoke." };
  }
}

// ----------------------------------------------------------------- accept
const AcceptSchema = z.object({
  token: z.string().min(6),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function acceptInvite(input: unknown): Promise<Result> {
  const parsed = AcceptSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { token, password } = parsed.data;

  // 1) Look up the invite (no session yet → bypass RLS).
  const found = await withoutTenantScope(async (tx) => {
    const [inv] = await tx.select().from(invites).where(eq(invites.token, token));
    if (!inv) return { error: "This invite link is not valid." };
    if (inv.status !== "PENDING")
      return { error: "This invite has already been used or was revoked." };
    if (inv.expiresAt && inv.expiresAt.getTime() < Date.now())
      return { error: "This invite has expired — ask your school to resend it." };
    return { inv };
  });
  if ("error" in found) return { ok: false, error: found.error };
  const inv = found.inv;
  if (!inv.phone) return { ok: false, error: "This invite has no phone on file." };

  // 2) Create the password account (Supabase) — outside the DB transaction.
  const auth = await createPasswordUser(inv.phone, password);
  if (!auth.ok) return { ok: false, error: auth.error };

  // 3) Link the ref_user + role assignment, mark accepted (bypass RLS).
  try {
    await withoutTenantScope(async (tx) => {
      await tx
        .insert(roles)
        .values({ code: inv.role, label: STAFF_ROLE_LABEL[inv.role] ?? inv.role })
        .onConflictDoNothing({ target: roles.code });
      const [roleRow] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.code, inv.role));

      await tx
        .insert(users)
        .values({ phone: inv.phone!, fullName: inv.fullName, email: inv.email })
        .onConflictDoNothing({ target: users.phone });
      const [u] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.phone, inv.phone!));

      const existing = await tx
        .select({ id: roleAssignments.id })
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.schoolId, inv.schoolId),
            eq(roleAssignments.userId, u.id),
            eq(roleAssignments.roleId, roleRow.id),
          ),
        );
      if (existing.length === 0) {
        await tx
          .insert(roleAssignments)
          .values({ userId: u.id, schoolId: inv.schoolId, roleId: roleRow.id });
      }

      await tx
        .update(invites)
        .set({ status: "ACCEPTED", acceptedUserId: u.id, acceptedAt: new Date() })
        .where(eq(invites.id, inv.id));
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not complete sign-up. Please try again." };
  }
}
