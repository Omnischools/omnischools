"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool, pgError } from "@/lib/db/rls";
import { requireSchool, resolveActor, assertWriteAccess } from "@/lib/auth/server";
import { recordAudit } from "@/lib/db/audit";
import { safeRevalidate } from "@/lib/revalidate";
import { whatsappTemplates } from "@/db/schema";

type Result = { ok: boolean; error?: string; id?: string };

const nz = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

const ButtonSchema = z.object({
  type: z.enum(["URL", "PHONE", "QUICK_REPLY"]),
  label: z.string().min(1).max(40),
  value: z.string().max(400).optional().or(z.literal("")),
});

const SaveSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  name: z
    .string()
    .trim()
    .min(2, "Give the template a name")
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, "Use snake_case: lowercase letters, numbers, underscores"),
  category: z.enum(["UTILITY", "MARKETING"]).default("UTILITY"),
  language: z.enum(["en_GH", "tw", "gaa"]).default("en_GH"),
  headerType: z.enum(["NONE", "TEXT", "IMAGE", "DOCUMENT"]).default("NONE"),
  headerText: z.string().max(60).optional().or(z.literal("")),
  headerFilename: z.string().max(120).optional().or(z.literal("")),
  body: z.string().trim().min(1, "The body can't be empty").max(1024),
  footer: z.string().max(60).optional().or(z.literal("")),
  buttons: z.array(ButtonSchema).max(3).optional(),
  sampleValues: z.record(z.string(), z.string()).optional(),
});

/** Create or update a template. Editing is only allowed while it's a DRAFT (a submitted
 * template is immutable on Meta's side — you duplicate it as a new version instead). */
export async function saveTemplate(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const parsed = SaveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid template" };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);
  const values = {
    name: d.name,
    category: d.category,
    language: d.language,
    headerType: d.headerType,
    headerText: d.headerType === "TEXT" ? nz(d.headerText) : null,
    headerFilename: d.headerType === "DOCUMENT" ? nz(d.headerFilename) : null,
    body: d.body,
    footer: nz(d.footer),
    buttons: d.buttons && d.buttons.length > 0 ? d.buttons : null,
    sampleValues: d.sampleValues ?? null,
    updatedAt: new Date(),
  };
  try {
    const id = await withSchool(school.id, async (tx) => {
      if (d.id) {
        const [existing] = await tx
          .select({ status: whatsappTemplates.status })
          .from(whatsappTemplates)
          .where(
            and(
              eq(whatsappTemplates.id, d.id),
              eq(whatsappTemplates.schoolId, school.id),
            ),
          );
        if (!existing) throw new Error("not found");
        if (existing.status !== "DRAFT") throw new Error("locked");
        await tx
          .update(whatsappTemplates)
          .set(values)
          .where(eq(whatsappTemplates.id, d.id));
        return d.id;
      }
      const [row] = await tx
        .insert(whatsappTemplates)
        .values({ schoolId: school.id, ...values, createdByUserId: actor.id ?? undefined })
        .returning({ id: whatsappTemplates.id });
      return row.id;
    });
    await withSchool(school.id, (tx) =>
      recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: d.id ? "updated" : "created",
        entityType: "whatsapp_template",
        entityId: id,
        after: { name: d.name, category: d.category },
        reason: "WhatsApp template saved",
      }),
    );
    safeRevalidate("/settings/channels/whatsapp/templates");
    return { ok: true, id };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (msg.includes("locked")) {
      return { ok: false, error: "Submitted templates can't be edited — duplicate it as a new version." };
    }
    // Match on the unwrapped SQLSTATE/constraint, NOT the thrown error's message: Drizzle's wrapper
    // message is only "Failed query: …" — "duplicate key" and the constraint name live on `.cause`,
    // so the old string match never fired. (The `locked` check above stays message-based: that error
    // is thrown by our own code, not the driver, so it is not wrapped.)
    const pg = pgError(e);
    if (pg.constraint === "uniq_whatsapp_template_name" || pg.code === "23505") {
      return { ok: false, error: "A template with this name already exists." };
    }
    return { ok: false, error: "Could not save the template." };
  }
}

/**
 * Submit a DRAFT to "Meta". Real submission is stubbed (no Business API): a plain
 * Utility template auto-approves; anything that would hit Meta's manual-review queue
 * (Marketing category, a document header, or 2+ buttons) lands in PENDING until a real
 * integration resolves it.
 */
export async function submitTemplate(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const id = z.string().uuid().safeParse((input as { id?: string })?.id);
  if (!id.success) return { ok: false, error: "Invalid input" };
  const actor = await resolveActor(school.id);
  try {
    const outcome = await withSchool(school.id, async (tx) => {
      const [t] = await tx
        .select()
        .from(whatsappTemplates)
        .where(and(eq(whatsappTemplates.id, id.data), eq(whatsappTemplates.schoolId, school.id)));
      if (!t) throw new Error("not found");
      if (t.status !== "DRAFT") throw new Error("not a draft");
      const buttonCount = Array.isArray(t.buttons) ? t.buttons.length : 0;
      const needsManualReview =
        t.category === "MARKETING" || t.headerType === "DOCUMENT" || buttonCount >= 2;
      const now = new Date();
      const status = needsManualReview ? "PENDING" : "APPROVED";
      await tx
        .update(whatsappTemplates)
        .set({
          status,
          submittedAt: now,
          decidedAt: needsManualReview ? null : now,
          updatedAt: now,
        })
        .where(eq(whatsappTemplates.id, id.data));
      return status;
    });
    await withSchool(school.id, (tx) =>
      recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "submitted",
        entityType: "whatsapp_template",
        entityId: id.data,
        after: { status: outcome },
        reason: "WhatsApp template submitted for review",
      }),
    );
    safeRevalidate("/settings/channels/whatsapp/templates");
    safeRevalidate(`/settings/channels/whatsapp/templates/${id.data}`);
    return { ok: true };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (msg.includes("not a draft")) return { ok: false, error: "Only drafts can be submitted." };
    return { ok: false, error: "Could not submit the template." };
  }
}

/**
 * Dev/stand-in for Meta's approval callback: manually resolve a PENDING template.
 * (Once the WhatsApp Business API is wired, a webhook does this automatically.)
 */
export async function resolveTemplate(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const d = z
    .object({
      id: z.string().uuid(),
      decision: z.enum(["APPROVED", "REJECTED"]),
      reason: z.string().max(400).optional().or(z.literal("")),
    })
    .safeParse(input);
  if (!d.success) return { ok: false, error: "Invalid input" };
  try {
    await withSchool(school.id, (tx) =>
      tx
        .update(whatsappTemplates)
        .set({
          status: d.data.decision,
          rejectionReason: d.data.decision === "REJECTED" ? nz(d.data.reason) : null,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(whatsappTemplates.id, d.data.id),
            eq(whatsappTemplates.schoolId, school.id),
            eq(whatsappTemplates.status, "PENDING"),
          ),
        ),
    );
    safeRevalidate("/settings/channels/whatsapp/templates");
    safeRevalidate(`/settings/channels/whatsapp/templates/${d.data.id}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not resolve the template." };
  }
}

/** Duplicate any template as a fresh DRAFT (for a new version after edits/rejection). */
export async function duplicateTemplate(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const id = z.string().uuid().safeParse((input as { id?: string })?.id);
  if (!id.success) return { ok: false, error: "Invalid input" };
  const actor = await resolveActor(school.id);
  try {
    const newId = await withSchool(school.id, async (tx) => {
      const [t] = await tx
        .select()
        .from(whatsappTemplates)
        .where(and(eq(whatsappTemplates.id, id.data), eq(whatsappTemplates.schoolId, school.id)));
      if (!t) throw new Error("not found");
      // Bump a _vN suffix (or add _v2).
      const m = t.name.match(/^(.*?)(?:_v(\d+))?$/);
      const base = m?.[1] ?? t.name;
      const next = (m?.[2] ? parseInt(m[2], 10) : 1) + 1;
      const [row] = await tx
        .insert(whatsappTemplates)
        .values({
          schoolId: school.id,
          name: `${base}_v${next}`,
          category: t.category,
          language: t.language,
          headerType: t.headerType,
          headerText: t.headerText,
          headerFilename: t.headerFilename,
          body: t.body,
          footer: t.footer,
          buttons: t.buttons,
          sampleValues: t.sampleValues,
          status: "DRAFT",
          createdByUserId: actor.id ?? undefined,
        })
        .returning({ id: whatsappTemplates.id });
      return row.id;
    });
    safeRevalidate("/settings/channels/whatsapp/templates");
    return { ok: true, id: newId };
  } catch {
    return { ok: false, error: "Could not duplicate the template." };
  }
}

/**
 * Accept Meta's suggested recategorisation after a rejection: duplicate the
 * template as a fresh DRAFT with `category = "MARKETING"`, keeping the body/header/
 * buttons unchanged. Returns the new id so the caller can open its edit page.
 * (The real round-trip to Meta happens once the Business API is wired.)
 */
export async function acceptAsMarketing(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const id = z.string().uuid().safeParse((input as { id?: string })?.id);
  if (!id.success) return { ok: false, error: "Invalid input" };
  const actor = await resolveActor(school.id);
  try {
    const newId = await withSchool(school.id, async (tx) => {
      const [t] = await tx
        .select()
        .from(whatsappTemplates)
        .where(and(eq(whatsappTemplates.id, id.data), eq(whatsappTemplates.schoolId, school.id)));
      if (!t) throw new Error("not found");
      // Bump a _vN suffix (or add _v2) — same convention as duplicateTemplate.
      const m = t.name.match(/^(.*?)(?:_v(\d+))?$/);
      const base = m?.[1] ?? t.name;
      const next = (m?.[2] ? parseInt(m[2], 10) : 1) + 1;
      const [row] = await tx
        .insert(whatsappTemplates)
        .values({
          schoolId: school.id,
          name: `${base}_v${next}`,
          category: "MARKETING",
          language: t.language,
          headerType: t.headerType,
          headerText: t.headerText,
          headerFilename: t.headerFilename,
          body: t.body,
          footer: t.footer,
          buttons: t.buttons,
          sampleValues: t.sampleValues,
          status: "DRAFT",
          createdByUserId: actor.id ?? undefined,
        })
        .returning({ id: whatsappTemplates.id });
      return row.id;
    });
    safeRevalidate("/settings/channels/whatsapp/templates");
    return { ok: true, id: newId };
  } catch {
    return { ok: false, error: "Could not recategorise the template." };
  }
}

/** Retire a template: sets status to ARCHIVED so it disappears from the active picker
 * but stays in the audit trail. Any non-archived template can be archived. */
export async function archiveTemplate(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const id = z.string().uuid().safeParse((input as { id?: string })?.id);
  if (!id.success) return { ok: false, error: "Invalid input" };
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      await tx
        .update(whatsappTemplates)
        .set({ status: "ARCHIVED", updatedAt: new Date() })
        .where(
          and(eq(whatsappTemplates.id, id.data), eq(whatsappTemplates.schoolId, school.id)),
        );
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "whatsapp_template",
        entityId: id.data,
        after: { status: "ARCHIVED" },
        reason: "WhatsApp template archived",
      });
    });
    safeRevalidate("/settings/channels/whatsapp/templates");
    safeRevalidate(`/settings/channels/whatsapp/templates/${id.data}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not archive the template." };
  }
}

export async function deleteTemplate(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const id = z.string().uuid().safeParse((input as { id?: string })?.id);
  if (!id.success) return { ok: false, error: "Invalid input" };
  try {
    await withSchool(school.id, (tx) =>
      tx
        .delete(whatsappTemplates)
        .where(
          and(eq(whatsappTemplates.id, id.data), eq(whatsappTemplates.schoolId, school.id)),
        ),
    );
    safeRevalidate("/settings/channels/whatsapp/templates");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not delete the template." };
  }
}
