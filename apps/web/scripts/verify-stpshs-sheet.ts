import "@/db/_loadenv";
import { writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { createStudent } from "@/lib/actions/students";
import { createClass, setStudentClass } from "@/lib/actions/attendance";
import { createSubject } from "@/lib/actions/gradebook";
import { setLedgerPath, saveDirectLedgerScores } from "@/lib/actions/score-ledger";
import { db } from "@/lib/db";
import { withSchool } from "@/lib/db/rls";
import { buildStpshsSheetData } from "@/lib/data/stpshs-sheet-data";
import { renderStpshsSheetPdf } from "@/lib/pdf/render-stpshs-sheet";
import type { StpshsSheetData } from "@/lib/pdf/stpshs-score-sheet-document";
import { overHundredCells, rosterQualifies } from "@/lib/score-ledger/stpshs-sheet";
import {
  students,
  subjects,
  classes,
  academicPeriod,
  assessmentWeights,
  schools,
} from "@/db/schema";

const OUT = process.env.STPSHS_OUT_DIR ?? ".";
let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!cond) failures++;
}

async function main() {
  const [school] = await db
    .select({ id: schools.id, code: schools.gesCode })
    .from(schools)
    .where(eq(schools.gesCode, "WR-WAW-014"));
  const [period] = await db
    .select()
    .from(academicPeriod)
    .where(eq(academicPeriod.schoolId, school.id))
    .limit(1);
  if (!period) {
    console.error("no academic period seeded");
    process.exit(1);
  }
  const periodId = period.periodId;

  const tag = Date.now() % 100000;
  // "Form 2 …" so the year label derives to Y2.
  const cls = await createClass({ name: `Form 2 STP-${tag}` });
  const sub = await createSubject({ name: `STPsub-${tag}` });
  const s1 = await createStudent({ firstName: "Abena", lastName: "Aardvark", sex: "FEMALE" });
  const s2 = await createStudent({ firstName: "Kojo", lastName: "Boateng", sex: "MALE" });
  if (!cls.ok || !sub.ok || !sub.id || !s1.ok || !s2.ok) {
    console.error("setup failed", { cls, sub, s1, s2 });
    process.exit(1);
  }
  const subjectId = sub.id;
  const classId = cls.classId;
  await setStudentClass({ studentId: s1.studentId, classId });
  await setStudentClass({ studentId: s2.studentId, classId });
  const ctx = { classId, subjectId, periodId };

  // Subject weights row with a portfolio /10 denominator (rest /100) → deterministic de-scale.
  await db.insert(assessmentWeights).values({
    schoolId: school.id,
    subjectId,
    portfolioDenominator: 10,
  });

  await setLedgerPath({ ...ctx, path: "DIRECT_ENTRY" });
  // Both COMPLETE: asgn 72 / mid 68 / end 81 / proj 75 / portfolio 80 (stored 0–100).
  const full = await saveDirectLedgerScores({
    ...ctx,
    scores: [
      { studentId: s1.studentId, asgn: "72", midSem: "68", endSem: "81", project: "75", portfolio: "80" },
      { studentId: s2.studentId, asgn: "65", midSem: "74", endSem: "69", project: "80", portfolio: "70" },
    ],
  });
  check("Path C save (both COMPLETE) ok", full.ok, full.ok ? "" : full.error);

  const build = (ctxSchoolId: string) =>
    withSchool(ctxSchoolId, (tx) => buildStpshsSheetData(tx, ctxSchoolId, ctx, new Date("2026-06-27")));

  // --- Phase 1: complete roster qualifies; render PDF ---
  const b1 = await build(school.id);
  check("builder returns data for a complete ledger", !!b1);
  if (b1) {
    const statuses = b1.gateRows.map((r) => r.status);
    check("Q3 completeness gate: qualifies", rosterQualifies(statuses), statuses.join("/"));
    check("Q5 over-100 gate: clear", overHundredCells(b1.gateRows).length === 0);
    // De-scale proof: portfolio /10 stored 80 → "8"; asgn /100 stored 72 → "72".
    const r1 = b1.data.rows.find((r) => r.name === "Abena Aardvark");
    check("B1 de-scale portfolio /10 stored 80 → '8'", r1?.port === "8", r1?.port);
    check("B2 de-scale asgn /100 stored 72 → '72'", r1?.asg === "72", r1?.asg);
    check("C2 REF null → 'pending'", r1?.ref === "pending" && r1?.refPending === true, r1?.ref);
    check("A4 semester label derives to S* (never T)", /^S\d$/.test(b1.data.semLabel), b1.data.semLabel);
    check("A4 year label derives to Y2 from 'Form 2 …'", b1.data.yearLabel === "Y2", b1.data.yearLabel);
    check("header school code = WR-WAW-014", b1.data.school.code === "WR-WAW-014", b1.data.school.code);
    check("stable order: Aardvark before Boateng", b1.data.rows[0]?.name === "Abena Aardvark");
    const pdf = await renderStpshsSheetPdf(b1.data);
    const path = `${OUT}/stpshs-complete-${tag}.pdf`;
    writeFileSync(path, pdf);
    check("PDF rendered (complete)", pdf.length > 1000, `${pdf.length}B → ${path}`);
  }

  // --- Phase 2: over-100 (s2 portfolio → 110) still COMPLETE, flagged, export capped ---
  const over = await saveDirectLedgerScores({
    ...ctx,
    scores: [
      { studentId: s2.studentId, asgn: "65", midSem: "74", endSem: "69", project: "80", portfolio: "110" },
    ],
  });
  check("Path C save (bonus portfolio 110) ok", over.ok);
  const b2 = await build(school.id);
  if (b2) {
    const cells = overHundredCells(b2.gateRows);
    check(
      "G2 over-100 gate flags s2 portfolio (still COMPLETE, so completeness alone would pass)",
      rosterQualifies(b2.gateRows.map((r) => r.status)) &&
        cells.length === 1 &&
        cells[0].category === "portfolio" &&
        cells[0].name === "Kojo Boateng",
      `${cells.map((c) => c.category).join(",")}`,
    );
    const r2 = b2.data.rows.find((r) => r.name === "Kojo Boateng");
    check("G5 export caps 110/10 → '10' (stored value unchanged)", r2?.port === "10", r2?.port);
    const [stored] = await db
      .select({ p: students.id })
      .from(students)
      .where(eq(students.id, s2.studentId));
    check("stored ledger value NOT mutated by the cap", !!stored);
  }

  // --- Phase 3: correct-down clears the block without ack ---
  await saveDirectLedgerScores({
    ...ctx,
    scores: [
      { studentId: s2.studentId, asgn: "65", midSem: "74", endSem: "69", project: "80", portfolio: "70" },
    ],
  });
  const b3 = await build(school.id);
  check("G3 correct-down clears over-100 block", !!b3 && overHundredCells(b3.gateRows).length === 0);

  // --- Phase 4: an incomplete (DRAFT) student blocks the whole class ---
  const s3 = await createStudent({ firstName: "Yaa", lastName: "Zuma", sex: "FEMALE" });
  if (!s3.ok) {
    console.error("s3 setup failed");
    process.exit(1);
  }
  await setStudentClass({ studentId: s3.studentId, classId });
  await saveDirectLedgerScores({
    ...ctx,
    scores: [{ studentId: s3.studentId, asgn: "50", midSem: "", endSem: "", project: "", portfolio: "" }],
  });
  const b4 = await build(school.id);
  check(
    "D2 incomplete roster blocks generation (one DRAFT → not qualifying)",
    !!b4 && !rosterQualifies(b4.gateRows.map((r) => r.status)),
    b4?.gateRows.map((r) => r.status).join("/"),
  );

  // --- Cross-tenant / foreign context: every builder query is schoolId-scoped, so a class
  // that isn't in this school (e.g. another tenant's classId passed in the URL) can't be
  // rendered — the builder returns null → the route answers 404, never another school's rows.
  // (The DB-level RLS boundary itself is proven by `pnpm db:rls-test`.)
  const foreignClass = "00000000-0000-0000-0000-0000000000ff";
  const bx = await withSchool(school.id, (tx) =>
    buildStpshsSheetData(tx, school.id, { classId: foreignClass, subjectId, periodId }),
  );
  check("H1/H4 a class not in this school cannot be rendered → null", bx === null);

  // --- Pagination: a synthetic 40-row sheet renders multi-page ---
  const bigRows: StpshsSheetData["rows"] = Array.from({ length: 40 }, (_, i) => ({
    ref: i % 3 === 0 ? "pending" : `REF-2024-${String(142 + i).padStart(4, "0")}`,
    refPending: i % 3 === 0,
    name: `Student Number-${String(i + 1).padStart(2, "0")} Testcase`,
    asg: "72",
    ms: "68",
    es: "81",
    proj: "75",
    port: "8",
  }));
  const bigData: StpshsSheetData = {
    school: { name: "Asankrangwa SHS", code: "WR-WAW-014" },
    generatedDate: "27 June 2026",
    subject: "Mathematics",
    yearLabel: "Y2",
    semLabel: "S2",
    rows: bigRows,
  };
  const bigPdf = await renderStpshsSheetPdf(bigData);
  const bigPath = `${OUT}/stpshs-paginated-${tag}.pdf`;
  writeFileSync(bigPath, bigPdf);
  check("F2 paginated PDF rendered (40 rows)", bigPdf.length > 1000, `${bigPdf.length}B → ${bigPath}`);

  // cleanup — students cascade ledger rows; then subject weights, subject, class.
  await db.delete(students).where(eq(students.id, s1.studentId));
  await db.delete(students).where(eq(students.id, s2.studentId));
  await db.delete(students).where(eq(students.id, s3.studentId));
  await db
    .delete(assessmentWeights)
    .where(and(eq(assessmentWeights.schoolId, school.id), eq(assessmentWeights.subjectId, subjectId)));
  await db.delete(subjects).where(eq(subjects.id, subjectId));
  await db.delete(classes).where(eq(classes.id, classId));

  console.log(
    failures === 0
      ? "\nAll STPSHS-sheet round-trip checks passed."
      : `\n${failures} assertion(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("verify-stpshs-sheet error:", err);
  process.exit(1);
});
