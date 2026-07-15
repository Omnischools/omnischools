import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireSchool, assertAnyRole } from "@/lib/auth/server";
import { SENIOR_LEDGER_ROLES } from "@/lib/access";
import { withSchool } from "@/lib/db/rls";
import {
  students,
  academicPeriod,
  seniorLedgerPath,
  assessmentWeights,
} from "@/db/schema";
import { resolveDenominators, type CategoryDenominators } from "@/lib/score-ledger/compute";
import { scaleExtractedCell } from "@/lib/score-ledger/scan-diff";
import { getLedgerExtractor, type ScanExtraction } from "@/lib/ocr";

// The extractor may call Claude over the network (Node fetch); never run on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ~9 MB of base64 — a generous ceiling for one ledger photo; a larger upload is rejected up
// front. The image lives ONLY in this request: it is forwarded to the extractor and discarded
// when the handler returns. Nothing writes it to storage, a column, a temp file, or a log.
const MAX_IMAGE_CHARS = 12_000_000;

const Body = z.object({
  classId: z.string().uuid(),
  subjectId: z.string().uuid(),
  periodId: z.string().uuid(),
  imageDataUrl: z
    .string()
    .max(MAX_IMAGE_CHARS, "That photo is too large — use a smaller or more compressed image.")
    .regex(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "Attach a photo of the ledger page."),
});

type CatKey = "asgn" | "midSem" | "endSem" | "project" | "portfolio";
const CAT_KEYS: CatKey[] = ["asgn", "midSem", "endSem", "project", "portfolio"];

/**
 * POST /api/senior/ledger-extract — Path B step 1 (owner ruling 1/3). Our own server route
 * proxies the in-memory base64 photo to Claude Vision (Haiku 4.5, server-held key) and returns
 * the extracted five-category grid with a per-cell confidence, each raw read already scaled to
 * 0–100 by its category's school-defined denominator. The image is NEVER persisted — no table,
 * no column, no bucket, no temp file, and it is not echoed into any log or the error path.
 */
export async function POST(req: Request) {
  const { school } = await requireSchool();
  await assertAnyRole(SENIOR_LEDGER_ROLES);

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid upload." },
      { status: 400 },
    );
  }
  const { classId, subjectId, periodId, imageDataUrl } = parsed.data;

  const ctx = await withSchool(school.id, async (tx) => {
    const [pathRow] = await tx
      .select({ path: seniorLedgerPath.path })
      .from(seniorLedgerPath)
      .where(
        and(
          eq(seniorLedgerPath.schoolId, school.id),
          eq(seniorLedgerPath.classId, classId),
          eq(seniorLedgerPath.subjectId, subjectId),
          eq(seniorLedgerPath.periodId, periodId),
        ),
      );
    const [period] = await tx
      .select({ closedAt: academicPeriod.closedAt })
      .from(academicPeriod)
      .where(
        and(eq(academicPeriod.schoolId, school.id), eq(academicPeriod.periodId, periodId)),
      );
    const roster = await tx
      .select({
        id: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
      })
      .from(students)
      .where(
        and(
          eq(students.schoolId, school.id),
          eq(students.classId, classId),
          eq(students.status, "ACTIVE"),
        ),
      )
      .orderBy(asc(students.lastName));
    const weightRows = await tx
      .select()
      .from(assessmentWeights)
      .where(eq(assessmentWeights.schoolId, school.id));
    return { path: pathRow?.path ?? "AUTO_COMPILE", closed: !!period?.closedAt, roster, weightRows };
  });

  if (ctx.path !== "SCAN_EXTRACT") {
    return Response.json(
      { ok: false, error: "Switch this class to Scan & extract (Path B) first." },
      { status: 409 },
    );
  }
  if (ctx.closed) {
    return Response.json(
      { ok: false, error: "This semester is closed — its scores are final." },
      { status: 409 },
    );
  }
  if (ctx.roster.length === 0) {
    return Response.json({ ok: false, error: "No students in this class yet." }, { status: 409 });
  }

  // Resolve the five denominators (subject → school default → system 100), same two rows the
  // weight resolver uses — the denominators are columns on those very ref_assessment_weights rows.
  const toD = (r: (typeof ctx.weightRows)[number]): CategoryDenominators => ({
    asgn: r.asgnDenominator,
    midSem: r.midSemDenominator,
    endSem: r.endSemDenominator,
    project: r.projectDenominator,
    portfolio: r.portfolioDenominator,
  });
  const subjectRow = ctx.weightRows.find((r) => r.subjectId === subjectId);
  const defaultRow = ctx.weightRows.find((r) => r.subjectId === null);
  const denom = resolveDenominators(
    subjectRow ? toD(subjectRow) : null,
    defaultRow ? toD(defaultRow) : null,
  );

  let extraction: ScanExtraction;
  try {
    const extractor = await getLedgerExtractor();
    extraction = await extractor.extract({
      imageDataUrl,
      roster: ctx.roster.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}` })),
    });
  } catch {
    // Q7 / H1: extraction failure degrades to a blank Path-C grid in place on the client. We
    // return a soft failure (no image retained, nothing logged) — the caller shows the empty grid.
    return Response.json({ ok: false, error: "extract_failed" }, { status: 200 });
  }

  // Scale each raw read to 0–100 by its category denominator (raw 8 under /10 → 80). The client
  // bands by confidence and diffs against the committed row; both work in this 0–100 space.
  const rows = extraction.rows.map((row) => {
    const cells = {} as Record<CatKey, { raw: number | null; value: number | null; confidence: number }>;
    for (const k of CAT_KEYS) {
      const c = row.cells[k];
      cells[k] = { raw: c.value, value: scaleExtractedCell(c.value, denom[k]), confidence: c.confidence };
    }
    return { readName: row.readName, studentId: row.studentId, cells };
  });

  return Response.json({ ok: true, rows });
}
