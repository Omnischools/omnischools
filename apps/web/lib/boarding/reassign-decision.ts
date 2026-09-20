/**
 * The pure decision at the heart of a within-House bunk reassign (INCR-7 · AC C/D · trap J3).
 * No DB, no I/O — every branch is unit-testable. The server action (lib/actions/boarding.ts)
 * gathers the facts, calls this, and only writes when it returns { ok: true }; the DB partial
 * unique on students.current_bunk_id is the race backstop behind the `bunk_occupied` pre-check.
 */

export type HouseGender = "BOYS" | "GIRLS" | "COED";
export type Sex = "MALE" | "FEMALE";

export type ReassignRejection =
  | "missing_reason"
  | "invalid_target"
  | "no_change"
  | "not_within_house"
  | "gender_mismatch"
  | "bunk_occupied";

export type ReassignDecision = { ok: true } | { ok: false; reason: ReassignRejection };

/**
 * Does a House's gender admit a student's sex? BOYS⇒MALE, GIRLS⇒FEMALE, COED⇒either.
 * A null gender (an unconfigured House) is NOT enforced here — the strip renders without a
 * gender pill and a placement is allowed rather than crashing (AC I3). This is the J3 guard,
 * deliberately in the app layer: a cross-table sex-vs-gender check would need a DB trigger,
 * which portability discipline forbids.
 */
export function genderAdmits(gender: HouseGender | null, sex: Sex): boolean {
  if (gender == null || gender === "COED") return true;
  return gender === "BOYS" ? sex === "MALE" : sex === "FEMALE";
}

export interface ReassignInput {
  reason: string | null | undefined;
  student: { houseId: string; sex: Sex; currentBunkId: string | null };
  target:
    | {
        bunkId: string;
        houseId: string;
        houseGender: HouseGender | null;
        /** A different student already holds this bunk. */
        occupiedByOther: boolean;
      }
    | null;
}

export function decideReassign(i: ReassignInput): ReassignDecision {
  // AC C4 — a reason is mandatory and is rejected BEFORE anything is written.
  if (!i.reason || i.reason.trim().length === 0) return { ok: false, reason: "missing_reason" };
  if (!i.target) return { ok: false, reason: "invalid_target" };
  // AC D4 — re-pointing to the same bunk is a no-op, never a duplicate open history row.
  if (i.target.bunkId === i.student.currentBunkId) return { ok: false, reason: "no_change" };
  // This surface only moves a boarder WITHIN their own House (House-to-House transfer is a
  // separate consented workflow — Lucy scope line). Houses are single-gender, so this also
  // catches the ordinary cross-gender attempt (a wrong-gender bunk lives in another House).
  if (i.target.houseId !== i.student.houseId) return { ok: false, reason: "not_within_house" };
  // J3 — the deeper invariant: even a same-House target must match the boarder's sex. Only
  // reachable if the data is incoherent (the bug the seed fix eliminates); this is the guard
  // that would have refused the shipped seed's cross-gender placements at write time.
  if (!genderAdmits(i.target.houseGender, i.student.sex))
    return { ok: false, reason: "gender_mismatch" };
  // Friendly pre-check; the partial-unique index is the real race backstop (AC D2).
  if (i.target.occupiedByOther) return { ok: false, reason: "bunk_occupied" };
  return { ok: true };
}

/** User-facing copy per rejection. `bunk_occupied` doubles as the lost-race message (AC D2). */
export const REASSIGN_MESSAGES: Record<ReassignRejection, string> = {
  missing_reason: "Enter a reason for the move.",
  invalid_target: "That bunk could not be found.",
  no_change: "The boarder is already in that bunk.",
  not_within_house: "A boarder can only be moved within their own House.",
  gender_mismatch: "That bunk's House does not match the boarder's sex.",
  bunk_occupied: "That bunk was just taken — pick another.",
};
