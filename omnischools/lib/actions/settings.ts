"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { safeRevalidate } from "@/lib/revalidate";
import { createAdminClient, BRANDING_BUCKET } from "@/lib/supabase/admin";
import {
  schools,
  gradebookConfig,
  academicPeriod,
  academicPeriodConfig,
  gradeScale,
} from "@/db/schema";

// --------------------------------------------------------------- school profile
const OWNERSHIPS = ["PUBLIC", "PRIVATE", "MISSION", "INTERNATIONAL"] as const;
const ProfileSchema = z.object({
  name: z.string().min(2, "School name is too short").max(120),
  shortName: z
    .string()
    .max(12, "Sign-off must be 12 characters or fewer")
    .optional()
    .or(z.literal("")),
  // Fuller School-info fields (Settings → School info). GES code / region / district
  // are identity fields set at onboarding and stay read-only here.
  csspsCode: z.string().max(40).optional().or(z.literal("")),
  yearFounded: z.string().max(8).optional().or(z.literal("")),
  address: z.string().max(200).optional().or(z.literal("")),
  ownership: z.enum(OWNERSHIPS).optional(),
});

export async function updateSchoolProfile(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const { school } = await requireSchool();
  const parsed = ProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  const nz = (v?: string) => (v && v.trim() ? v.trim() : null);
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      await tx
        .update(schools)
        .set({
          name: d.name.trim(),
          shortName: d.shortName ? d.shortName.trim().toUpperCase() : null,
          csspsCode: nz(d.csspsCode),
          yearFounded: nz(d.yearFounded),
          address: nz(d.address),
          ...(d.ownership ? { ownership: d.ownership } : {}),
        })
        .where(eq(schools.id, school.id));
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "school",
        entityId: school.id,
        after: { name: d.name },
        reason: "School profile updated",
      });
    });
    safeRevalidate("/settings");
    safeRevalidate("/settings/school");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save changes. Please try again." };
  }
}

// --------------------------------------------------------------- branding
const urlField = z
  .string()
  .max(500)
  .url("Enter a valid image URL (https://…)")
  .optional()
  .or(z.literal(""));
const BrandingSchema = z.object({
  logoUrl: urlField,
  stampUrl: urlField,
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #1A2B47")
    .optional()
    .or(z.literal("")),
});

export async function updateSchoolBranding(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const { school } = await requireSchool();
  const parsed = BrandingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  const nz = (v?: string) => (v && v.trim() ? v.trim() : null);
  // Partial update — only touch fields the caller actually sent (undefined = leave,
  // "" = clear). Lets the colour Save and the per-image Remove run independently.
  const set: Record<string, string | null> = {};
  if (d.logoUrl !== undefined) set.logoUrl = nz(d.logoUrl);
  if (d.stampUrl !== undefined) set.stampUrl = nz(d.stampUrl);
  if (d.brandColor !== undefined) set.brandColor = nz(d.brandColor);
  if (Object.keys(set).length === 0) return { ok: true };
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      await tx.update(schools).set(set).where(eq(schools.id, school.id));
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "school",
        entityId: school.id,
        after: set,
        reason: "Branding updated",
      });
    });
    safeRevalidate("/settings");
    safeRevalidate("/settings/branding");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save branding. Please try again." };
  }
}

// --------------------------------------------------------------- branding upload
const MAX_BRAND_BYTES = 2 * 1024 * 1024; // 2 MB
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/** Upload a logo/stamp to Supabase Storage (service role) and store its public URL. */
export async function uploadBrandingImage(
  formData: FormData,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const { school } = await requireSchool();
  const kind = String(formData.get("kind") ?? "");
  const file = formData.get("file");
  if (kind !== "logo" && kind !== "stamp") {
    return { ok: false, error: "Invalid image type." };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file selected." };
  }
  if (file.size > MAX_BRAND_BYTES) {
    return { ok: false, error: "Image must be 2 MB or smaller." };
  }
  const ext = MIME_EXT[file.type];
  if (!ext) return { ok: false, error: "Use a PNG, JPG, WebP or SVG image." };

  const admin = createAdminClient();
  if (!admin) {
    return { ok: false, error: "Image upload isn't configured on this deployment." };
  }

  const path = `${school.id}/${kind}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const up = await admin.storage
    .from(BRANDING_BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: true });
  if (up.error) return { ok: false, error: "Upload failed. Please try again." };
  const url = admin.storage.from(BRANDING_BUCKET).getPublicUrl(path).data.publicUrl;

  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      await tx
        .update(schools)
        .set(kind === "logo" ? { logoUrl: url } : { stampUrl: url })
        .where(eq(schools.id, school.id));
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "school",
        entityId: school.id,
        after: { [kind]: true },
        reason: `Branding ${kind} uploaded`,
      });
    });
    safeRevalidate("/settings");
    safeRevalidate("/settings/branding");
    return { ok: true, url };
  } catch {
    return { ok: false, error: "Saved the file but couldn't update the record." };
  }
}

// --------------------------------------------------------------- grading weights
const WeightsSchema = z
  .object({
    classWeight: z.coerce.number().int().min(0).max(100),
    examWeight: z.coerce.number().int().min(0).max(100),
  })
  .refine((d) => d.classWeight + d.examWeight === 100, {
    message: "Class and exam weights must add up to 100%.",
  });

export async function updateGradingWeights(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const { school } = await requireSchool();
  const parsed = WeightsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid weights" };
  }
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      await tx
        .insert(gradebookConfig)
        .values({
          schoolId: school.id,
          classWeight: parsed.data.classWeight,
          examWeight: parsed.data.examWeight,
        })
        .onConflictDoUpdate({
          target: gradebookConfig.schoolId,
          set: {
            classWeight: parsed.data.classWeight,
            examWeight: parsed.data.examWeight,
          },
        });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "gradebook_config",
        entityId: school.id,
        after: {
          classWeight: parsed.data.classWeight,
          examWeight: parsed.data.examWeight,
        },
        reason: "Grading weights updated",
      });
    });
    safeRevalidate("/settings");
    safeRevalidate("/gradebook");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save weights. Please try again." };
  }
}

// --------------------------------------------------------------- academic periods
const isIsoDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

const PeriodsSchema = z.object({
  academicYear: z.string().min(1).max(20),
  periodType: z.enum(["TERM", "SEMESTER"]).optional(),
  periods: z
    .array(
      z.object({
        periodId: z.string().uuid().optional(), // absent = a new term to insert
        label: z.string().min(1, "Each term needs a name").max(40),
        startsOn: z.string(),
        endsOn: z.string(),
      }),
    )
    .min(1, "Add at least one term")
    .max(8),
});

/** Save term dates — updates existing periods (by id) and inserts new ones. Ensures an
 *  academic-period-config row exists so the FK holds; never deletes (would cascade scores). */
export async function updateAcademicPeriods(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const { school } = await requireSchool();
  const parsed = PeriodsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { academicYear, periods } = parsed.data;
  for (const p of periods) {
    if (!isIsoDate(p.startsOn) || !isIsoDate(p.endsOn)) {
      return { ok: false, error: `Enter valid dates for ${p.label}.` };
    }
    if (p.startsOn > p.endsOn) {
      return { ok: false, error: `${p.label}: the start date is after the end date.` };
    }
  }
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      // ensure the config row exists (FK target for academic_period)
      await tx
        .insert(academicPeriodConfig)
        .values({
          schoolId: school.id,
          academicYear,
          periodType: parsed.data.periodType ?? "TERM",
          periodCount: periods.length,
          source: "SCHOOL_OVERRIDE",
          configuredBy: actor.id ?? undefined,
        })
        .onConflictDoNothing();

      const existing = await tx
        .select({ n: academicPeriod.periodNumber })
        .from(academicPeriod)
        .where(
          and(
            eq(academicPeriod.schoolId, school.id),
            eq(academicPeriod.academicYear, academicYear),
          ),
        );
      let nextNum = existing.reduce((m, e) => Math.max(m, e.n), 0);

      for (const p of periods) {
        if (p.periodId) {
          await tx
            .update(academicPeriod)
            .set({ periodLabel: p.label.trim(), startsOn: p.startsOn, endsOn: p.endsOn })
            .where(
              and(
                eq(academicPeriod.periodId, p.periodId),
                eq(academicPeriod.schoolId, school.id),
              ),
            );
        } else {
          nextNum += 1;
          await tx.insert(academicPeriod).values({
            schoolId: school.id,
            academicYear,
            periodNumber: nextNum,
            periodLabel: p.label.trim(),
            startsOn: p.startsOn,
            endsOn: p.endsOn,
          });
        }
      }
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "academic_period",
        entityId: school.id,
        after: { periods: periods.length, academicYear },
        reason: "Term dates updated",
      });
    });
    safeRevalidate("/settings");
    safeRevalidate("/settings/academic");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save term dates. Please try again." };
  }
}

// --------------------------------------------------------------- grade scale
const GradeScaleSchema = z.object({
  rows: z
    .array(
      z.object({
        grade: z.string().min(1, "Grade is required").max(8),
        label: z.string().max(40).optional().or(z.literal("")),
        minScore: z.coerce.number().min(0).max(100),
      }),
    )
    .min(1, "Add at least one grade")
    .max(15),
});

export async function updateGradeScale(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const { school } = await requireSchool();
  const parsed = GradeScaleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const nz = (v?: string) => (v && v.trim() ? v.trim() : null);
  const rows = parsed.data.rows.map((r) => ({ ...r, grade: r.grade.trim() }));
  const codes = rows.map((r) => r.grade.toUpperCase());
  if (new Set(codes).size !== codes.length) {
    return { ok: false, error: "Grade letters must be unique." };
  }
  const ordered = [...rows].sort((a, b) => b.minScore - a.minScore);
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      await tx.delete(gradeScale).where(eq(gradeScale.schoolId, school.id));
      await tx.insert(gradeScale).values(
        ordered.map((g, i) => ({
          schoolId: school.id,
          grade: g.grade,
          label: nz(g.label),
          minScore: String(g.minScore),
          ordinal: i,
        })),
      );
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "grade_scale",
        entityId: school.id,
        after: { grades: ordered.length },
        reason: "Grade scale updated",
      });
    });
    safeRevalidate("/settings");
    safeRevalidate("/settings/academic");
    safeRevalidate("/gradebook");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the grade scale. Please try again." };
  }
}
