import "server-only";
import { and, eq } from "drizzle-orm";
import { withParentScope } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import { studentNhisCard } from "@/db/schema";
import { nhisCardStatus, type NhisStatus } from "@/lib/sickbay/nhis";

/**
 * 🔴 INCR-32 · the PARENT-facing NHIS reader (D8's NHIS half · Kofi R246–R255). The 3rd widening of the
 * 19a parent boundary (11 → 12 `parent_scope` tables) and the second most privacy-sensitive parent
 * reader after INCR-29.
 *
 * MEDIUM-3 — Wells's `parent_scope` (0065) opens the ROW on `student_nhis_card` (RLS scopes by child),
 * INCLUDING the verbatim `card_number`. RLS is ROW-level and CANNOT mask a column, so THIS PROJECTION
 * is the ONLY guard keeping the membership number off the wire. The reader therefore touches EXACTLY
 * `student_nhis_card`, joins NOTHING, and projects EXACTLY the owner-confirmed pair below — status +
 * expiry only (owner call 2026-07-26). A `card_number` / `holder_name` in a SELECT here leaks a health
 * identifier to a parent.
 *
 * FROZEN KEY-SET (R249): `parentNhisStatusTx()` returns EXACTLY `{ status, validTo }` — a card-field
 * spread onto it changes the key-set and reds parent-nhis-data.test.ts (NH1), not production. `status`
 * is DERIVED via the shared PURE helper `nhisCardStatus` (R248 — never reinvented, and NEVER via
 * `nhis-reads.ts`, which selects the number). No row → `null` (R250, honest "not registered"; the R183
 * singleton means no card = no row). NO write, NO notify.
 *
 * 🚫 NEVER in a SELECT, NEVER on the wire (R249 / owner deny): `card_number` / `holder_name` /
 * `holder_kind` / `valid_from` / `student_guardian_id` / `id`. `valid_to` is the ONLY card column that
 * leaves the DB — a drizzle `date`, already `'YYYY-MM-DD'`, no clock, no `to_char` needed.
 */
export interface ParentNhisStatus {
  status: NhisStatus;
  validTo: string | null; // 'YYYY-MM-DD' expiry — the sole card fact on the wire besides derived status
}

/**
 * ONE child's NHIS status, projected to the frozen pair. `studentId` is an INPUT filter (resolved
 * server-side from the session, never a URL param) and is NEVER returned. MUST run on a tx already
 * scoped by `withParentScope`; the `parent_scope` RLS predicate independently guarantees the id can
 * only be one of THIS parent's own children — a forged id yields zero rows → `null` (fail-closed).
 * `asOf` is threaded so the derivation is testable; the derivation itself is the shared helper (R248).
 */
export async function parentNhisStatusTx(
  tx: Tx,
  schoolId: string,
  studentId: string,
  asOf: Date,
): Promise<ParentNhisStatus | null> {
  // The R183 beneficiary singleton — at most one card per student. Project ONLY validTo (R249/R255).
  const [card] = await tx
    .select({ validTo: studentNhisCard.validTo })
    .from(studentNhisCard)
    .where(and(eq(studentNhisCard.schoolId, schoolId), eq(studentNhisCard.studentId, studentId)))
    .limit(1);
  if (!card) return null; // no row = not registered (R250) — honest empty, never a fabricated Active
  return {
    status: nhisCardStatus(card.validTo, asOf),
    validTo: card.validTo,
  };
}

/** Entry point — ONE child's NHIS status under `withParentScope` (never `withSchool`). */
export async function loadParentNhisStatus(
  schoolId: string,
  userId: string,
  studentId: string,
  asOf: Date = new Date(),
): Promise<ParentNhisStatus | null> {
  return withParentScope(schoolId, userId, (tx) => parentNhisStatusTx(tx, schoolId, studentId, asOf));
}
