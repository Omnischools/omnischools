import "../db/_loadenv";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { withSchool, pgError, isUniqueViolation } from "@/lib/db/rls";
import {
  schools,
  users,
  wassceCandidates,
  universities,
  universityProgrammes,
  universityTargets,
  readinessStatements,
} from "@/db/schema";
import {
  computeCandidateProjection,
  loadCandidateReadiness,
  loadCandidateTargets,
  buildTargetSnapshot,
  buildSnapshot,
  loadReadinessStatementForPdf,
} from "@/lib/wassce/readiness-data";
import { loadWassceSetup } from "@/lib/wassce/setup-data";
import type { FrozenTargetUniversity } from "@/lib/wassce/university-match";

/**
 * INCR-17b end-to-end verification against the dev DB — exercises the REAL loaders, the derive-on-read
 * §6 board, the freeze-at-generation snapshot, and the two structural target guards. Proves the ACs a
 * unit test cannot: that the board reads the same aggregate as §5, that target CRUD leaves the statement
 * alone, and that an issued statement's frozen json is immune to a later cut-off change.
 */
const INDEX = "0184-0817"; // Y. Aidoo

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) failures++;
  console.log(`${cond ? "✓" : "✗ FAIL"} ${msg}`);
};

async function main() {
  const [school] = await db
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.gesCode, "WR-WAW-014"));
  const schoolId = school.id;
  const [academic] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phone, "+233244000002"));

  await withSchool(schoolId, async (tx) => {
    // ---------------------------------------------------- 1) the §6 board derives from the real DB
    const data = await loadCandidateReadiness(tx, schoolId, INDEX);
    const m = data!.universityMatch;
    assert(m.computable, "§6 board is computable for Y. Aidoo");
    if (!m.computable) return;

    assert(m.tiles.length === 5, `5 match tiles rendered (got ${m.tiles.length})`);
    assert(
      m.tallyLabel === "1 target · 1 comfortable · 2 stretch · 1 safety",
      `§6 header tally reproduces the surface (got "${m.tallyLabel}")`,
    );

    // AC7 — the §6 "You · N" IS the §5 headline. ONE aggregate per candidate.
    const p = data!.projection;
    assert(p.computable && p.aggregate === 10, `§5 headline aggregate = 10 (AC19 no regression)`);
    assert(
      p.computable && m.aggregate === p.aggregate,
      `§6 "You · ${m.aggregate}" == §5 headline ${p.computable ? p.aggregate : "—"} (AC7)`,
    );

    const byName = new Map(m.tiles.map((t) => [t.name, t]));
    const expect: [string, string, string, string][] = [
      ["KNUST · Biochemistry", "TARGET", "11 (2025)", "Margin · 1 inside"],
      ["Legon · Biochemistry", "COMFORTABLE", "12 (2025)", "Margin · 2 inside"],
      ["KNUST · Pharmacy", "STRETCH", "8 (2025)", "Gap · 2 outside"],
      ["Legon · Medicine", "STRETCH", "6 (2025)", "Gap · 4 outside"],
      ["UCC · Biochemistry", "SAFETY", "14 (2025)", "Margin · 4 inside"],
    ];
    for (const [name, tier, cut, margin] of expect) {
      const t = byName.get(name);
      assert(
        t?.tier === tier && t?.cutOffLabel === cut && t?.marginLabel === margin,
        `${name} → ${t?.tier} · cut-off ${t?.cutOffLabel} · ${t?.marginLabel}`,
      );
    }
    assert(
      m.tiles.every((t) => t.cutOffLabel.includes("(")),
      "every cut-off renders its reference year — never a bare number (snapshot honesty)",
    );
    assert(
      byName.get("KNUST · Biochemistry")?.trendLabel?.startsWith("Trend · stable 3 yrs") === true,
      `KNUST Biochem trend is backed by a real 3-year history (${byName.get("KNUST · Biochemistry")?.trendLabel})`,
    );
    assert(
      byName.get("KNUST · Biochemistry")?.prerequisiteStatus === "MET",
      "KNUST Biochem prerequisites MET for Y. Aidoo (anyOf Physics/Elec-Maths satisfied) — AC16",
    );
    assert(
      byName.get("KNUST · Biochemistry")!.youPct < byName.get("UCC · Biochemistry")!.cutOffPct &&
        byName.get("Legon · Medicine")!.cutOffPct < byName.get("Legon · Medicine")!.youPct,
      "markers positioned by VALUE on the one 6→54 scale (not the surface's hand-tuned percentages)",
    );

    // ---------------------------------------------------- 2) setup §3 derives its own figures
    const setup = await loadWassceSetup(tx, schoolId, new Date());
    assert(setup.targets.cutOffRows.length === 16, `§3 cut-off table lists 16 programmes (got ${setup.targets.cutOffRows.length})`);
    assert(
      setup.targets.cutOffRows.every((r) => r.cutOffLabel.includes("(")),
      "§3 every cut-off is year-stamped",
    );
    assert(
      setup.targets.cutOffRows.find((r) => r.programmeName === "Biochemistry" && r.universityShortName === "KNUST")?.targeted === true,
      "§3 highlights the cohort's tagged KNUST Biochemistry row",
    );
    assert(
      setup.targets.destinations.find((d) => d.name.includes("Kwame Nkrumah"))?.studentsTargeting === 1,
      "§3 top-destinations counts KNUST's 1 first-choice target",
    );
    assert(
      setup.targets.bands.reduce((s, b) => s + b.studentCount, 0) > 0,
      "§3 tier bands count real candidates off the DERIVED aggregate",
    );
    assert(
      setup.targets.untaggedCount === setup.counts.candidates - 1,
      `§3 untagged worklist = every candidate but Y. Aidoo (got ${setup.targets.untaggedCount})`,
    );
  });

  // ------------------------------------- 3) AC13/AC14/AC15 — CRUD vs generation vs the frozen json
  const [aidoo] = await db
    .select({ id: wassceCandidates.id, cohortId: wassceCandidates.cohortId })
    .from(wassceCandidates)
    .where(and(eq(wassceCandidates.schoolId, schoolId), eq(wassceCandidates.indexNumber, INDEX)));

  await withSchool(schoolId, async (tx) => {
    const { rows, mock1, mock2 } = await computeCandidateProjection(tx, schoolId, aidoo.id, aidoo.cohortId);
    if (!mock2.computable) throw new Error("projection not computable — reseed");
    const targets = await loadCandidateTargets(tx, schoolId, aidoo.id, rows);
    const snapshot = buildTargetSnapshot(targets, mock2.aggregate);
    assert(snapshot.length === 5, `generation freezes 5 targets into target_universities_json (AC14)`);
    assert(
      snapshot[0].displayTier === "TARGET" && snapshot[0].matchBand === "MATCH",
      "the frozen primary carries BOTH the TARGET overlay and its computed MATCH band",
    );
    assert(
      snapshot.every((s) => s.projectedAggregate === 10 && s.cutOffReferenceYear === 2025),
      "every frozen element stamps the aggregate + the cut-off reference year",
    );

    // Freeze a statement the way the generate action does (supersede-then-insert).
    await tx
      .update(readinessStatements)
      .set({ supersededAt: new Date() })
      .where(
        and(
          eq(readinessStatements.schoolId, schoolId),
          eq(readinessStatements.candidateId, aidoo.id),
          isNull(readinessStatements.supersededAt),
        ),
      );
    const [stmt] = await tx
      .insert(readinessStatements)
      .values({
        schoolId,
        candidateId: aidoo.id,
        mock2Id: (await computeCandidateProjection(tx, schoolId, aidoo.id, aidoo.cohortId)).predictorMock!.id,
        projectedAggregate: mock2.aggregate,
        projectedBand: mock2.band,
        projectionSnapshotJson: buildSnapshot(mock1, mock2)!,
        targetUniversitiesJson: snapshot,
        generatedAt: new Date(),
        generatedByUserId: academic.id,
      })
      .returning({ id: readinessStatements.id });

    const currents = await tx
      .select({ id: readinessStatements.id })
      .from(readinessStatements)
      .where(
        and(
          eq(readinessStatements.schoolId, schoolId),
          eq(readinessStatements.candidateId, aidoo.id),
          isNull(readinessStatements.supersededAt),
        ),
      );
    assert(currents.length === 1, `exactly ONE current statement after regeneration (AC21/AC22)`);

    // AC13 — a target edit writes university_targets ONLY: no new statement, none superseded.
    const before = await tx
      .select({ id: readinessStatements.id })
      .from(readinessStatements)
      .where(eq(readinessStatements.candidateId, aidoo.id));
    const [pharmacy] = await tx
      .select({ id: universityTargets.id })
      .from(universityTargets)
      .innerJoin(universityProgrammes, eq(universityProgrammes.id, universityTargets.universityProgrammeId))
      .where(
        and(eq(universityTargets.candidateId, aidoo.id), eq(universityProgrammes.name, "Pharmacy")),
      );
    await tx
      .update(universityTargets)
      .set({ targetRank: "THIRD_CHOICE" })
      .where(eq(universityTargets.id, pharmacy.id));
    const after = await tx
      .select({ id: readinessStatements.id, superseded: readinessStatements.supersededAt })
      .from(readinessStatements)
      .where(eq(readinessStatements.candidateId, aidoo.id));
    assert(
      after.length === before.length && after.find((r) => r.id === stmt.id)?.superseded == null,
      "a target rank change creates NO statement and supersedes NONE (AC13)",
    );

    // AC15 — move a cut-off; the LIVE board follows, the FROZEN json does not.
    const [knustBiochem] = await tx
      .select({ id: universityProgrammes.id, cutOff: universityProgrammes.currentCutOff })
      .from(universityProgrammes)
      .innerJoin(universities, eq(universities.id, universityProgrammes.universityId))
      .where(and(eq(universities.shortName, "KNUST"), eq(universityProgrammes.name, "Biochemistry")));
    await tx
      .update(universityProgrammes)
      .set({ currentCutOff: 9 })
      .where(eq(universityProgrammes.id, knustBiochem.id));

    const live = await loadCandidateTargets(tx, schoolId, aidoo.id, rows);
    assert(
      live.find((t) => t.programmeName === "Biochemistry" && t.shortName === "KNUST")?.cutOff === 9,
      "the LIVE §6 board reflects the new cut-off immediately (derived on read)",
    );
    const pdf = await loadReadinessStatementForPdf(tx, schoolId, stmt.id);
    assert(
      pdf!.universityTargets.find((t) => t.name === "KNUST · Biochemistry")?.cutOffLabel === "11 (2025)",
      "the issued statement's FROZEN json still reads 11 (2025) — a cut-off edit never rewrites it (AC15/AC20)",
    );
    assert(pdf!.universityTargets.length === 5, "the PDF university block renders 5 frozen targets (AC20)");
    assert(
      pdf!.subjects.length === 8 && pdf!.mock2Aggregate === 10,
      "the PDF academic block is unchanged (8 subjects, aggregate 10) — AC19",
    );

    // restore
    await tx
      .update(universityProgrammes)
      .set({ currentCutOff: knustBiochem.cutOff })
      .where(eq(universityProgrammes.id, knustBiochem.id));
    await tx
      .update(universityTargets)
      .set({ targetRank: null })
      .where(eq(universityTargets.id, pharmacy.id));
  });

  // ------------------------------------- 4) AC12 — the two structural guards degrade, not 500
  // The try/catch sits OUTSIDE withSchool, exactly like the real server action: a failed insert aborts
  // the transaction, so the action can only read the error AFTER withSchool rethrows it. This proves
  // `constraint_name` survives that rethrow — which is what `uniqueMessage()` dispatches on.
  const constraintFromAction = async (values: {
    universityProgrammeId: string;
    targetRank?: "FIRST_CHOICE";
  }): Promise<string | undefined> => {
    try {
      await withSchool(schoolId, async (tx) => {
        await tx.insert(universityTargets).values({
          schoolId,
          candidateId: aidoo.id,
          ...values,
        });
      });
      return undefined;
    } catch (e) {
      // Read it exactly as the action does — through pgError, which unwraps DrizzleQueryError.
      return isUniqueViolation(e) ? pgError(e).constraint : `code ${pgError(e).code}`;
    }
  };

  const [existing] = await db
    .select({ programmeId: universityTargets.universityProgrammeId })
    .from(universityTargets)
    .where(eq(universityTargets.candidateId, aidoo.id));
  assert(
    (await constraintFromAction({ universityProgrammeId: existing.programmeId })) ===
      "uniq_university_target_programme",
    "a duplicate programme trips uniq_university_target_programme → clean message, not a 500 (AC12)",
  );

  const [uew] = await db
    .select({ id: universityProgrammes.id })
    .from(universityProgrammes)
    .innerJoin(universities, eq(universities.id, universityProgrammes.universityId))
    .where(eq(universities.shortName, "UEW"));
  assert(
    (await constraintFromAction({ universityProgrammeId: uew.id, targetRank: "FIRST_CHOICE" })) ===
      "uniq_university_target_rank",
    "a 2nd FIRST_CHOICE trips the partial uniq_university_target_rank → clean message (AC12)",
  );
  assert(
    (await constraintFromAction({ universityProgrammeId: uew.id })) === undefined,
    "a NULL-rank target on the same programme is ALLOWED (many unranked supporting choices — AC12)",
  );
  await db.delete(universityTargets).where(
    and(eq(universityTargets.candidateId, aidoo.id), eq(universityTargets.universityProgrammeId, uew.id)),
  );

  console.log(failures === 0 ? "\n✓ INCR-17b verification PASSED" : `\n✗ ${failures} assertion(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("✗ verification crashed:", err);
  process.exit(1);
});
