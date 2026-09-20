/**
 * SERVER-ONLY read API for sickbay setup §04 (SHS module 4.4 / INCR-25a) — the referral hospitals a
 * school routes serious cases to. Imports the DB driver via `withSchool`, so it must NEVER be imported
 * by a client component: the setup page fetches through this reader and hands the client
 * `hospitals-console` the PRE-SHAPED `HospitalView[]` (never a `*-reads` import).
 *
 * 🔴 No PII: a hospital is config (name · distance · services · accepts_nhis · is_primary · tags).
 * Mode-independent (R198) — a REFERRAL_ONLY school configures these too, so nothing is capability-gated.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { sickbayHospital } from "@/db/schema";
import type { HospitalView } from "./hospitals";

/** Every hospital for the school (active + inactive), primary first then by name — the §04 list. */
export async function getSickbayHospitals(schoolId: string): Promise<HospitalView[]> {
  return withSchool(schoolId, async (tx) => {
    const rows = await tx
      .select({
        id: sickbayHospital.id,
        name: sickbayHospital.name,
        distanceKm: sickbayHospital.distanceKm,
        services: sickbayHospital.services,
        notes: sickbayHospital.notes,
        isPrimary: sickbayHospital.isPrimary,
        acceptsNhis: sickbayHospital.acceptsNhis,
        tags: sickbayHospital.tags,
        active: sickbayHospital.active,
      })
      .from(sickbayHospital)
      .where(eq(sickbayHospital.schoolId, schoolId));
    return rows
      .map((r) => ({
        id: r.id,
        name: r.name,
        // numeric round-trips as a string in pg — Number() at the boundary, once.
        distanceKm: r.distanceKm === null ? null : Number(r.distanceKm),
        services: r.services,
        notes: r.notes,
        isPrimary: r.isPrimary,
        acceptsNhis: r.acceptsNhis,
        tags: r.tags ?? [],
        active: r.active,
      }))
      .sort((a, b) => {
        if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  });
}
