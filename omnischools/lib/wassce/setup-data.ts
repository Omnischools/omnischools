import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import {
  wassceProgrammes,
  wassceSubjects,
  wassceCandidates,
  students,
  universities,
  universityProgrammes,
  universityTargets,
} from "@/db/schema";
import { getActiveCohort } from "@/lib/wassce/active-cohort";
import { computeCohortAggregates } from "@/lib/wassce/readiness-data";
import {
  cutOffLabel,
  cutOffDifficultyClass,
  TARGET_TIER_BANDS,
} from "@/lib/wassce/university-match";
import { PROGRAMME_ORDER, WAEC_FEE_PER_CANDIDATE, formatGhsCompact } from "@/lib/wassce/constants";
import type { WassceProgrammeKey } from "@/lib/wassce/constants";
import type { WassceRosterRow } from "@/components/senior/wassce-roster-table";

/**
 * SERVER-ONLY WASSCE setup loader (SHS module 4.3 / INCR-15). Imports the Drizzle schema / db
 * driver, so it must never be imported by a client component (repo memory `reports-data-is-server-
 * only` — only `pnpm build` catches the leak). The client roster table takes PRE-FORMATTED
 * `WassceRosterRow[]` strings; every tile/filter count returned here DERIVES from the seeded spine
 * rows (never hardcoded — Kofi AC-B/C). READ-ONLY: this module only SELECTs; it mutates nothing and
 * exposes no server action (there are none to build — AC-B).
 *
 * Accommodation shape (Ruling 2 — unstructured jsonb): `{ type, scForm, detail }`. `type` ∈
 * chronic|sight|hearing feeds the §4.3 accommodation tile + breakdown; `type='medical'` (Y. Aidoo's
 * exam-day SC-12) is the medical FLAG, NOT one of the 4 structured accommodations. Note emphasis is
 * carried by a `‖` sentinel that splits the leading bold segment from the rest (one text column).
 */

type Accommodation = {
  type?: "chronic" | "sight" | "hearing" | "medical";
  scForm?: string;
  detail?: string;
};

const REG_FLAG_DISPLAY: Record<string, { label: string; cls: string }> = {
  ON_MEDICAL: { label: "On medical", cls: "bg-warn-bg text-warn" },
  NHIS_ISSUE: { label: "NHIS issue", cls: "bg-warn-bg text-warn" },
  FEE: { label: "Fee", cls: "bg-warn-bg text-warn" },
};
const CONFIRMED = { label: "Confirmed", cls: "bg-green-bg text-green" };

// Avatar tint (client-derived from flag + accommodation — Lucy §4.5). Reproduces the 9 named rows:
// medical→terra, NHIS/fee→warn, chronic accommodation→green, otherwise navy.
function avatarClass(regFlag: string | null, accType: string | undefined): string {
  if (regFlag === "ON_MEDICAL") return "bg-terra-bg text-terra";
  if (regFlag === "NHIS_ISSUE" || regFlag === "FEE") return "bg-warn-bg text-warn";
  if (accType === "chronic") return "bg-green-bg text-green";
  return "bg-[rgba(45,63,92,0.12)] text-navy-2";
}

function initials(first: string, last: string): string {
  return `${(first[0] ?? "").toUpperCase()}${(last[0] ?? "").toUpperCase()}`;
}
function shortName(first: string, last: string): string {
  return `${(first[0] ?? "").toUpperCase()}. ${last}`;
}
function splitNote(note: string | null): { strong: string | null; rest: string } {
  if (!note) return { strong: null, rest: "" };
  const i = note.indexOf("‖");
  if (i === -1) return { strong: null, rest: note };
  return { strong: note.slice(0, i).trim(), rest: note.slice(i + 1).trim() };
}

export type WassceMatrixCard = {
  programmeKey: WassceProgrammeKey;
  candidateCount: number;
  cores: string[];
  electives: { name: string; tag: "Elec" | "Alt" }[];
};

/* ─────────────────── §3 university targets (INCR-17b) — every figure DERIVED, nothing stored ──────── */

/** One tier-band cell of the §3 strip — the cohort's projected-AGGREGATE distribution (NOT a match tier). */
export type TargetBandView = {
  key: string;
  range: string; // "6 – 12"
  name: string; // "Tier 1"
  copy: string;
  studentCount: number; // derived from the cohort's DERIVED best-3 aggregates
};

/** One §3 "Top destinations" row — a university with its derived cut-off summary + targeting tally. */
export type DestinationRowView = {
  universityId: string;
  initials: string; // "KN"
  name: string;
  locationLabel: string; // "Kumasi · public"
  medianCutOffLabel: string; // "11 (2025)" — never a bare number; "—" with no programmes
  rangeLabel: string; // "range 6–24" | "range varies"
  studentsTargeting: number; // first-choice targets on this university
  sharePctLabel: string; // "28%"
};

/** One §3 cut-off table row (the seeded published snapshot, read-only to schools). */
export type CutOffRowView = {
  programmeId: string;
  universityShortName: string;
  programmeName: string;
  cutOffLabel: string; // "11 (2025)"
  cutOffClass: string; // difficulty-coded (INVERTED: terra = hardest)
  targeted: boolean; // a candidate in this cohort has tagged it → gold-bg highlight
};

export type WassceTargetsView = {
  bands: TargetBandView[];
  destinations: DestinationRowView[];
  untaggedCount: number; // candidates with NO first-choice target — the Dean worklist
  untaggedSharePctLabel: string;
  cutOffRows: CutOffRowView[];
  referenceYears: string; // "2025" — the snapshot year(s) the table is stamped with
  taggedCandidates: number;
  totalTargets: number;
};

export type WassceSetupData = {
  cohort: { examYear: number; frozen: boolean } | null;
  centreCode: string;
  counts: {
    candidates: number;
    programmes: number;
    subjectsTotal: number;
    subjectsCore: number;
    subjectsElective: number;
    confirmed: number;
    flagged: number;
    accommodations: number;
  };
  accommodationBreakdown: string; // "2 chronic · 1 sight · 1 hearing"
  totalFeesLabel: string; // "GHS 336k"
  programmeNames: string[]; // ["Science", "Business", …] for the stat trend
  matrix: WassceMatrixCard[];
  roster: WassceRosterRow[];
  targets: WassceTargetsView; // §3 university-target config (INCR-17b)
};

const EMPTY_TARGETS: WassceTargetsView = {
  bands: TARGET_TIER_BANDS.map((b) => ({ ...b, studentCount: 0 })),
  destinations: [],
  untaggedCount: 0,
  untaggedSharePctLabel: "—",
  cutOffRows: [],
  referenceYears: "—",
  taggedCandidates: 0,
  totalTargets: 0,
};

/** Median of a sorted-able list of cut-offs (the §3 "Median cut-off" column — derived, never stored). */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

/** Whole-percent share. A non-zero count that rounds to 0 renders "<1%", never a misleading "0%". */
function pct(n: number, total: number): string {
  if (total === 0) return "—";
  const rounded = Math.round((n / total) * 100);
  return rounded === 0 && n > 0 ? "<1%" : `${rounded}%`;
}

/**
 * The §3 university-target config: the tier-band strip, the top-destinations tally, and the cut-off
 * table. Everything DERIVES — median cut-off / range / students-targeting / % F3 / band counts are all
 * computed here from the GLOBAL programme snapshot + the tenant's `university_targets`, with NO stored
 * summary column. Universities and programmes are read-only reference; only the targets are tenant data.
 */
async function loadTargetsView(
  tx: Tx,
  schoolId: string,
  cohortId: string,
  candidateIds: string[],
  derivedAgg: Map<string, number>,
): Promise<WassceTargetsView> {
  const programmes = await tx
    .select({
      programmeId: universityProgrammes.id,
      programmeName: universityProgrammes.name,
      cutOff: universityProgrammes.currentCutOff,
      year: universityProgrammes.cutOffReferenceYear,
      universityId: universities.id,
      universityName: universities.name,
      shortName: universities.shortName,
      universityType: universities.universityType,
      location: universities.location,
    })
    .from(universityProgrammes)
    .innerJoin(universities, eq(universities.id, universityProgrammes.universityId))
    .orderBy(asc(universityProgrammes.currentCutOff), asc(universities.shortName));

  // Tenant targets, restricted to THIS cohort's candidates via the composite-FK join.
  const targetRows = await tx
    .select({
      candidateId: universityTargets.candidateId,
      programmeId: universityTargets.universityProgrammeId,
      targetRank: universityTargets.targetRank,
    })
    .from(universityTargets)
    .innerJoin(
      wassceCandidates,
      and(
        eq(wassceCandidates.schoolId, universityTargets.schoolId),
        eq(wassceCandidates.id, universityTargets.candidateId),
      ),
    )
    .where(and(eq(universityTargets.schoolId, schoolId), eq(wassceCandidates.cohortId, cohortId)));

  const cohortSize = candidateIds.length;
  const universityIdByProgramme = new Map(programmes.map((p) => [p.programmeId, p.universityId]));
  const targetedProgrammeIds = new Set(targetRows.map((t) => t.programmeId));

  // Students targeting = FIRST_CHOICE targets grouped by university (the surface's "first-choice" tally).
  const firstChoiceByUniversity = new Map<string, number>();
  const candidatesWithFirstChoice = new Set<string>();
  for (const t of targetRows) {
    if (t.targetRank !== "FIRST_CHOICE") continue;
    candidatesWithFirstChoice.add(t.candidateId);
    const uid = universityIdByProgramme.get(t.programmeId);
    if (uid) firstChoiceByUniversity.set(uid, (firstChoiceByUniversity.get(uid) ?? 0) + 1);
  }

  // One row per university, ordered by how much of the cohort targets it (the surface's ordering).
  const byUniversity = new Map<string, typeof programmes>();
  for (const p of programmes) {
    const list = byUniversity.get(p.universityId) ?? [];
    list.push(p);
    byUniversity.set(p.universityId, list);
  }
  const destinations: DestinationRowView[] = [...byUniversity.values()]
    .map((list) => {
      const u = list[0];
      const cuts = list.map((p) => p.cutOff);
      const med = median(cuts);
      const targeting = firstChoiceByUniversity.get(u.universityId) ?? 0;
      return {
        universityId: u.universityId,
        initials: u.shortName.slice(0, 2).toUpperCase(),
        name: u.universityName,
        locationLabel: `${u.location} · ${u.universityType.split("_")[0].toLowerCase()}`,
        // The median is a summary OF THE SNAPSHOT — stamped with its reference year, never bare.
        medianCutOffLabel: med == null ? "—" : cutOffLabel(med, u.year),
        rangeLabel: cuts.length ? `range ${Math.min(...cuts)}–${Math.max(...cuts)}` : "range varies",
        studentsTargeting: targeting,
        sharePctLabel: pct(targeting, cohortSize),
      };
    })
    .sort((a, b) => b.studentsTargeting - a.studentsTargeting || a.name.localeCompare(b.name));

  // Tier-band counts — the cohort's DERIVED best-3 aggregates, bucketed (no stored band column).
  const bands: TargetBandView[] = TARGET_TIER_BANDS.map((b) => ({
    ...b,
    studentCount: candidateIds.filter((id) => {
      const agg = derivedAgg.get(id);
      return agg != null && agg >= b.min && (b.max == null || agg <= b.max);
    }).length,
  }));

  const untagged = cohortSize - candidatesWithFirstChoice.size;
  const years = [...new Set(programmes.map((p) => p.year))].sort();

  return {
    bands,
    destinations,
    untaggedCount: untagged,
    untaggedSharePctLabel: pct(untagged, cohortSize),
    cutOffRows: programmes.map((p) => ({
      programmeId: p.programmeId,
      universityShortName: p.shortName,
      programmeName: p.programmeName,
      cutOffLabel: cutOffLabel(p.cutOff, p.year),
      cutOffClass: cutOffDifficultyClass(p.cutOff),
      targeted: targetedProgrammeIds.has(p.programmeId),
    })),
    referenceYears: years.length ? years.join(" · ") : "—",
    taggedCandidates: new Set(targetRows.map((t) => t.candidateId)).size,
    totalTargets: targetRows.length,
  };
}

/** Load the frozen WASSCE cohort's setup surface, tenant-scoped. Call inside `withSchool(...)`. */
export async function loadWassceSetup(tx: Tx, schoolId: string): Promise<WassceSetupData> {
  // The ACTIVE cohort = the frozen cohort with the greatest exam year (getActiveCohort). Fixes Dex
  // MINOR-1: the old `asc(examYear)` first-row was right only by accident with one cohort and picks
  // the WRONG cohort once INCR-16 seeds the unfrozen F2-2027. With F3-2026 frozen it resolves to F3-2026.
  const cohort = await getActiveCohort(tx, schoolId);

  if (!cohort) {
    return {
      cohort: null,
      centreCode: "—",
      counts: {
        candidates: 0,
        programmes: 0,
        subjectsTotal: 0,
        subjectsCore: 0,
        subjectsElective: 0,
        confirmed: 0,
        flagged: 0,
        accommodations: 0,
      },
      accommodationBreakdown: "—",
      totalFeesLabel: "—",
      programmeNames: [],
      matrix: [],
      roster: [],
      targets: EMPTY_TARGETS,
    };
  }

  const programmes = await tx
    .select()
    .from(wassceProgrammes)
    .where(and(eq(wassceProgrammes.schoolId, schoolId), eq(wassceProgrammes.activeFlag, true)))
    .orderBy(asc(wassceProgrammes.createdAt));

  const subjectRows = await tx
    .select({
      name: wassceSubjects.name,
      subjectType: wassceSubjects.subjectType,
      programmeId: wassceSubjects.programmeId,
    })
    .from(wassceSubjects)
    .where(and(eq(wassceSubjects.schoolId, schoolId), eq(wassceSubjects.activeFlag, true)))
    .orderBy(asc(wassceSubjects.createdAt), asc(wassceSubjects.name));

  const candRows = await tx
    .select({
      id: wassceCandidates.id,
      firstName: students.firstName,
      lastName: students.lastName,
      studentCode: students.studentCode,
      programme: wassceProgrammes.programme,
      indexNumber: wassceCandidates.indexNumber,
      centreCode: wassceCandidates.centreCode,
      regFlag: wassceCandidates.regFlag,
      accommodations: wassceCandidates.accommodationsJson,
      note: wassceCandidates.note,
      mock2: wassceCandidates.mock2Aggregate,
    })
    .from(wassceCandidates)
    .innerJoin(
      students,
      and(eq(students.schoolId, wassceCandidates.schoolId), eq(students.id, wassceCandidates.studentId)),
    )
    .innerJoin(
      wassceProgrammes,
      and(
        eq(wassceProgrammes.schoolId, wassceCandidates.schoolId),
        eq(wassceProgrammes.id, wassceCandidates.programmeId),
      ),
    )
    .where(and(eq(wassceCandidates.schoolId, schoolId), eq(wassceCandidates.cohortId, cohort.id)));

  // The roster's Mock-2-agg column now reads the DERIVED best-3 aggregate (INCR-17 cleanup — one source
  // of truth via the pure projectAggregate lib), NOT the INCR-15 seeded static. A candidate without ≥3
  // graded cores+electives in the predictor mock is not-computable → we fall back to the seeded literal
  // (the only signal we have for them). Y. Aidoo, fully graded, now shows her real computed 10.
  const derivedAgg = await computeCohortAggregates(tx, schoolId, cohort.id);

  // --- roster rows (pre-formatted strings — the client table imports NO db) ---
  const progIdByKey = new Map(programmes.map((p) => [p.programme as WassceProgrammeKey, p.id]));
  const roster: WassceRosterRow[] = candRows.map((c) => {
    const acc = (c.accommodations ?? undefined) as Accommodation | undefined;
    const accType = acc?.type;
    const structuralAcc = accType === "chronic" || accType === "sight" || accType === "hearing";
    const { strong, rest } = splitNote(c.note);
    const flag = c.regFlag ? REG_FLAG_DISPLAY[c.regFlag] : CONFIRMED;
    return {
      id: c.id,
      name: shortName(c.firstName, c.lastName),
      studentCode: c.studentCode,
      initials: initials(c.firstName, c.lastName),
      avatarClass: avatarClass(c.regFlag, accType),
      programmeKey: c.programme as WassceProgrammeKey,
      indexNumber: c.indexNumber,
      indexSub: acc?.scForm === "SC-12" ? "SC-12 filed" : null,
      regStatusLabel: flag.label,
      regStatusClass: flag.cls,
      noteStrong: strong,
      note: rest,
      mock2Agg: derivedAgg.has(c.id)
        ? String(derivedAgg.get(c.id))
        : c.mock2 == null
          ? "—"
          : String(c.mock2),
      isLive: c.regFlag === "ON_MEDICAL",
      isFlagged: c.regFlag != null,
      hasAccommodation: structuralAcc,
    };
  });

  // --- derived counts (all off real rows) ---
  const flagged = roster.filter((r) => r.isFlagged).length;
  const accommodations = roster.filter((r) => r.hasAccommodation).length;
  const accByType = { chronic: 0, sight: 0, hearing: 0 };
  for (const c of candRows) {
    const t = (c.accommodations as Accommodation | null)?.type;
    if (t === "chronic" || t === "sight" || t === "hearing") accByType[t]++;
  }
  const accommodationBreakdown =
    accommodations === 0
      ? "—"
      : [
          accByType.chronic ? `${accByType.chronic} chronic` : null,
          accByType.sight ? `${accByType.sight} sight` : null,
          accByType.hearing ? `${accByType.hearing} hearing` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  // Distinct-display subject counts (Kofi K1 — "23 · 4 core · 19 elec" is a distinct-name count).
  const coreNames = new Set<string>();
  const elecNames = new Set<string>();
  for (const s of subjectRows) {
    if (s.subjectType === "CORE") coreNames.add(s.name);
    else elecNames.add(s.name);
  }

  // --- matrix cards (§1.4) — real subjects per programme, candidate count derived ---
  const candCountByKey = new Map<WassceProgrammeKey, number>();
  for (const c of candRows) {
    const k = c.programme as WassceProgrammeKey;
    candCountByKey.set(k, (candCountByKey.get(k) ?? 0) + 1);
  }
  const matrix: WassceMatrixCard[] = PROGRAMME_ORDER.filter((k) => progIdByKey.has(k)).map((key) => {
    const pid = progIdByKey.get(key)!;
    const subs = subjectRows.filter((s) => s.programmeId === pid);
    return {
      programmeKey: key,
      candidateCount: candCountByKey.get(key) ?? 0,
      cores: subs.filter((s) => s.subjectType === "CORE").map((s) => s.name),
      electives: subs
        .filter((s) => s.subjectType !== "CORE")
        .map((s) => ({ name: s.name, tag: s.subjectType === "OPTIONAL" ? "Alt" : "Elec" })),
    };
  });

  const programmeNames = PROGRAMME_ORDER.filter((k) => progIdByKey.has(k)).map(
    (k) => programmes.find((p) => (p.programme as WassceProgrammeKey) === k)!.name,
  );

  return {
    cohort: { examYear: cohort.examYear, frozen: cohort.setupFrozenAt != null },
    centreCode: candRows[0]?.centreCode ?? "—",
    counts: {
      candidates: candRows.length,
      programmes: programmes.length,
      subjectsTotal: coreNames.size + elecNames.size,
      subjectsCore: coreNames.size,
      subjectsElective: elecNames.size,
      confirmed: candRows.length - flagged,
      flagged,
      accommodations,
    },
    accommodationBreakdown,
    totalFeesLabel: formatGhsCompact(candRows.length * WAEC_FEE_PER_CANDIDATE),
    programmeNames,
    matrix,
    roster,
    targets: await loadTargetsView(
      tx,
      schoolId,
      cohort.id,
      candRows.map((c) => c.id),
      derivedAgg,
    ),
  };
}
