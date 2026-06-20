"use server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { safeRevalidate } from "@/lib/revalidate";
import { createAdminClient, BRANDING_BUCKET } from "@/lib/supabase/admin";
import { schools, gradebookConfig } from "@/db/schema";

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
