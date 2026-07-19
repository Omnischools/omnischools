import "../_loadenv";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  schools,
  users,
  auditLog,
  wassceCandidates,
  universities,
  universityProgrammes,
  universityTargets,
} from "@/db/schema";
import {
  matchTally,
  matchTier,
  type MatchTier,
  type PrerequisiteRule,
} from "@/lib/wassce/university-match";

/**
 * WASSCE university-targets seed (SHS module 4.3 / INCR-17b) — the §6 match tiles + the §3 cut-off
 * table, made REAL. Run AFTER `db:seed` + `db:seed-wassce` + `db:seed-wassce-mock` +
 * `db:seed-wassce-readiness`. `pnpm db:seed-wassce-university`.
 *
 * MARKER-SCOPED + RE-RUN-SAFE (repo memory `seed-not-idempotent`): the GLOBAL reference rows
 * (universities / university_programmes) are UPSERTED by their natural key, and the only DELETE is of
 * `university_targets` for THIS school's WASSCE candidates. It never broadens a delete beyond the INCR-17b
 * markers and never touches another module's seed.
 *
 * THE CANONICAL FIXTURE (Kofi AC4/AC18): Y. Aidoo (projected aggregate 10, frozen by INCR-17) tags the
 * five §6 programmes — KNUST Biochemistry 11 (FIRST_CHOICE → the TARGET overlay), Legon Biochemistry 12,
 * KNUST Pharmacy 8, Legon Medicine 6, UCC Biochemistry 14 — reproducing the surface header EXACTLY:
 * "1 target · 1 comfortable · 2 stretch · 1 safety". The seed ASSERTS that tally and fails loudly otherwise.
 *
 * PREREQUISITES (Kofi R6 / AC17): EVERY programme carries the universal English Language ≥ C6 +
 * Mathematics (Core) ≥ C6 admission baseline — that is where the "pure best-3 vs the Ghana admission
 * rule" concern is encoded, in DATA, not in a second aggregate. KNUST Biochemistry additionally carries
 * Integrated Science + Chemistry + Biology credits and an `anyOf` group ("Physics OR Elective
 * Mathematics") so the alternation is exercised by the live board, not only by the unit test.
 */

/** The universal admission baseline every programme requires (AC17) — English + Core Maths at credit. */
const BASE: PrerequisiteRule[] = [
  { subject: "English Language", minGrade: "C6" },
  { subject: "Mathematics (Core)", minGrade: "C6" },
];
const credit = (...subjects: string[]): PrerequisiteRule[] =>
  subjects.map((subject) => ({ subject, minGrade: "C6" as const }));
const either = (...anyOf: string[]): PrerequisiteRule => ({ anyOf, minGrade: "C6" });

type UniversitySeed = {
  key: string;
  name: string;
  shortName: string;
  universityType:
    | "PUBLIC_UNIVERSITY"
    | "PRIVATE_UNIVERSITY"
    | "TECHNICAL_UNIVERSITY"
    | "POLYTECHNIC"
    | "NURSING_COLLEGE"
    | "EDUCATION_COLLEGE";
  location: string;
  region: string;
};

const UNIVERSITIES: UniversitySeed[] = [
  {
    key: "KNUST",
    name: "Kwame Nkrumah University of Science and Technology",
    shortName: "KNUST",
    universityType: "PUBLIC_UNIVERSITY",
    location: "Kumasi",
    region: "Ashanti",
  },
  {
    key: "LEGON",
    name: "University of Ghana",
    shortName: "Legon",
    universityType: "PUBLIC_UNIVERSITY",
    location: "Accra",
    region: "Greater Accra",
  },
  {
    key: "UCC",
    name: "University of Cape Coast",
    shortName: "UCC",
    universityType: "PUBLIC_UNIVERSITY",
    location: "Cape Coast",
    region: "Central",
  },
  {
    key: "UEW",
    name: "University of Education, Winneba",
    shortName: "UEW",
    universityType: "PUBLIC_UNIVERSITY",
    location: "Winneba",
    region: "Central",
  },
  {
    key: "TTU",
    name: "Takoradi Technical University",
    shortName: "Takoradi Tech",
    universityType: "TECHNICAL_UNIVERSITY",
    location: "Takoradi",
    region: "Western",
  },
  {
    key: "UDS",
    name: "University for Development Studies",
    shortName: "UDS",
    universityType: "PUBLIC_UNIVERSITY",
    location: "Tamale",
    region: "Northern",
  },
];

type ProgrammeSeed = {
  university: string;
  name: string;
  qualification: string;
  durationYears: number | null;
  cutOff: number;
  referenceYear: number;
  history: { year: number; cutOff: number }[];
  prerequisites: PrerequisiteRule[];
};

/**
 * The §6 five (exact cut-offs, AC18) + the §3 cut-off table's remaining rows. Every cut-off carries its
 * reference year AND a multi-year history — the "Trend · stable 3 yrs" chip is only ever rendered from a
 * real ≥2-entry series (a single-year snapshot renders NO trend; that is the honesty rule).
 */
const PROGRAMMES: ProgrammeSeed[] = [
  // ---- the five §6 match tiles (verbatim cut-offs) ----
  {
    university: "KNUST",
    name: "Biochemistry",
    qualification: "B.Sc.",
    durationYears: 4,
    cutOff: 11,
    referenceYear: 2025,
    history: [
      { year: 2023, cutOff: 11 },
      { year: 2024, cutOff: 11 },
      { year: 2025, cutOff: 11 },
    ],
    // The primary target — the ONLY seeded programme with an `anyOf` alternation, so the live §6 board
    // exercises "Physics OR Elective Mathematics" and not just the unit test.
    prerequisites: [
      ...BASE,
      ...credit("Integrated Science", "Chemistry", "Biology"),
      either("Physics", "Elective Mathematics"),
    ],
  },
  {
    university: "LEGON",
    name: "Biochemistry",
    qualification: "B.Sc.",
    durationYears: 4,
    cutOff: 12,
    referenceYear: 2025,
    history: [
      { year: 2023, cutOff: 13 },
      { year: 2024, cutOff: 12 },
      { year: 2025, cutOff: 12 },
    ],
    prerequisites: [...BASE, ...credit("Integrated Science", "Chemistry", "Biology")],
  },
  {
    university: "KNUST",
    name: "Pharmacy",
    qualification: "PharmD",
    durationYears: 6,
    cutOff: 8,
    referenceYear: 2025,
    history: [
      { year: 2023, cutOff: 9 },
      { year: 2024, cutOff: 8 },
      { year: 2025, cutOff: 8 },
    ],
    prerequisites: [...BASE, ...credit("Integrated Science", "Chemistry", "Biology", "Physics")],
  },
  {
    university: "LEGON",
    name: "Medicine",
    qualification: "MB ChB",
    durationYears: 6,
    cutOff: 6,
    referenceYear: 2025,
    history: [
      { year: 2023, cutOff: 6 },
      { year: 2024, cutOff: 6 },
      { year: 2025, cutOff: 6 },
    ],
    prerequisites: [...BASE, ...credit("Integrated Science", "Chemistry", "Biology", "Physics")],
  },
  {
    university: "UCC",
    name: "Biochemistry",
    qualification: "B.Sc.",
    durationYears: 4,
    cutOff: 14,
    referenceYear: 2025,
    history: [
      { year: 2023, cutOff: 15 },
      { year: 2024, cutOff: 14 },
      { year: 2025, cutOff: 14 },
    ],
    prerequisites: [...BASE, ...credit("Integrated Science", "Chemistry", "Biology")],
  },

  // ---- the rest of the §3 cut-off table ----
  {
    university: "KNUST",
    name: "Medicine",
    qualification: "MB ChB",
    durationYears: 6,
    cutOff: 6,
    referenceYear: 2025,
    history: [
      { year: 2023, cutOff: 6 },
      { year: 2024, cutOff: 6 },
      { year: 2025, cutOff: 6 },
    ],
    prerequisites: [...BASE, ...credit("Integrated Science", "Chemistry", "Biology", "Physics")],
  },
  {
    university: "UCC",
    name: "Nursing",
    qualification: "B.Sc.",
    durationYears: 4,
    cutOff: 12,
    referenceYear: 2025,
    history: [
      { year: 2024, cutOff: 12 },
      { year: 2025, cutOff: 12 },
    ],
    prerequisites: [...BASE, ...credit("Integrated Science", "Biology"), either("Chemistry", "Physics")],
  },
  {
    university: "KNUST",
    name: "Civil Engineering",
    qualification: "B.Sc.",
    durationYears: 4,
    cutOff: 13,
    referenceYear: 2025,
    history: [
      { year: 2024, cutOff: 12 },
      { year: 2025, cutOff: 13 },
    ],
    prerequisites: [...BASE, ...credit("Physics", "Elective Mathematics")],
  },
  {
    university: "LEGON",
    name: "Business Administration",
    qualification: "B.Sc.",
    durationYears: 4,
    cutOff: 14,
    referenceYear: 2025,
    history: [
      { year: 2024, cutOff: 14 },
      { year: 2025, cutOff: 14 },
    ],
    prerequisites: [...BASE, either("Economics", "Financial Accounting", "Business Management")],
  },
  {
    university: "UEW",
    name: "B.Ed. Mathematics",
    qualification: "B.Ed.",
    durationYears: 4,
    cutOff: 17,
    referenceYear: 2025,
    history: [
      { year: 2024, cutOff: 18 },
      { year: 2025, cutOff: 17 },
    ],
    prerequisites: [...BASE, ...credit("Elective Mathematics")],
  },
  {
    university: "LEGON",
    name: "B.A. Political Science",
    qualification: "B.A.",
    durationYears: 4,
    cutOff: 18,
    referenceYear: 2025,
    history: [
      { year: 2024, cutOff: 18 },
      { year: 2025, cutOff: 18 },
    ],
    prerequisites: [...BASE, either("Government", "History", "Economics")],
  },
  {
    university: "UCC",
    name: "B.Ed. Economics",
    qualification: "B.Ed.",
    durationYears: 4,
    cutOff: 19,
    referenceYear: 2025,
    history: [
      { year: 2024, cutOff: 19 },
      { year: 2025, cutOff: 19 },
    ],
    prerequisites: [...BASE, ...credit("Economics")],
  },
  {
    university: "LEGON",
    name: "General cut-off (lowest)",
    qualification: "Various",
    durationYears: null,
    cutOff: 24,
    referenceYear: 2025,
    history: [
      { year: 2024, cutOff: 24 },
      { year: 2025, cutOff: 24 },
    ],
    prerequisites: [...BASE],
  },
  {
    university: "TTU",
    name: "B.Tech. Marketing",
    qualification: "B.Tech.",
    durationYears: 4,
    cutOff: 28,
    referenceYear: 2025,
    history: [
      { year: 2024, cutOff: 30 },
      { year: 2025, cutOff: 28 },
    ],
    prerequisites: [...BASE],
  },
  {
    university: "UDS",
    name: "B.Sc. Agriculture",
    qualification: "B.Sc.",
    durationYears: 4,
    cutOff: 18,
    referenceYear: 2025,
    history: [
      { year: 2024, cutOff: 18 },
      { year: 2025, cutOff: 18 },
    ],
    prerequisites: [...BASE, ...credit("Integrated Science"), either("Biology", "Chemistry")],
  },
  {
    university: "UDS",
    name: "B.A. Integrated Development Studies",
    qualification: "B.A.",
    durationYears: 4,
    cutOff: 24,
    referenceYear: 2025,
    history: [
      { year: 2024, cutOff: 24 },
      { year: 2025, cutOff: 24 },
    ],
    prerequisites: [...BASE],
  },
];

/**
 * Y. Aidoo's five tagged programmes — the §6 board, in surface order. Only KNUST Biochemistry carries
 * FIRST_CHOICE (the TARGET overlay); Legon Biochemistry is SECOND_CHOICE and the remaining three are
 * NULL-rank supporting choices (which the partial UNIQUE deliberately allows many of — AC12).
 */
const AIDOO_TARGETS: {
  university: string;
  programme: string;
  rank: "FIRST_CHOICE" | "SECOND_CHOICE" | "THIRD_CHOICE" | null;
  expect: MatchTier;
}[] = [
  { university: "KNUST", programme: "Biochemistry", rank: "FIRST_CHOICE", expect: "TARGET" },
  { university: "LEGON", programme: "Biochemistry", rank: "SECOND_CHOICE", expect: "COMFORTABLE" },
  { university: "KNUST", programme: "Pharmacy", rank: null, expect: "STRETCH" },
  { university: "LEGON", programme: "Medicine", rank: null, expect: "STRETCH" },
  { university: "UCC", programme: "Biochemistry", rank: null, expect: "SAFETY" },
];

const AIDOO_AGGREGATE = 10; // frozen by INCR-17 — the §5 headline the §6 tiles read (AC7/AC19)
const EXPECTED_TALLY = "1 target · 1 comfortable · 2 stretch · 1 safety";

async function main() {
  const [school] = await db
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.gesCode, "WR-WAW-014"));
  if (!school) {
    console.error("✗ Asankrangwa not seeded — run `pnpm db:seed` first.");
    process.exit(1);
  }
  const schoolId = school.id;

  const [academic] = await db.select({ id: users.id }).from(users).where(eq(users.phone, "+233244000002")); // HoA
  if (!academic) {
    console.error("✗ Seeded HoA user missing — run `pnpm db:seed` first.");
    process.exit(1);
  }

  // ---------- GLOBAL reference: upsert by natural key (no school_id — these serve every tenant) ----------
  const universityIdByKey = new Map<string, string>();
  for (const u of UNIVERSITIES) {
    const [existing] = await db
      .select({ id: universities.id })
      .from(universities)
      .where(eq(universities.name, u.name));
    if (existing) {
      await db
        .update(universities)
        .set({
          shortName: u.shortName,
          universityType: u.universityType,
          location: u.location,
          region: u.region,
        })
        .where(eq(universities.id, existing.id));
      universityIdByKey.set(u.key, existing.id);
    } else {
      const [row] = await db
        .insert(universities)
        .values({
          name: u.name,
          shortName: u.shortName,
          universityType: u.universityType,
          location: u.location,
          region: u.region,
        })
        .returning({ id: universities.id });
      universityIdByKey.set(u.key, row.id);
    }
  }

  const programmeIdByKey = new Map<string, string>();
  for (const p of PROGRAMMES) {
    const universityId = universityIdByKey.get(p.university);
    if (!universityId) throw new Error(`unknown university key: ${p.university}`);
    const values = {
      universityId,
      name: p.name,
      qualification: p.qualification,
      durationYears: p.durationYears,
      currentCutOff: p.cutOff,
      cutOffReferenceYear: p.referenceYear,
      cutOffHistoryJson: p.history,
      prerequisiteSubjectsJson: p.prerequisites,
    };
    const [existing] = await db
      .select({ id: universityProgrammes.id })
      .from(universityProgrammes)
      .where(and(eq(universityProgrammes.universityId, universityId), eq(universityProgrammes.name, p.name)));
    if (existing) {
      await db.update(universityProgrammes).set(values).where(eq(universityProgrammes.id, existing.id));
      programmeIdByKey.set(`${p.university}|${p.name}`, existing.id);
    } else {
      const [row] = await db
        .insert(universityProgrammes)
        .values(values)
        .returning({ id: universityProgrammes.id });
      programmeIdByKey.set(`${p.university}|${p.name}`, row.id);
    }
  }

  // EVERY programme must carry the universal English + Core-Maths credit baseline (AC17).
  for (const p of PROGRAMMES) {
    const named = p.prerequisites.filter((r): r is { subject: string; minGrade: "C6" } => "subject" in r);
    const has = (s: string) => named.some((r) => r.subject === s && r.minGrade === "C6");
    if (!has("English Language") || !has("Mathematics (Core)")) {
      console.error(`✗ ${p.university} ${p.name} is missing the English/Core-Maths prerequisite baseline.`);
      process.exit(1);
    }
  }

  // ---------- TENANT: re-run-safe wipe of INCR-17b-owned targets for THIS school's candidates ----------
  const cohortCandidates = await db
    .select({ id: wassceCandidates.id, indexNumber: wassceCandidates.indexNumber })
    .from(wassceCandidates)
    .where(eq(wassceCandidates.schoolId, schoolId));
  const candidateIds = cohortCandidates.map((c) => c.id);
  if (candidateIds.length) {
    await db
      .delete(universityTargets)
      .where(
        and(
          eq(universityTargets.schoolId, schoolId),
          inArray(universityTargets.candidateId, candidateIds),
        ),
      );
  }

  const aidoo = cohortCandidates.find((c) => c.indexNumber === "0184-0817");
  if (!aidoo) {
    console.error("✗ Y. Aidoo (0184-0817) missing — run `db:seed-wassce` first.");
    process.exit(1);
  }

  let taggedAt = new Date("2026-03-30T09:00:00Z");
  for (const t of AIDOO_TARGETS) {
    const programmeId = programmeIdByKey.get(`${t.university}|${t.programme}`);
    if (!programmeId) throw new Error(`unknown programme: ${t.university} ${t.programme}`);
    await db.insert(universityTargets).values({
      schoolId,
      candidateId: aidoo.id,
      universityProgrammeId: programmeId,
      targetRank: t.rank,
      taggedAt,
      taggedByUserId: academic.id,
    });
    taggedAt = new Date(taggedAt.getTime() + 60_000); // preserve the surface's tile order
  }

  // THE fixture assertion — the derived tiers MUST reproduce the §6 header exactly (AC4/AC18).
  const tiers = AIDOO_TARGETS.map((t) => {
    const p = PROGRAMMES.find((x) => x.university === t.university && x.name === t.programme)!;
    return matchTier(AIDOO_AGGREGATE, p.cutOff, t.rank === "FIRST_CHOICE");
  });
  const mismatched = AIDOO_TARGETS.filter((t, i) => tiers[i] !== t.expect);
  if (mismatched.length) {
    console.error(
      `✗ Tier mismatch: ${mismatched.map((t, i) => `${t.university} ${t.programme} → ${tiers[i]} (expected ${t.expect})`).join(", ")}`,
    );
    process.exit(1);
  }
  const tally = matchTally(tiers);
  if (tally !== EXPECTED_TALLY) {
    console.error(`✗ §6 header tally is "${tally}", expected "${EXPECTED_TALLY}" — fix the seed.`);
    process.exit(1);
  }

  await db.insert(auditLog).values({
    schoolId,
    actorUserId: academic.id,
    actorRole: "VICE_HEADMASTER_ACADEMIC",
    actionType: "created",
    entityType: "university_target",
    entityId: aidoo.id,
    afterState: {
      universities: UNIVERSITIES.length,
      programmes: PROGRAMMES.length,
      aidooTargets: AIDOO_TARGETS.length,
      tally,
    },
    reason: "WASSCE INCR-17b university seed (6 universities · 16 programmes · Y. Aidoo 5 targets)",
  });

  console.log(
    `✓ WASSCE university seed — ${UNIVERSITIES.length} universities, ${PROGRAMMES.length} programmes ` +
      `(every one carrying the English + Core-Maths credit baseline), Y. Aidoo tagged ${AIDOO_TARGETS.length} ` +
      `programmes → "${tally}".`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ WASSCE university seed failed:", err);
    process.exit(1);
  });
