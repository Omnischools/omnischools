/**
 * SERVER-ONLY VLC setup read (SHS module 4.5 / INCR-40). Loads the per-school programme (coalesced to
 * lib/vlc/defaults when no vlc_programme row — the sickbay-config idiom, never a fabricated row), the
 * taught values ordered by ordinal, and their session templates, then pre-shapes everything the setup
 * surface renders. Imports the DB driver via withSchool — NEVER import from a client component; the
 * page passes plain serializable props to the client editors. All reads are tenant-scoped; RLS is the
 * boundary. Counts are DERIVED here (value count, session count), never a stored scalar.
 */
import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { academicPeriod, classes, vlcProgramme, vlcSessionTemplate, vlcValue } from "@/db/schema";
import {
  coalesceVlcProgramme,
  VLC_VALUES,
  type VlcProgramme,
} from "./defaults";

export interface VlcSessionView {
  /** null = a coalesced default on an unseeded school (read-only — no row to edit). */
  id: string | null;
  slot: "A" | "B";
  title: string;
  prompt: string | null;
}

export interface VlcValueView {
  id: string | null;
  ordinal: number;
  nameEn: string;
  nameTwi: string | null;
  /** Frozen editorial (the vc-twi tail) attached by ordinal — not a stored column. */
  descriptor: string | null;
  termGroup: number;
  capstone: boolean;
  sessionA: VlcSessionView | null;
  sessionB: VlcSessionView | null;
}

export interface VlcSetup {
  academicYear: string;
  programme: VlcProgramme;
  values: VlcValueView[];
  valueCount: number;
  sessionCount: number;
  classCount: number;
  /** false when the school has never declared a schedule (vlc_programme.configured_at IS NULL). */
  configured: boolean;
}

const toSlot = (s: string): "A" | "B" => (s === "B" ? "B" : "A");

/** The whole surface's config, pre-formatted. Read-gate applied by the page. */
export async function getVlcSetup(schoolId: string): Promise<VlcSetup> {
  return withSchool(schoolId, async (tx) => {
    const [progRow] = await tx
      .select({
        sessionDay: vlcProgramme.sessionDay,
        sessionStart: vlcProgramme.sessionStart,
        openerMin: vlcProgramme.openerMin,
        smallGroupMin: vlcProgramme.smallGroupMin,
        plenaryMin: vlcProgramme.plenaryMin,
        reflectionMin: vlcProgramme.reflectionMin,
        closeMin: vlcProgramme.closeMin,
        configuredAt: vlcProgramme.configuredAt,
      })
      .from(vlcProgramme)
      .where(eq(vlcProgramme.schoolId, schoolId))
      .limit(1);

    const valueRows = await tx
      .select({
        id: vlcValue.id,
        ordinal: vlcValue.ordinal,
        nameEn: vlcValue.nameEn,
        nameTwi: vlcValue.nameTwi,
        // #296 — descriptor / is_capstone are now STORED columns (backfilled from VLC_VALUES by ordinal in
        // migration 0085), NOT attached ordinal-keyed from the frozen lib: under a reorder the ordinal key
        // breaks, so a stored value is the only reorder-safe source.
        descriptor: vlcValue.descriptor,
        isCapstone: vlcValue.isCapstone,
        termGroup: vlcValue.termGroup,
      })
      .from(vlcValue)
      .where(and(eq(vlcValue.schoolId, schoolId), eq(vlcValue.active, true)))
      .orderBy(asc(vlcValue.ordinal));

    const templateRows = await tx
      .select({
        id: vlcSessionTemplate.id,
        valueId: vlcSessionTemplate.valueId,
        slot: vlcSessionTemplate.slot,
        title: vlcSessionTemplate.title,
        prompt: vlcSessionTemplate.prompt,
      })
      .from(vlcSessionTemplate)
      .where(and(eq(vlcSessionTemplate.schoolId, schoolId), eq(vlcSessionTemplate.active, true)));

    const [classAgg] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(classes)
      .where(eq(classes.schoolId, schoolId));

    const yearRows = await tx
      .selectDistinct({ y: academicPeriod.academicYear })
      .from(academicPeriod)
      .where(eq(academicPeriod.schoolId, schoolId));

    const programme = coalesceVlcProgramme(progRow ?? null);
    const academicYear =
      yearRows.map((r) => r.y).sort((a, b) => b.localeCompare(a))[0] ?? "2025/26";

    let values: VlcValueView[];
    if (valueRows.length === 0) {
      // Unseeded school → coalesce to the canonical 11 (read-only, no ids). The seed + onboarding
      // provision every SHS, so this is Lucy's empty-state fallback, never fabricated capacity.
      values = VLC_VALUES.map((v) => ({
        id: null,
        ordinal: v.ordinal,
        nameEn: v.nameEn,
        nameTwi: v.nameTwi,
        descriptor: v.descriptor,
        termGroup: v.termGroup,
        capstone: v.capstone,
        sessionA: { id: null, slot: "A", title: v.sessions[0].title, prompt: v.sessions[0].prompt },
        sessionB: { id: null, slot: "B", title: v.sessions[1].title, prompt: v.sessions[1].prompt },
      }));
    } else {
      const bySlot = new Map(templateRows.map((t) => [`${t.valueId}:${toSlot(t.slot)}`, t]));
      values = valueRows.map((v) => {
        const a = bySlot.get(`${v.id}:A`);
        const b = bySlot.get(`${v.id}:B`);
        return {
          id: v.id,
          ordinal: v.ordinal,
          nameEn: v.nameEn,
          nameTwi: v.nameTwi,
          descriptor: v.descriptor,
          termGroup: v.termGroup,
          capstone: v.isCapstone,
          sessionA: a ? { id: a.id, slot: "A", title: a.title, prompt: a.prompt } : null,
          sessionB: b ? { id: b.id, slot: "B", title: b.title, prompt: b.prompt } : null,
        };
      });
    }

    const valueCount = values.length;
    const sessionCount = values.reduce(
      (n, v) => n + (v.sessionA ? 1 : 0) + (v.sessionB ? 1 : 0),
      0,
    );

    return {
      academicYear,
      programme,
      values,
      valueCount,
      sessionCount,
      classCount: classAgg?.n ?? 0,
      configured: programme.configured,
    };
  });
}
