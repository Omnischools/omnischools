"use server";
import { eq, and } from "drizzle-orm";
import { safeRevalidate } from "@/lib/revalidate";
import { z } from "zod";
import { withSchool, withoutTenantScope } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { normalizeGhanaPhone } from "@/lib/auth";
import { sendSms } from "@/lib/sms";
import { nextStudentCode } from "@/lib/students-helpers";
import { schools, students, studentGuardians, admissionApplications } from "@/db/schema";

const ApplicationSchema = z.object({
  schoolCode: z.string().min(2, "School code is required").max(40),
  applicantFirstName: z.string().min(1, "First name is required").max(120),
  applicantLastName: z.string().min(1, "Last name is required").max(120),
  applicantOtherNames: z.string().max(120).optional().or(z.literal("")),
  sex: z.enum(["MALE", "FEMALE"]),
  dateOfBirth: z.string().optional().or(z.literal("")),
  desiredClassLabel: z.string().max(60).optional().or(z.literal("")),
  guardianName: z.string().min(1, "Guardian name is required").max(160),
  guardianPhone: z.string().min(7, "Guardian phone is required").max(40),
  guardianEmail: z.string().email().optional().or(z.literal("")),
});

export type SubmitApplicationResult =
  | { ok: true; applicationId: string }
  | { ok: false; error: string };

/** Public: a prospective student applies to a school identified by its GES code. */
export async function submitApplication(
  input: unknown,
): Promise<SubmitApplicationResult> {
  const parsed = ApplicationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid application" };
  }
  const d = parsed.data;
  try {
    const out = await withoutTenantScope(async (tx) => {
      const [school] = await tx
        .select({ id: schools.id })
        .from(schools)
        .where(eq(schools.gesCode, d.schoolCode));
      if (!school)
        return { ok: false as const, error: "We couldn't find a school with that code." };

      const [app] = await tx
        .insert(admissionApplications)
        .values({
          schoolId: school.id,
          applicantFirstName: d.applicantFirstName,
          applicantLastName: d.applicantLastName,
          applicantOtherNames: d.applicantOtherNames || null,
          sex: d.sex,
          dateOfBirth: d.dateOfBirth || null,
          desiredClassLabel: d.desiredClassLabel || null,
          guardianName: d.guardianName,
          guardianPhone: normalizeGhanaPhone(d.guardianPhone),
          guardianEmail: d.guardianEmail || null,
          status: "SUBMITTED",
        })
        .returning();

      await recordAudit(tx, {
        schoolId: school.id,
        actorRole: "APPLICANT",
        actionType: "created",
        entityType: "admission_application",
        entityId: app.id,
        after: { applicant: `${d.applicantFirstName} ${d.applicantLastName}` },
        reason: "Public admission application",
      });
      return { ok: true as const, applicationId: app.id };
    });

    if (!out.ok) return { ok: false, error: out.error };
    return { ok: true, applicationId: out.applicationId };
  } catch {
    return { ok: false, error: "Could not submit the application. Please try again." };
  }
}

const DecisionSchema = z.object({
  applicationId: z.string().uuid(),
  decision: z.enum(["ACCEPTED", "REJECTED", "WAITLISTED"]),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export type DecisionResult =
  | { ok: true; studentId?: string }
  | { ok: false; error: string };

/** Admin: decide on an application. ACCEPT creates a student + primary guardian. */
export async function decideApplication(input: unknown): Promise<DecisionResult> {
  const { school } = await requireSchool();
  const parsed = DecisionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid decision" };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);

  try {
    const out = await withSchool(school.id, async (tx) => {
      const [app] = await tx
        .select()
        .from(admissionApplications)
        .where(
          and(
            eq(admissionApplications.id, d.applicationId),
            eq(admissionApplications.schoolId, school.id),
          ),
        );
      if (!app) return { ok: false as const, error: "Application not found." };
      if (app.status === "ACCEPTED")
        return { ok: false as const, error: "Already accepted." };

      let studentId: string | undefined;
      if (d.decision === "ACCEPTED") {
        const studentCode = await nextStudentCode(tx, school.id);
        const [student] = await tx
          .insert(students)
          .values({
            schoolId: school.id,
            studentCode,
            firstName: app.applicantFirstName,
            lastName: app.applicantLastName,
            otherNames: app.applicantOtherNames,
            sex: app.sex,
            dateOfBirth: app.dateOfBirth,
            currentClassLabel: app.desiredClassLabel,
            enrolledOn: new Date().toISOString().slice(0, 10),
            admissionApplicationId: app.id,
          })
          .returning();
        studentId = student.id;

        await tx.insert(studentGuardians).values({
          schoolId: school.id,
          studentId: student.id,
          name: app.guardianName,
          phone: app.guardianPhone,
          email: app.guardianEmail,
          isPrimary: true,
        });

        await recordAudit(tx, {
          schoolId: school.id,
          actorUserId: actor.id ?? undefined,
          actorRole: actor.role,
          actionType: "created",
          entityType: "student",
          entityId: student.id,
          after: { studentCode, fromApplication: app.id },
          reason: "Admission accepted",
        });
      }

      await tx
        .update(admissionApplications)
        .set({
          status: d.decision,
          notes: d.notes || app.notes,
          studentId: studentId ?? app.studentId,
          decidedByUserId: actor.id ?? undefined,
          decidedAt: new Date(),
        })
        .where(eq(admissionApplications.id, app.id));

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: d.decision.toLowerCase(),
        entityType: "admission_application",
        entityId: app.id,
        before: { status: app.status },
        after: { status: d.decision },
        reason: "Admission decision",
      });

      return {
        ok: true as const,
        studentId,
        guardianPhone: app.guardianPhone,
        decision: d.decision,
      };
    });

    if (!out.ok) return { ok: false, error: out.error };

    // notify guardian (stubbed)
    if (out.decision === "ACCEPTED") {
      await sendSms(
        out.guardianPhone,
        `${school.shortName ?? "Omnischools"}: Admission accepted. Welcome! We'll be in touch with next steps.`,
      );
    }
    safeRevalidate("/admissions");
    safeRevalidate("/students");
    return { ok: true, studentId: out.studentId };
  } catch {
    return { ok: false, error: "Could not record the decision. Please try again." };
  }
}
