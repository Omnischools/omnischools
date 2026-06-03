"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { sendSms } from "@/lib/sms";
import { safeRevalidate } from "@/lib/revalidate";
import {
  students,
  studentGuardians,
  announcements,
  smsTemplates,
  notificationLog,
} from "@/db/schema";

// --------------------------------------------------------------- announcements
const AnnouncementSchema = z
  .object({
    title: z.string().min(1, "Title is required").max(160),
    body: z.string().min(1, "Message is required").max(4000),
    audience: z.enum(["WHOLE_SCHOOL", "CLASS"]),
    classId: z.string().uuid().optional().or(z.literal("")),
  })
  .refine((d) => d.audience !== "CLASS" || !!d.classId, {
    message: "Choose a class for a class announcement",
    path: ["classId"],
  });

export async function postAnnouncement(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const { school } = await requireSchool();
  const parsed = AnnouncementSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid announcement",
    };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      const [a] = await tx
        .insert(announcements)
        .values({
          schoolId: school.id,
          title: d.title,
          body: d.body,
          audience: d.audience,
          classId: d.audience === "CLASS" ? d.classId || null : null,
          postedByUserId: actor.id ?? undefined,
        })
        .returning();
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "announcement",
        entityId: a.id,
        after: { title: d.title, audience: d.audience },
      });
    });
    safeRevalidate("/communication");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not post the announcement." };
  }
}

// ------------------------------------------------------------------ templates
export async function createTemplate(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const { school } = await requireSchool();
  const parsed = z
    .object({ name: z.string().min(1).max(80), body: z.string().min(1).max(1000) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Name and message are required." };
  try {
    await withSchool(school.id, (tx) =>
      tx.insert(smsTemplates).values({
        schoolId: school.id,
        name: parsed.data.name,
        body: parsed.data.body,
      }),
    );
    safeRevalidate("/communication");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save template (name may already exist)." };
  }
}

// ----------------------------------------------------------------- send SMS
const SendSchema = z
  .object({
    audience: z.enum(["WHOLE_SCHOOL", "CLASS"]),
    classId: z.string().uuid().optional().or(z.literal("")),
    templateId: z.string().uuid().optional().or(z.literal("")),
    message: z.string().max(1000).optional().or(z.literal("")),
  })
  .refine((d) => d.audience !== "CLASS" || !!d.classId, {
    message: "Choose a class",
    path: ["classId"],
  })
  .refine((d) => !!d.templateId || !!d.message, {
    message: "Pick a template or type a message",
    path: ["message"],
  });

export type SendSmsResult =
  | { ok: true; sent: number; failed: number }
  | { ok: false; error: string };

function render(body: string, vars: { student: string; school: string }): string {
  return body.replaceAll("{student}", vars.student).replaceAll("{school}", vars.school);
}

export async function sendSmsToAudience(input: unknown): Promise<SendSmsResult> {
  const { school } = await requireSchool();
  const parsed = SendSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid send" };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);

  try {
    // resolve template + recipients (primary guardians of students in audience)
    const { templateBody, recipients } = await withSchool(school.id, async (tx) => {
      let templateBody = d.message ?? "";
      if (d.templateId) {
        const [tpl] = await tx
          .select({ body: smsTemplates.body })
          .from(smsTemplates)
          .where(
            and(eq(smsTemplates.id, d.templateId), eq(smsTemplates.schoolId, school.id)),
          );
        if (tpl) templateBody = tpl.body;
      }
      const conds = [
        eq(studentGuardians.schoolId, school.id),
        eq(studentGuardians.isPrimary, true),
        eq(students.status, "ACTIVE"),
      ];
      if (d.audience === "CLASS") conds.push(eq(students.classId, d.classId as string));
      const recipients = await tx
        .select({
          studentId: students.id,
          first: students.firstName,
          phone: studentGuardians.phone,
        })
        .from(studentGuardians)
        .innerJoin(students, eq(students.id, studentGuardians.studentId))
        .where(and(...conds));
      return { templateBody, recipients };
    });

    if (recipients.length === 0)
      return { ok: false, error: "No recipients in this audience." };

    const schoolName = school.shortName ?? "Omnischools";
    let sent = 0;
    let failed = 0;
    for (const r of recipients) {
      const msg = render(templateBody, { student: r.first, school: schoolName });
      const res = await sendSms(r.phone, msg);
      if (res.ok) sent++;
      else failed++;
      await withSchool(school.id, (tx) =>
        tx.insert(notificationLog).values({
          schoolId: school.id,
          studentId: r.studentId,
          phone: r.phone,
          message: msg,
          status: res.ok ? "SENT" : "FAILED",
          provider: res.provider,
          providerRef: res.id ?? null,
          templateId: d.templateId || null,
          sentByUserId: actor.id ?? undefined,
        }),
      );
    }

    await withSchool(school.id, (tx) =>
      recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "sent",
        entityType: "sms_broadcast",
        after: { audience: d.audience, sent, failed },
        reason: "SMS broadcast",
      }),
    );

    safeRevalidate("/communication");
    return { ok: true, sent, failed };
  } catch {
    return { ok: false, error: "Could not send the SMS broadcast." };
  }
}
