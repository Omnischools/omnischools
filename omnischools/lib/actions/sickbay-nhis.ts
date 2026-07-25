"use server";
/**
 * NHIS card identity WRITE path (SHS module 4.4 / INCR-25a) — the ONE card per student
 * (`student_nhis_card`, R183). Mirrors lib/actions/sickbay-visit.ts: `authorizeClinicalWrite()` is the
 * FIRST statement, then a Zod parse, then a `withSchool` transaction with `recordAudit` inside the same
 * tx; the studentId is re-resolved server-side (a client id is never trusted — three-layer no-IDOR).
 *
 * 🔴 Authz (R195). The card is clinical-adjacent identity: WRITE = SICKBAY_CLINICAL_WRITE_ROLES =
 * [MATRON] — the same actor who records the referral at ER. The HEADMASTER READS it and the ADMIN gets
 * no clinical read at all; a hand-crafted POST from either is refused HERE, before any query runs.
 *
 * 🔴 R183 — `card_number` is stored VERBATIM. There is NO regex and NO format normalisation: NHIS
 * formats vary across card generations, so the only transform is trimming outer whitespace for the
 * non-empty check. Status is DERIVED at read (`nhisCardStatus`), never stored. The card-holder MAY be a
 * guardian (`holder_kind = GUARDIAN`): `holder_name` is authoritative and `student_guardian_id` is a
 * nullable BEST-EFFORT link — an invalid one is dropped to null, never a hard failure.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SICKBAY_CLINICAL_WRITE_ROLES } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import { students, studentGuardians, studentNhisCard } from "@/db/schema";

type Result = { ok: boolean; error?: string; id?: string };

async function authorizeClinicalWrite(): Promise<
  | { ok: true; schoolId: string; actor: { id: string | null; role: string } }
  | { ok: false; error: string }
> {
  const { school } = await requireSchool();
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, SICKBAY_CLINICAL_WRITE_ROLES)) {
    return { ok: false, error: "Only the Matron can record a student's NHIS card." };
  }
  const actor = await resolveActor(school.id);
  return { ok: true, schoolId: school.id, actor };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SaveSchema = z.object({
  studentId: z.string().uuid(),
  // R183 — VERBATIM. `.trim()` removes only outer whitespace (a stray paste space); no format regex.
  cardNumber: z.string().trim().min(1).max(64),
  holderName: z.string().trim().max(160).nullish(),
  holderKind: z.enum(["STUDENT", "GUARDIAN"]).default("STUDENT"),
  validFrom: z.string().regex(DATE).nullish(),
  validTo: z.string().regex(DATE).nullish(),
  studentGuardianId: z.string().uuid().nullish(),
});

/**
 * Upsert the student's single NHIS card. Create when none exists, edit otherwise (the singleton is
 * `unique(school_id, student_id)` — the backstop against a concurrent double-create). One audit row with
 * a before→after snapshot every time.
 */
export async function saveNhisCard(input: unknown): Promise<Result> {
  const auth = await authorizeClinicalWrite();
  if (!auth.ok) return auth;
  const parsed = SaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the NHIS card details." };
  const d = parsed.data;

  try {
    const res = await withSchool(auth.schoolId, async (tx): Promise<Result> => {
      // No-IDOR: the studentId must be a student of THIS school (a foreign uuid cannot resolve).
      const [student] = await tx
        .select({ id: students.id })
        .from(students)
        .where(and(eq(students.schoolId, auth.schoolId), eq(students.id, d.studentId)))
        .limit(1);
      if (!student) return { ok: false, error: "That student is not in this school." };

      // Best-effort guardian link — verify it belongs to this student in this school, else drop to null.
      let guardianId: string | null = null;
      if (d.studentGuardianId) {
        const [g] = await tx
          .select({ id: studentGuardians.id })
          .from(studentGuardians)
          .where(
            and(
              eq(studentGuardians.schoolId, auth.schoolId),
              eq(studentGuardians.studentId, d.studentId),
              eq(studentGuardians.id, d.studentGuardianId),
            ),
          )
          .limit(1);
        guardianId = g?.id ?? null;
      }

      const [before] = await tx
        .select()
        .from(studentNhisCard)
        .where(
          and(
            eq(studentNhisCard.schoolId, auth.schoolId),
            eq(studentNhisCard.studentId, d.studentId),
          ),
        )
        .limit(1);

      const values = {
        holderName: d.holderName || null,
        holderKind: d.holderKind,
        validFrom: d.validFrom || null,
        validTo: d.validTo || null,
        studentGuardianId: guardianId,
      };

      let cardId: string;
      if (before) {
        await tx
          .update(studentNhisCard)
          .set({ cardNumber: d.cardNumber, ...values, updatedAt: new Date() })
          .where(
            and(eq(studentNhisCard.schoolId, auth.schoolId), eq(studentNhisCard.id, before.id)),
          );
        cardId = before.id;
      } else {
        const [row] = await tx
          .insert(studentNhisCard)
          .values({
            schoolId: auth.schoolId,
            studentId: d.studentId,
            cardNumber: d.cardNumber,
            ...values,
          })
          .returning({ id: studentNhisCard.id });
        cardId = row.id;
      }

      await recordAudit(tx, {
        schoolId: auth.schoolId,
        actorUserId: auth.actor.id ?? undefined,
        actorRole: auth.actor.role,
        actionType: before ? "updated" : "created",
        entityType: "student_nhis_card",
        entityId: cardId,
        before: before
          ? { cardNumber: before.cardNumber, holderKind: before.holderKind, validTo: before.validTo }
          : undefined,
        after: { cardNumber: d.cardNumber, holderKind: d.holderKind, validTo: d.validTo || null },
        reason: `NHIS card ${before ? "updated" : "recorded"}`,
      });
      return { ok: true, id: cardId };
    });
    if (!res.ok) return res;
    safeRevalidate("/senior/sickbay/nhis");
    return res;
  } catch {
    return { ok: false, error: "Could not save the NHIS card." };
  }
}
