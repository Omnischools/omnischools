import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import {
  wassceProgrammes,
  wassceSubjects,
  wassceCandidates,
  students,
} from "@/db/schema";
import { getActiveCohort } from "@/lib/wassce/active-cohort";
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
};

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
      mock2Agg: c.mock2 == null ? "—" : String(c.mock2),
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
  };
}
