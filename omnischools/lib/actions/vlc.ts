"use server";
/**
 * VLC setup mutations (SHS module 4.5 / INCR-40 · the config spine).
 *
 * Every mutation is gated server-side to VLC_CONFIG_WRITE_ROLES (DEAN_OF_STUDENTS / ADMIN) — a
 * HEADMASTER or FORM_MASTER READS the surface and every write here refuses them, including a
 * hand-crafted POST that never touched the UI. Each writes one audit_log row with a before→after
 * snapshot (entityType vlc_programme / vlc_value / vlc_session_template — all SHOWN, no pastoral PII).
 *
 * Config only. NO sum-to-60 CHECK on the phase durations (a school may run a longer or shorter
 * session — each phase need only be positive, matching the schema). Validation lives here, never a
 * DB trigger (portability).
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { assertAnyRole, requireSchool, resolveActor } from "@/lib/auth/server";
import { VLC_CONFIG_WRITE_ROLES } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import { vlcProgramme, vlcSessionTemplate, vlcValue } from "@/db/schema";

type Result = { ok: boolean; error?: string };
const SETUP_PATH = "/senior/vlc/setup";
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The shared write gate — re-checked on EVERY action, so a Headmaster/Form Master (who read the
 * surface) or any other role is refused before a single row is touched. `assertAnyRole` throws on a
 * failed check; the UI hides the controls too, but this server refusal is the real boundary.
 */
async function authorizeVlcWrite(): Promise<{
  schoolId: string;
  actor: { id: string | null; role: string };
}> {
  const { school } = await requireSchool();
  await assertAnyRole(VLC_CONFIG_WRITE_ROLES);
  const actor = await resolveActor(school.id);
  return { schoolId: school.id, actor };
}

// ---- 1) Programme — cadence (day + start) + the five phase durations (singleton upsert) ----

const ProgrammeSchema = z.object({
  sessionDay: z.coerce.number().int().min(1).max(7),
  sessionStart: z.string().regex(HHMM, "Start time must be HH:MM."),
  openerMin: z.coerce.number().int().min(1).max(180),
  smallGroupMin: z.coerce.number().int().min(1).max(180),
  plenaryMin: z.coerce.number().int().min(1).max(180),
  reflectionMin: z.coerce.number().int().min(1).max(180),
  closeMin: z.coerce.number().int().min(1).max(180),
});

/**
 * Declare / adjust the school's VLC programme. Upserts the per-school singleton on the school_id
 * conflict (the sickbay_settings / boarding_settings idiom). `configured_at` is stamped on the FIRST
 * save and preserved thereafter (it distinguishes "declared" from "never configured", not a freeze).
 * The session end/total derive from the five durations — nothing stored to disagree with them.
 */
export async function updateVlcProgramme(input: unknown): Promise<Result> {
  const gate = await authorizeVlcWrite();
  const parsed = ProgrammeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the programme details." };
  }
  const d = parsed.data;
  try {
    await withSchool(gate.schoolId, async (tx) => {
      const [before] = await tx
        .select({
          sessionDay: vlcProgramme.sessionDay,
          sessionStart: vlcProgramme.sessionStart,
          openerMin: vlcProgramme.openerMin,
          smallGroupMin: vlcProgramme.smallGroupMin,
          plenaryMin: vlcProgramme.plenaryMin,
          reflectionMin: vlcProgramme.reflectionMin,
          closeMin: vlcProgramme.closeMin,
        })
        .from(vlcProgramme)
        .where(eq(vlcProgramme.schoolId, gate.schoolId))
        .limit(1);
      await tx
        .insert(vlcProgramme)
        .values({ schoolId: gate.schoolId, ...d, configuredAt: new Date(), updatedAt: new Date() })
        // configured_at is deliberately NOT in the update set — first save stamps it, later saves keep it.
        .onConflictDoUpdate({
          target: vlcProgramme.schoolId,
          set: { ...d, updatedAt: new Date() },
        });
      await recordAudit(tx, {
        schoolId: gate.schoolId,
        actorUserId: gate.actor.id ?? undefined,
        actorRole: gate.actor.role,
        actionType: before ? "updated" : "created",
        entityType: "vlc_programme",
        entityId: gate.schoolId,
        before: before ?? null,
        after: d,
        reason: "VLC programme cadence & phase durations updated",
      });
    });
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the programme." };
  }
}

// ---- 2) Value — rename the EN/Twi of an existing value (add/reorder/remove deferred, R291) ----

const ValueSchema = z.object({
  id: z.string().uuid(),
  nameEn: z.string().trim().min(1, "The value needs an English name.").max(80),
  nameTwi: z.string().trim().max(80).nullish(),
});

export async function updateVlcValue(input: unknown): Promise<Result> {
  const gate = await authorizeVlcWrite();
  const parsed = ValueSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the value details." };
  }
  const { id, nameEn } = parsed.data;
  const nameTwi = parsed.data.nameTwi?.trim() || null;
  try {
    const res = await withSchool(gate.schoolId, async (tx): Promise<Result> => {
      const [before] = await tx
        .select({ nameEn: vlcValue.nameEn, nameTwi: vlcValue.nameTwi })
        .from(vlcValue)
        .where(and(eq(vlcValue.schoolId, gate.schoolId), eq(vlcValue.id, id)))
        .limit(1);
      if (!before) return { ok: false, error: "That value no longer exists." };
      await tx
        .update(vlcValue)
        .set({ nameEn, nameTwi, updatedAt: new Date() })
        .where(and(eq(vlcValue.schoolId, gate.schoolId), eq(vlcValue.id, id)));
      await recordAudit(tx, {
        schoolId: gate.schoolId,
        actorUserId: gate.actor.id ?? undefined,
        actorRole: gate.actor.role,
        actionType: "updated",
        entityType: "vlc_value",
        entityId: id,
        before,
        after: { nameEn, nameTwi },
        reason: `VLC value renamed · ${nameEn}`,
      });
      return { ok: true };
    });
    if (!res.ok) return res;
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the value." };
  }
}

// ---- 3) Session template — edit the title/prompt of an existing A|B slot ----

const TemplateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1, "The session needs a title.").max(120),
  prompt: z.string().trim().max(240).nullish(),
});

export async function updateVlcSessionTemplate(input: unknown): Promise<Result> {
  const gate = await authorizeVlcWrite();
  const parsed = TemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the session details." };
  }
  const { id, title } = parsed.data;
  const prompt = parsed.data.prompt?.trim() || null;
  try {
    const res = await withSchool(gate.schoolId, async (tx): Promise<Result> => {
      const [before] = await tx
        .select({ title: vlcSessionTemplate.title, prompt: vlcSessionTemplate.prompt })
        .from(vlcSessionTemplate)
        .where(and(eq(vlcSessionTemplate.schoolId, gate.schoolId), eq(vlcSessionTemplate.id, id)))
        .limit(1);
      if (!before) return { ok: false, error: "That session no longer exists." };
      await tx
        .update(vlcSessionTemplate)
        .set({ title, prompt, updatedAt: new Date() })
        .where(and(eq(vlcSessionTemplate.schoolId, gate.schoolId), eq(vlcSessionTemplate.id, id)));
      await recordAudit(tx, {
        schoolId: gate.schoolId,
        actorUserId: gate.actor.id ?? undefined,
        actorRole: gate.actor.role,
        actionType: "updated",
        entityType: "vlc_session_template",
        entityId: id,
        before,
        after: { title, prompt },
        reason: `VLC session prompt updated · ${title}`,
      });
      return { ok: true };
    });
    if (!res.ok) return res;
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the session." };
  }
}
