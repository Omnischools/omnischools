import type { JurisdictionLevel } from "@/lib/db/rls";

/**
 * The acting officer, as the audit writer and the RLS helpers need them.
 *
 * This lives in its own tiny module rather than beside the gate ON PURPOSE. `lib/auth` needs the
 * shape, every page needs `lib/auth`, and if the shape lived in
 * `lib/oversight/named-record-access.ts` then importing an officer type would pull the entire gated
 * path — and with it `lib/db/readback` — into the module graph of every aggregate page in the app.
 * Type imports are erased at build, so that would not have been a runtime leak; it would have been
 * something worse in the long run, which is an isolation boundary that only holds by accident.
 * tests/readback-isolation.test.ts checks the graph textually and caught exactly this.
 */
export interface OfficerSession {
  officerId: string;
  officerRole: string;
  /** The officer's node in `dim_jurisdiction` — the RLS ceiling. Null only at NATIONAL. */
  jurisdictionId: string | null;
  level: JurisdictionLevel;
}
