"use server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { requireParent } from "@/lib/auth/server";
import { withParentScope } from "@/lib/db/rls";
import { safeRevalidate } from "@/lib/revalidate";

/**
 * 🔴 EXEAT PHASE 2 · the parent-initiated SPECIAL exeat request — the parent portal's second sanctioned
 * WRITE (after Communications). Deliberately a THIN guarded caller (belt); the SECURITY DEFINER
 * `parent_request_exeat` fn (Wells, prod-paste-0098) is the authority (braces): it server-forces
 * exeat_type=SPECIAL / status=REQUESTED / parent_initiated=true, derives house/period/return-by/fee-snapshot,
 * and enforces own-child + active-boarder + the one-live-exeat open-guard IN-transaction. We validate the
 * inputs at the trust boundary and pass the fn's neutral errors straight through (never SMS, never a
 * staff-field write). Mirrors the doctrine in lib/actions/parent-comms.ts.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const Schema = z.object({
  studentId: z.string().uuid("Choose a boarder."),
  reason: z.string().trim().min(4, "Tell the school why (a few words).").max(500, "That reason is too long."),
  departDate: z.string().regex(DATE, "Choose a leave date."),
  returnDate: z.string().regex(DATE, "Choose a return date."),
});

type Result = { ok: boolean; refCode?: string; error?: string };

/** The two terse fn codes are not parent-facing copy; every other fn error IS a neutral sentence → pass it. */
function mapExeatError(err: string | null | undefined): string {
  if (!err) return "Couldn't submit your request. Please try again.";
  if (err === "not_found" || err === "unauthorized") return "We couldn't find that child on your account.";
  return err;
}

export async function requestParentExeat(input: unknown): Promise<Result> {
  const { user, school } = await requireParent();
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const { studentId, reason, departDate, returnDate } = parsed.data;

  // Belt validation (the fn does not re-check calendar ordering): leave date not in the past, return ≥ depart.
  const today = new Date().toISOString().slice(0, 10);
  if (departDate < today) return { ok: false, error: "The leave date can't be in the past." };
  if (returnDate < departDate) return { ok: false, error: "The return date must be on or after the leave date." };

  let result: { ok: boolean; ref_code: string | null; error: string | null } | null;
  try {
    result = await withParentScope(school.id, user.id, async (tx) => {
      const rows = (await tx.execute(sql`
        select ok, ref_code, error
        from parent_request_exeat(
          ${school.id}::uuid, ${user.id}::uuid, ${studentId}::uuid,
          ${reason}, ${departDate}::date, ${returnDate}::date)
      `)) as unknown as { ok: boolean; ref_code: string | null; error: string | null }[];
      return rows[0] ?? null;
    });
  } catch {
    return { ok: false, error: "Couldn't submit your request. Please try again." };
  }

  if (!result?.ok) return { ok: false, error: mapExeatError(result?.error) };
  safeRevalidate("/boarding");
  return { ok: true, refCode: result.ref_code ?? undefined };
}

/**
 * 🔴 EXEAT PHASE 3-B · the parent CANCELS their own still-REQUESTED portal request. Same thin-guarded-caller
 * shape as requestParentExeat: the SECURITY DEFINER `parent_withdraw_exeat` fn is the authority — it allows
 * ONLY own-child + via_parent_portal=true + status='REQUESTED', is idempotent (already-WITHDRAWN → no-op
 * success), and refuses everything else with a neutral error. We validate the id at the trust boundary and
 * pass the fn's neutral error straight through (never an SMS, never a direct boarding_exeat write).
 */
const WithdrawSchema = z.object({ exeatId: z.string().uuid() });

export async function withdrawParentExeat(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const { user, school } = await requireParent();
  const parsed = WithdrawSchema.safeParse(
    typeof input === "string" ? { exeatId: input } : input,
  );
  if (!parsed.success) return { ok: false, error: "We couldn't find that request." };
  const { exeatId } = parsed.data;

  let result: { ok: boolean; error: string | null } | null;
  try {
    result = await withParentScope(school.id, user.id, async (tx) => {
      const rows = (await tx.execute(sql`
        select ok, error
        from parent_withdraw_exeat(${school.id}::uuid, ${user.id}::uuid, ${exeatId}::uuid)
      `)) as unknown as { ok: boolean; error: string | null }[];
      return rows[0] ?? null;
    });
  } catch {
    return { ok: false, error: "Couldn't withdraw your request. Please try again." };
  }

  if (!result?.ok) return { ok: false, error: mapExeatError(result?.error) };
  safeRevalidate("/boarding");
  return { ok: true };
}
