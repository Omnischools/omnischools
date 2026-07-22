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
import { resolveRole, roleLabel } from "@/lib/staff-roles";
import { isStaff, hasAnyRole, STAFF_ADMIN_ROLES } from "@/lib/access";
import { isParentRole, parentInviteError } from "@/lib/parent/claim";
import { resolveParentInviteTargetTx, stampGuardianUserId } from "@/lib/parent/parent-data";
import { invites, users, roles, roleAssignments } from "@/db/schema";

type Result = { ok: boolean; error?: string };

const INVITE_TTL_DAYS = 14;

// ----------------------------------------------------------------- create
const CreateInviteSchema = z.object({
  role: z.string().min(2, "Choose or enter a role").max(60),
  // Optional so a PARENT invite (which derives name + phone from the guardian row) needn't supply them;
  // the staff branch re-validates their presence below.
  fullName: z.string().max(120).optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  // INCR-19a PARENT invite (AC C1): the child + the exact student_guardian row to invite. Ignored for staff.
  studentId: z.string().uuid().optional(),
  guardianId: z.string().uuid().optional(),
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
  const { user, school } = await requireSchool();
  // Staff-gated: a non-staff role (STUDENT / PARENT) must not create invites (AC A1).
  if (!isStaff(user.roles)) {
    return { ok: false, error: "Only staff can send invites." };
  }
  const parsed = CreateInviteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;

  // Resolve the recipient. For a PARENT invite the name + phone come from the STORED guardian row, never
  // from caller free-text (AC C2 — the claim/OTP destination cannot be a supplied number); for staff they
  // come from the request as before.
  let role: { code: string; label: string };
  let phone: string;
  let fullName: string;
  let studentId: string | null = null;
  let assignments = d.assignments ?? null;

  if (isParentRole(d.role)) {
    role = { code: "PARENT", label: "Parent" };
    const c1 = parentInviteError(role.code, d.studentId, d.guardianId);
    if (c1) return { ok: false, error: c1 };
    const target = await withSchool(school.id, (tx) =>
      resolveParentInviteTargetTx(tx, school.id, d.studentId!, d.guardianId!),
    );
    if (!target) return { ok: false, error: "That guardian is not on this student's record." };
    phone = target.phone; // AC C2 — authoritative by construction (the stored guardian number)
    fullName = target.fullName;
    studentId = target.studentId;
    assignments = null; // a parent invite carries no class grants
  } else {
    role = resolveRole(d.role);
    if (!d.fullName || d.fullName.trim().length < 2) return { ok: false, error: "Enter a name" };
    if (!d.phone || d.phone.length < 7) return { ok: false, error: "A phone number is required" };
    phone = normalizeGhanaPhone(d.phone);
    fullName = d.fullName.trim();
  }

  // 🔴 A STAFF INVITE IS THE SAME CAPABILITY AS `addStaff` — create a user and grant them a role at
  // this school — so it takes the SAME gate. This is the second door onto the escalation, and it
  // needs no interception: `createInvite` returns the token to its caller by design, and
  // `acceptInvite` requires no session. Quinn reproduced it end-to-end on a production build — a
  // TEACHER invited a privileged role **to their own phone number**, accepted it, and
  // `onConflictDoNothing` on `users.phone` stapled the role onto their existing account.
  //
  // My first fix blocked only ADMIN/HEADMASTER, justified by "a Form Master inviting a teacher is
  // legitimate". Dex checked: **that surface does not exist.** Both staff callers of this action are
  // on `/staff` (now admin-only), and the only other caller is the parent invite. So the carve-out
  // defended a workflow with no UI while leaving MATRON (clinical write), VICE_HEADMASTER_ACADEMIC
  // (the WASSCE freeze co-signer), DEAN_OF_BOARDING and the finance roles mintable by any teacher —
  // the identical two-call exploit, one role over.
  //
  // PARENT invites stay staff-wide: teachers issue them from /students, and a parent invite grants
  // no staff privilege (its phone/name come from the stored guardian row, never caller free-text).
  const canInvite = isParentRole(d.role)
    ? isStaff(user.roles)
    : hasAnyRole(user.roles, STAFF_ADMIN_ROLES);
  if (!canInvite) {
    return { ok: false, error: "Only an administrator can invite staff." };
  }

  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000);
  const actor = await resolveActor(school.id);

  try {
    await withSchool(school.id, async (tx) => {
      await tx.insert(invites).values({
        schoolId: school.id,
        token,
        role: role.code,
        fullName,
        email: d.email || null,
        phone,
        studentId,
        assignments,
        expiresAt,
        invitedByUserId: actor.id ?? null,
      });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "invite",
        after: { role: role.label, name: fullName },
        reason: "Invite sent",
      });
    });

    const base = process.env.NEXT_PUBLIC_SITE_URL ?? "";
    const link = `${base}/accept/${token}`;
    const sender = school.shortName ?? "Omnischools";
    // SMS console-degrades with no Hubtel creds (AC C7) — sendSms reads no HUBTEL_* here.
    await sendSms(
      phone,
      role.code === "PARENT"
        ? `${sender}: Follow your child's WASSCE readiness on Omnischools. Set up your parent access: ${link}`
        : `${sender}: You've been added as ${role.label}. Set up your account: ${link}`,
    );
    if (d.email) {
      await sendEmail({
        to: d.email,
        subject: `You're invited to ${school.name} on Omnischools`,
        html: `<p>You've been added as <b>${role.label}</b> at ${school.name}.</p><p><a href="${link}">Accept the invite & set your password</a>.</p>`,
      });
    }
    safeRevalidate(role.code === "PARENT" && studentId ? `/students/${studentId}` : "/staff");
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
        .values({ code: inv.role, label: roleLabel(inv.role) })
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

      // AC C4 — a PARENT claim stamps the LIVE entitlement link on the ONE guardian row named by
      // (schoolId, studentId, phone), never other rows sharing the phone. Runs only after the account
      // (verification) has succeeded above, so a failed/absent verification never stamps (AC C3).
      if (inv.role === "PARENT" && inv.studentId) {
        await stampGuardianUserId(tx, {
          schoolId: inv.schoolId,
          studentId: inv.studentId,
          phone: inv.phone!,
          userId: u.id,
        });
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
