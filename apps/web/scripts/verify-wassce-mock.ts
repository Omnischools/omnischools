import "../db/_loadenv";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withSchool } from "@/lib/db/rls";
import { schools, users, mockExams, mockResults, wassceCandidates } from "@/db/schema";
import { getActiveCohort } from "@/lib/wassce/active-cohort";
import { resolveAuthorizedWassceSubjectIds } from "@/lib/wassce/subject-authz";
import { loadSubjectTeacherSurface, loadMockConfig } from "@/lib/wassce/mock-data";

/** INCR-16 end-to-end verification against the dev DB — exercises the real loaders + authz + write query. */
async function main() {
  const [school] = await db.select({ id: schools.id }).from(schools).where(eq(schools.gesCode, "WR-WAW-014"));
  const schoolId = school.id;
  const [owusu] = await db.select({ id: users.id }).from(users).where(eq(users.phone, "+233244000003"));
  const assert = (cond: boolean, msg: string) => console.log(`${cond ? "✓" : "✗ FAIL"} ${msg}`);

  await withSchool(schoolId, async (tx) => {
    // 1) Active-cohort fix → F3-2026 (frozen), not the unfrozen F2-2027.
    const active = await getActiveCohort(tx, schoolId);
    assert(active?.examYear === 2026 && active?.setupFrozenAt != null, `active cohort resolves to F3-2026 (got ${active?.examYear})`);

    // 2) R5 correspondence: Owusu (F3 Chemistry) → exactly the Chemistry wassce_subject.
    const auth = await resolveAuthorizedWassceSubjectIds(tx, schoolId, owusu.id);
    assert(auth.size === 1, `teacher authorised for exactly 1 wassce_subject (Chemistry) — got ${auth.size}`);
    const none = await resolveAuthorizedWassceSubjectIds(tx, schoolId, "00000000-0000-0000-0000-000000000009");
    assert(none.size === 0, `a user with no F3 assignment authorises nothing (got ${none.size})`);

    // 3) Loader (active cohort, oversight view) → derived stats match the surface.
    const data = await loadSubjectTeacherSurface(tx, schoolId, owusu.id, true, {});
    assert(!!data?.subject && data.subject.name === "Chemistry", "surface loads Chemistry for the active cohort");
    assert(data!.stats.candidates === 28, `28 candidates (got ${data!.stats.candidates})`);
    assert(data!.stats.creditPct === 100, `credit rate 100% derived (got ${data!.stats.creditPct})`);
    assert(data!.stats.distinctionPct === 43, `distinction rate 43% derived (got ${data!.stats.distinctionPct})`);
    assert(data!.stats.meanGrade === "B3", `cohort mean B3 derived (got ${data!.stats.meanGrade})`);
    const hist = Object.fromEntries(data!.stats.histogram.map((h) => [h.grade, h.count]));
    assert(hist.A1 === 4 && hist.B2 === 8 && hist.B3 === 9, `histogram A1/B2/B3 = 4/8/9 (got ${hist.A1}/${hist.B2}/${hist.B3})`);
    const moderated = data!.rows.find((r) => Object.values(r.cells).some((c) => c.moderatedGrade != null));
    assert(!!moderated, "a moderated row is present (moderated-vs-original + AC10 COALESCE exercisable)");
    assert(!!data!.benchmark && data!.benchmark.credit.rows.some((r) => r.quality === "DIRECTIONAL"), "benchmark includes a DIRECTIONAL region row");

    // 4) F3-2026 predictor mock is LOCKED (marking complete) → mark-entry would be rejected.
    const [f3predictor] = await tx
      .select({ id: mockExams.id, lock: mockExams.markingCompleteAt })
      .from(mockExams)
      .where(and(eq(mockExams.schoolId, schoolId), eq(mockExams.isPredictor, true)));
    assert(f3predictor.lock != null, "F3-2026 predictor mock is locked (read-only)");
  });

  // 5) F2-2027 open Mock 1: a real tenant-scoped upsert PERSISTS (the writable mark-entry path).
  const cfg = await withSchool(schoolId, (tx) => loadMockConfig(tx, schoolId));
  const f2Open = cfg.timeline.find((m) => !m.locked && m.cohortLabel.includes("2027"));
  console.log(`✓ F2-2027 open mock found: ${f2Open?.cohortLabel} — ${f2Open?.name} (marking open)`);

  await withSchool(schoolId, async (tx) => {
    const [cand] = await tx.select({ id: wassceCandidates.id }).from(wassceCandidates).where(eq(wassceCandidates.indexNumber, "0184-5001"));
    const chem = await resolveAuthorizedWassceSubjectIds(tx, schoolId, owusu.id);
    const subjectId = Array.from(chem)[0];
    await tx
      .insert(mockResults)
      .values({ schoolId, mockId: f2Open!.id, candidateId: cand.id, subjectId, grade: "B2", markedByUserId: owusu.id, markedAt: new Date() })
      .onConflictDoUpdate({
        target: [mockResults.schoolId, mockResults.mockId, mockResults.candidateId, mockResults.subjectId],
        set: { grade: "B2", markedByUserId: owusu.id, markedAt: new Date() },
      });
    const [saved] = await tx
      .select({ grade: mockResults.grade })
      .from(mockResults)
      .where(and(eq(mockResults.schoolId, schoolId), eq(mockResults.mockId, f2Open!.id), eq(mockResults.candidateId, cand.id)));
    console.log(`${saved?.grade === "B2" ? "✓" : "✗ FAIL"} F2-2027 Mock 1 mark-entry persists (candidate 0184-5001 → B2)`);
    // clean the probe row so the seed stays pristine
    await tx.delete(mockResults).where(and(eq(mockResults.schoolId, schoolId), eq(mockResults.mockId, f2Open!.id), eq(mockResults.candidateId, cand.id)));
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
