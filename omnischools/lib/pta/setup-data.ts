/**
 * SERVER-ONLY PTA setup read (SHS module 4.7 / INCR-50). Loads the four coalesced tier configs (never a
 * fabricated row — coalescePtaTiers fills R417 defaults with configured:false), the EXISTING generated
 * `ptas` instances (with the display name DERIVED from the class/House join — there is NO stored name,
 * R411), and the gen-preview DERIVED counts (a live projection of what Generate WOULD create — COUNT
 * active classes / active Houses / 1 / 0 — NOT a read of existing ptas, R417).
 *
 * Imports the DB driver via withSchool — NEVER import from a client component ([[reports-data-is-server
 * -only]]); the page passes plain pre-formatted primitives to the client editors. All reads are
 * tenant-scoped; RLS is the boundary. The read gate is admin-only (PTA_CONFIG_WRITE_ROLES) — applied by
 * the page, which redirects anyone who fails it.
 *
 * HONESTY (R417): an unconfigured school reads the coalesced defaults + configured:false, ZERO `ptas`
 * (none exist until Generate), and gen-preview counts that derive live from the class/House lists.
 */
import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { auditLog, classes, houses, ptas, ptaTiersConfig, users } from "@/db/schema";
import { roleLabel } from "@/lib/staff-roles";
import {
  coalescePtaTiers,
  type PtaStatus,
  type PtaTier,
  type PtaTierType,
} from "./defaults";

const PTA_AUDIT_ENTITIES = ["pta_tiers_config", "ptas", "pta_dues_config_history"];

export interface PtaInstanceView {
  id: string;
  tierType: PtaTierType;
  label: string;
  status: PtaStatus;
}

export interface PtaGenPreview {
  /** DERIVED projection of what Generate creates now (gated by each tier's active flag). */
  form: number;
  house: number;
  general: number;
  /** The live scope totals behind the projection (before the tier active-gate). */
  activeClasses: number;
  activeHouses: number;
}

export interface PtaSetup {
  tiers: PtaTier[];
  instances: PtaInstanceView[];
  instanceCounts: { form: number; house: number; general: number; closed: number; active: number };
  genPreview: PtaGenPreview;
  /** true once ANY tier has been configured (configured_at set) — hides the save-state until then. */
  configuredAny: boolean;
  provenance: { at: string; byName: string } | null;
}

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(d);

/** The whole PTA surface's config, pre-formatted. Read-gate (PTA_CONFIG_WRITE_ROLES) applied by the page. */
export async function getPtaSetup(schoolId: string): Promise<PtaSetup> {
  return withSchool(schoolId, async (tx) => {
    // ── Tier config (coalesced) ──
    const tierRows = await tx
      .select({
        tierType: ptaTiersConfig.tierType,
        active: ptaTiersConfig.active,
        frequencyNorm: ptaTiersConfig.frequencyNorm,
        officerRoles: ptaTiersConfig.officerRoles,
        quorumRule: ptaTiersConfig.quorumRule,
        duesEnabled: ptaTiersConfig.duesEnabled,
        duesAmount: ptaTiersConfig.duesAmount,
        duesBasis: ptaTiersConfig.duesBasis,
        duesCadence: ptaTiersConfig.duesCadence,
        tierSettings: ptaTiersConfig.tierSettings,
        configuredAt: ptaTiersConfig.configuredAt,
      })
      .from(ptaTiersConfig)
      .where(eq(ptaTiersConfig.schoolId, schoolId));
    const tiers = coalescePtaTiers(tierRows);
    const activeOf = (t: PtaTierType) => tiers.find((x) => x.tierType === t)?.active ?? false;

    // ── Live scope lists (active classes / Houses) — the gen-preview projection reads their COUNT ──
    const activeClassRows = await tx
      .select({ id: classes.id })
      .from(classes)
      .where(and(eq(classes.schoolId, schoolId), eq(classes.active, true)));
    const activeHouseRows = await tx
      .select({ id: houses.id })
      .from(houses)
      // FENCE (OC-295-A): the House-PTA preview count covers BOARDING houses only (mirrors the
      // reconcile fence in lib/actions/pta.ts) — a sports house is not a PTA governance body.
      .where(and(eq(houses.schoolId, schoolId), eq(houses.active, true), eq(houses.kind, "BOARDING")));
    const activeClasses = activeClassRows.length;
    const activeHouses = activeHouseRows.length;

    // ── Existing generated instances (name DERIVED from the join — NO stored name, R411) ──
    const instanceRows = await tx
      .select({
        id: ptas.id,
        tierType: ptas.tierType,
        status: ptas.status,
        className: classes.name,
        houseName: houses.name,
      })
      .from(ptas)
      .leftJoin(classes, and(eq(ptas.schoolId, classes.schoolId), eq(ptas.classId, classes.id)))
      .leftJoin(houses, and(eq(ptas.schoolId, houses.schoolId), eq(ptas.houseId, houses.id)))
      .where(eq(ptas.schoolId, schoolId))
      .orderBy(asc(ptas.tierType), asc(classes.name), asc(houses.name));

    const instances: PtaInstanceView[] = instanceRows.map((r) => {
      const tt = r.tierType as PtaTierType;
      const label =
        tt === "FORM"
          ? `${r.className ?? "Class"} PTA`
          : tt === "HOUSE"
            ? `${r.houseName ?? "House"} PTA`
            : tt === "GENERAL"
              ? "General PTA"
              : "Emergency PTA";
      return { id: r.id, tierType: tt, label, status: r.status as PtaStatus };
    });

    const instanceCounts = {
      form: instances.filter((i) => i.tierType === "FORM" && i.status === "ACTIVE").length,
      house: instances.filter((i) => i.tierType === "HOUSE" && i.status === "ACTIVE").length,
      general: instances.filter((i) => i.tierType === "GENERAL" && i.status === "ACTIVE").length,
      closed: instances.filter((i) => i.status === "CLOSED").length,
      active: instances.filter((i) => i.status === "ACTIVE").length,
    };

    // ── Provenance — the latest PTA audit row + its actor (omit-not-fake if none) ──
    const [prov] = await tx
      .select({
        at: auditLog.occurredAt,
        actorName: users.fullName,
        actorRole: auditLog.actorRole,
      })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.actorUserId, users.id))
      .where(and(eq(auditLog.schoolId, schoolId), inArray(auditLog.entityType, PTA_AUDIT_ENTITIES)))
      .orderBy(desc(auditLog.occurredAt))
      .limit(1);

    return {
      tiers,
      instances,
      instanceCounts,
      genPreview: {
        form: activeOf("FORM") ? activeClasses : 0,
        house: activeOf("HOUSE") ? activeHouses : 0,
        general: activeOf("GENERAL") ? 1 : 0,
        activeClasses,
        activeHouses,
      },
      configuredAny: tiers.some((t) => t.configured),
      provenance: prov
        ? {
            at: fmtDate(prov.at),
            byName: prov.actorName || (prov.actorRole ? roleLabel(prov.actorRole) : "an administrator"),
          }
        : null,
    };
  });
}
