import "../_loadenv";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, schools, vlcProgramme, vlcSessionTemplate, vlcValue } from "@/db/schema";
import { VLC_CADENCE, VLC_PHASES, VLC_VALUES, vlcSessionCount } from "@/lib/vlc/defaults";

/**
 * VLC F0 (INCR-40) demo seed for Asankrangwa — the config the setup surface draws: ONE configured
 * programme row (the Wednesday 2:30 PM cadence + the five phase durations) + the canonical 11 values
 * + their 22 session templates, all from lib/vlc/defaults (the frozen source of truth). Nothing
 * operational: no session, no attendance, no journal, no pastoral flag (INCR-41+).
 *
 * MARKER-SCOPED + RE-RUN-SAFE. The three vlc_* tables belong to this module alone, so a school-scoped
 * wipe is safe here in the way a `where schoolId` on a shared table never is (repo memory
 * `seed-cleanup-must-be-scoped`). Cleanup touches ONLY this school's vlc rows; academic_period,
 * classes and everything else are read-only here. Idempotent.
 *
 * `pnpm db:seed-vlc` — run AFTER `pnpm db:seed`.
 */

const GES_CODE = "WR-WAW-014";
const minOf = (field: string) => VLC_PHASES.find((p) => p.field === field)!.defaultMin;

async function main() {
  const [school] = await db
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.gesCode, GES_CODE));
  if (!school) {
    console.error("✗ Asankrangwa not seeded yet — run `pnpm db:seed` first.");
    process.exit(1);
  }
  const schoolId = school.id;

  // ---- 1) Marker-scoped cleanup, child → parent (templates → values → programme). ----
  await db.delete(vlcSessionTemplate).where(eq(vlcSessionTemplate.schoolId, schoolId));
  await db.delete(vlcValue).where(eq(vlcValue.schoolId, schoolId));
  await db.delete(vlcProgramme).where(eq(vlcProgramme.schoolId, schoolId));

  // ---- 2) The programme row — Wednesday 2:30 PM, the 5 default durations, configured. ----
  await db.insert(vlcProgramme).values({
    schoolId,
    sessionDay: VLC_CADENCE.sessionDay,
    sessionStart: VLC_CADENCE.sessionStart,
    openerMin: minOf("openerMin"),
    smallGroupMin: minOf("smallGroupMin"),
    plenaryMin: minOf("plenaryMin"),
    reflectionMin: minOf("reflectionMin"),
    closeMin: minOf("closeMin"),
    configuredAt: new Date(),
  });

  // ---- 3) The 11 values (returning ids), then the 22 templates keyed to them. ----
  const valueRows = await db
    .insert(vlcValue)
    .values(
      VLC_VALUES.map((v) => ({
        schoolId,
        ordinal: v.ordinal,
        nameEn: v.nameEn,
        nameTwi: v.nameTwi,
        termGroup: v.termGroup,
      })),
    )
    .returning({ id: vlcValue.id, ordinal: vlcValue.ordinal });
  const idByOrdinal = new Map(valueRows.map((r) => [r.ordinal, r.id]));

  await db.insert(vlcSessionTemplate).values(
    VLC_VALUES.flatMap((v) =>
      v.sessions.map((s) => ({
        schoolId,
        valueId: idByOrdinal.get(v.ordinal)!,
        slot: s.slot,
        title: s.title,
        prompt: s.prompt,
      })),
    ),
  );

  await db.insert(auditLog).values({
    schoolId,
    actorRole: "ADMIN",
    actionType: "created",
    entityType: "vlc_programme",
    entityId: schoolId,
    afterState: {
      cadence: `${VLC_CADENCE.sessionDay}·${VLC_CADENCE.sessionStart}`,
      values: VLC_VALUES.length,
      sessions: vlcSessionCount(VLC_VALUES),
    },
    reason: "VLC F0 demo seed (INCR-40)",
  });

  console.log(
    `✓ Seeded VLC — Wednesday ${VLC_CADENCE.sessionStart} programme, ${VLC_VALUES.length} values, ` +
      `${vlcSessionCount(VLC_VALUES)} session templates.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ VLC seed failed:", err);
    process.exit(1);
  });
