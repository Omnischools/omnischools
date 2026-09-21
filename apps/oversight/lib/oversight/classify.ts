import { sql } from "drizzle-orm";
import { withJurisdiction, type JurisdictionScope } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";

/**
 * SUBJECT CLASSIFICATION — `GES_TEACHER` | `OTHER_STAFF` (§6, Lucy C3).
 *
 * This is the single decision that selects the lawful basis for an individual drill-down:
 *   GES_TEACHER  → STATUTORY. GES oversight of its own establishment is mandatory by law; there is
 *                  no per-school consent to gate on, and none is asked for. Works at every
 *                  ownership type, including private and mission schools.
 *   OTHER_STAFF  → CONSENT. The access rests entirely on a live school-DPO consent artefact in the
 *                  OPERATIONAL database (lib/oversight/consent.ts).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE DECISION IS MADE FROM THE GES ESTABLISHMENT REGISTER. NOTHING ELSE.
 *
 * Membership of `ref_ges_teacher_establishment.staff_ids` for that `emis_school_id` is the whole
 * test. Two tempting alternatives are BOTH WRONG and are explicitly not used:
 *
 *   · `ref_role.code` — a school's own role catalogue, free text, editable by a school admin
 *     (apps/web db/schema/identity.ts: "schools can add custom roles on the fly"). If the statutory
 *     basis keyed on it, a school could confer or remove GES's statutory reach over an employee by
 *     renaming a role, and a private school could place every employee beyond consent by calling
 *     them all "Teacher". Whether someone is on the GES establishment is not a fact a school owns.
 *
 *   · `salary_status` (`GES_PAID` on `staff_compensation`) — payroll status, not establishment
 *     status. The two diverge in both directions: a seconded teacher can be mid-transfer and
 *     off-payroll while still established, and a school can mark someone GES_PAID in error. It is
 *     also on the compensation table, which this product never reads (field-scope.ts
 *     NEVER_RELEASE_FIELDS, and PROVISIONING §4a grants no SELECT on it) — keying a lawful basis on
 *     a table we have deliberately made ourselves unable to read would be incoherent.
 *
 * ANALYTICS, NOT READ-BACK. The register lives in the ANALYTICS database (db/schema/ref.ts, loaded
 * per PROVISIONING §3) and is read over `ANALYTICS_DATABASE_URL` under the ordinary jurisdiction
 * RLS. It is explicitly ruled OUT of the operational read-back grant (PROVISIONING §4a, closing
 * note). So classification happens BEFORE the read-back transaction is opened, and a subject can be
 * classified — and refused — without any operational connection existing at all.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */

/** The server-derived subject class stored on `audit_access_log.staff_category`. */
export type StaffCategory = "GES_TEACHER" | "OTHER_STAFF";

/**
 * STALENESS CEILING — six months.
 *
 * The register is an event-driven extract, not a nightly feed (§7 step 5): if GES stops supplying
 * it, the file on disk keeps answering "yes, established" long after the posting ended. An
 * indefinitely-trusted extract is how a statutory basis becomes a historical one.
 *
 * Six months is one school term plus a margin — long enough that a normal supply cadence never
 * trips it, short enough that a subject who left GES employment a year ago cannot still be read
 * under statute. When the ceiling is breached the STATUTORY branch is REFUSED and the subject falls
 * through to OTHER_STAFF, i.e. to the consent branch. That is fail-closed in the only direction
 * that matters: the strong basis needs fresh evidence, the weak one needs a live consent row, and a
 * GES teacher at a school with no consent therefore has no path at all and is denied. A stale file
 * must narrow what Oversight may do, never widen it.
 */
export const ESTABLISHMENT_STALENESS_CEILING_MONTHS = 6;

/** Why a subject is not on the statutory branch. Recorded so a denial can explain itself. */
export type OtherStaffReason =
  /** No `staff_ids` entry for this subject in the school's current register row. */
  | "NOT_ON_REGISTER"
  /** The school has no establishment row at all (never supplied, or not yet loaded). */
  | "NO_ESTABLISHMENT_ROW"
  /** A row exists and names the subject, but its `as_of_date` breaches the ceiling above. */
  | "STALE_ESTABLISHMENT"
  /** The lookup carried no GES staff identifier, so register membership cannot even be asked. */
  | "NO_STAFF_IDENTIFIER";

export type Classification =
  | {
      category: "GES_TEACHER";
      establishmentAsOfDate: string;
      teachingPostsEstablished: number | null;
      ageInDays: number;
    }
  | {
      category: "OTHER_STAFF";
      reason: OtherStaffReason;
      establishmentAsOfDate: string | null;
      ageInDays: number | null;
    }
  /**
   * The register could not be read (query error, RLS refusal, connection loss). NOT the same as
   * OTHER_STAFF: we do not know, so we neither claim statute nor offer the consent branch. The
   * orchestrator turns this into a logged denial. Fail closed on indeterminacy.
   */
  | { category: "INDETERMINATE"; error: string };

export interface ClassifyInput {
  emisSchoolId: string;
  /** The GES establishment staff ID being looked up. Null when the gate had no GES-side id. */
  gesStaffId: string | null;
  /** Injectable clock — tests pin the staleness boundary; production passes nothing. */
  now?: Date;
}

interface EstablishmentRow {
  establishment_id: string;
  teaching_posts_established: number | null;
  as_of_date: string;
  on_register: boolean;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/** The ceiling expressed in days, computed from `now` so month lengths are handled honestly. */
function stalenessCutoff(now: Date): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - ESTABLISHMENT_STALENESS_CEILING_MONTHS);
  return cutoff;
}

/**
 * Classify inside an existing jurisdiction-scoped transaction.
 *
 * The register row read is the MOST RECENT `as_of_date` for the school. Older rows are prior
 * vintages of the same extract, not additional evidence: if the current vintage does not name the
 * subject, the subject is not currently established, and reaching back to a superseded file to find
 * a "yes" would defeat the staleness ceiling by another route.
 */
export async function classifyStaffSubjectInTx(
  tx: Tx,
  input: ClassifyInput,
): Promise<Classification> {
  const now = input.now ?? new Date();

  if (!input.gesStaffId || input.gesStaffId.trim() === "") {
    return {
      category: "OTHER_STAFF",
      reason: "NO_STAFF_IDENTIFIER",
      establishmentAsOfDate: null,
      ageInDays: null,
    };
  }

  const staffId = input.gesStaffId.trim();
  let rows: EstablishmentRow[];
  try {
    const result = await tx.execute(sql`
      select
        establishment_id::text            as establishment_id,
        teaching_posts_established        as teaching_posts_established,
        as_of_date::text                  as as_of_date,
        (staff_ids @> ${JSON.stringify([staffId])}::jsonb) as on_register
      from ref_ges_teacher_establishment
      where emis_school_id = ${input.emisSchoolId}
      order by as_of_date desc
      limit 1
    `);
    rows = (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as EstablishmentRow[];
  } catch (err) {
    return {
      category: "INDETERMINATE",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const row = rows[0];
  if (!row) {
    return {
      category: "OTHER_STAFF",
      reason: "NO_ESTABLISHMENT_ROW",
      establishmentAsOfDate: null,
      ageInDays: null,
    };
  }

  const asOf = new Date(`${row.as_of_date}T00:00:00Z`);
  const ageInDays = daysBetween(asOf, now);

  // Staleness is checked BEFORE membership, so a stale file cannot confer the statutory branch even
  // on a subject it names — and the denial says "stale", not "not on the register", which are
  // different facts about the world and lead an auditor to different places.
  if (asOf.getTime() < stalenessCutoff(now).getTime()) {
    return {
      category: "OTHER_STAFF",
      reason: "STALE_ESTABLISHMENT",
      establishmentAsOfDate: row.as_of_date,
      ageInDays,
    };
  }

  if (!row.on_register) {
    return {
      category: "OTHER_STAFF",
      reason: "NOT_ON_REGISTER",
      establishmentAsOfDate: row.as_of_date,
      ageInDays,
    };
  }

  return {
    category: "GES_TEACHER",
    establishmentAsOfDate: row.as_of_date,
    teachingPostsEstablished: row.teaching_posts_established,
    ageInDays,
  };
}

/** Convenience wrapper that opens its own jurisdiction-scoped analytics transaction. */
export async function classifyStaffSubject(
  scope: JurisdictionScope,
  input: ClassifyInput,
): Promise<Classification> {
  try {
    return await withJurisdiction(scope, (tx) => classifyStaffSubjectInTx(tx, input));
  } catch (err) {
    return {
      category: "INDETERMINATE",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** True only for the statutory branch. Every other state — including INDETERMINATE — is false. */
export function isStatutorySubject(
  c: Classification,
): c is Extract<Classification, { category: "GES_TEACHER" }> {
  return c.category === "GES_TEACHER";
}
