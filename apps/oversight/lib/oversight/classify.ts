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
 * THE DECISION IS MADE FROM THE GES ESTABLISHMENT REGISTER. NOTHING ELSE. (AC-3.1)
 *
 * Membership of the CURRENT vintage's `ref_ges_teacher_establishment.establishment_teachers` — an
 * existence test over `establishment_teachers[].ntc_licence_number` for that `emis_school_id` — is
 * the whole test. The key is the **NTC teacher-licence number** (Ghana's licensure identifier),
 * which is carried by the operational `staff_profile.ntc_licence_number` of the row being fetched;
 * the caller reads it there and passes it in (see lib/oversight/named-record-access.ts), so the
 * licence that confers statute is bound to the exact person projected. Two tempting alternatives are
 * BOTH WRONG and are explicitly not used (AC-3.11 — role is not statute):
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
 * ANALYTICS REGISTER, KEYED ON THE OPERATIONAL LICENCE. The register lives in the ANALYTICS database
 * (db/schema/ref.ts, loaded per PROVISIONING §3) and is read over `ANALYTICS_DATABASE_URL` under the
 * ordinary jurisdiction RLS — it is explicitly ruled OUT of the operational read-back grant. The NTC
 * licence the membership turns on is NOT request-supplied: it comes from the operational row itself
 * (AC-3.4/3.5). So this classification runs as a nested analytics read from inside the read-back
 * transaction (AC-3.6), once the caller has read the licence off the row it is about to project.
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
  /** The subject's NTC licence is not in the school's current-vintage establishment_teachers. */
  | "NOT_ON_REGISTER"
  /** The school has no establishment row at all (never supplied, or not yet loaded). */
  | "NO_ESTABLISHMENT_ROW"
  /** A row exists and names the subject, but its `as_of_date` breaches the ceiling above. */
  | "STALE_ESTABLISHMENT"
  /** The operational row carried no NTC licence number, so register membership cannot be asked. */
  | "NO_NTC_LICENCE";

export type Classification =
  | {
      category: "GES_TEACHER";
      establishmentAsOfDate: string;
      teachingPostsEstablished: number | null;
      ageInDays: number;
      /**
       * The `name` on the matched `establishment_teachers` entry, or null when GES supplied none.
       * An optional display aid, NEVER authoritative — the caller cross-checks it against the
       * operational name as a detective control (OC-NTC-RESIDUAL) and falls to CONSENT on mismatch.
       */
      establishmentName: string | null;
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
  /**
   * The subject's NTC licence number, read from their operational `staff_profile` row. Null when
   * that row carries no licence — a staff member with no NTC licence cannot be on the register.
   */
  ntcLicenceNumber: string | null;
  /** Injectable clock — tests pin the staleness boundary; production passes nothing. */
  now?: Date;
}

interface EstablishmentRow {
  establishment_id: string;
  teaching_posts_established: number | null;
  as_of_date: string;
  on_register: boolean;
  /** The `name` on the matched establishment_teachers entry, null if absent or not on register. */
  matched_name: string | null;
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

  if (!input.ntcLicenceNumber || input.ntcLicenceNumber.trim() === "") {
    return {
      category: "OTHER_STAFF",
      reason: "NO_NTC_LICENCE",
      establishmentAsOfDate: null,
      ageInDays: null,
    };
  }

  const ntc = input.ntcLicenceNumber.trim();
  let rows: EstablishmentRow[];
  try {
    // Membership is an EXISTENCE test over establishment_teachers[].ntc_licence_number, and the
    // matched entry's optional `name` is returned alongside for the caller's identity cross-check.
    // `coalesce(..., '[]')` keeps a NULL establishment_teachers from erroring the expansion.
    const result = await tx.execute(sql`
      select
        establishment_id::text            as establishment_id,
        teaching_posts_established        as teaching_posts_established,
        as_of_date::text                  as as_of_date,
        exists (
          select 1
          from jsonb_array_elements(coalesce(establishment_teachers, '[]'::jsonb)) e
          where e->>'ntc_licence_number' = ${ntc}
        )                                 as on_register,
        (
          select e->>'name'
          from jsonb_array_elements(coalesce(establishment_teachers, '[]'::jsonb)) e
          where e->>'ntc_licence_number' = ${ntc}
          limit 1
        )                                 as matched_name
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
    establishmentName: row.matched_name,
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
