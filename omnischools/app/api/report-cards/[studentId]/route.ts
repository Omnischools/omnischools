import { and, asc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  students,
  academicPeriod,
  subjects,
  gradebookScores,
  reportCards,
  schools,
} from "@/db/schema";
import { renderReportCardPdf } from "@/lib/pdf/render-report-card";
import type { ReportCardData } from "@/lib/pdf/report-card-document";

// @react-pdf/renderer is Node-only (fontkit); never run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const toNum = (v: unknown): number | null =>
  v == null || v === "" ? null : Number(v);
const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "S";
const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * GET /api/report-cards/[studentId]?periodId=… — the authenticated staff report-card
 * download. Renders the terminal report card for a student × period to a PDF and streams
 * it inline. Tenant-scoped via requireSchool + withSchool. Mirrors the on-screen report
 * card at app/(app)/gradebook/report/[studentId].
 */
export async function GET(
  req: Request,
  { params }: { params: { studentId: string } },
) {
  const { school } = await requireSchool();
  const periodId = new URL(req.url).searchParams.get("periodId");
  if (!periodId) return new Response("Missing periodId", { status: 400 });

  const built = await withSchool(school.id, async (tx): Promise<ReportCardData | null> => {
    const [student] = await tx
      .select({
        firstName: students.firstName,
        otherNames: students.otherNames,
        lastName: students.lastName,
        studentCode: students.studentCode,
        classLabel: students.currentClassLabel,
      })
      .from(students)
      .where(and(eq(students.id, params.studentId), eq(students.schoolId, school.id)));
    if (!student) return null;

    const [period] = await tx
      .select({
        academicYear: academicPeriod.academicYear,
        periodLabel: academicPeriod.periodLabel,
      })
      .from(academicPeriod)
      .where(
        and(eq(academicPeriod.periodId, periodId), eq(academicPeriod.schoolId, school.id)),
      );

    const lines = await tx
      .select({
        subject: subjects.name,
        classScore: gradebookScores.classScore,
        examScore: gradebookScores.examScore,
        total: gradebookScores.total,
        grade: gradebookScores.grade,
      })
      .from(gradebookScores)
      .innerJoin(subjects, eq(gradebookScores.subjectId, subjects.id))
      .where(
        and(
          eq(gradebookScores.schoolId, school.id),
          eq(gradebookScores.studentId, params.studentId),
          eq(gradebookScores.periodId, periodId),
        ),
      )
      .orderBy(asc(subjects.name));

    const [card] = await tx
      .select({
        remark: reportCards.remark,
        overallTotal: reportCards.overallTotal,
        overallGrade: reportCards.overallGrade,
        generatedAt: reportCards.generatedAt,
      })
      .from(reportCards)
      .where(
        and(
          eq(reportCards.studentId, params.studentId),
          eq(reportCards.periodId, periodId),
          eq(reportCards.schoolId, school.id),
        ),
      );

    const [sc] = await tx
      .select({ name: schools.name })
      .from(schools)
      .where(eq(schools.id, school.id));
    const schoolName = sc?.name ?? school.name;

    const fullName = `${student.firstName} ${student.otherNames ?? ""} ${student.lastName}`
      .replace(/\s+/g, " ")
      .trim();

    return {
      school: { name: schoolName, initials: initialsOf(schoolName) },
      title: "Terminal Report",
      periodLabel: period
        ? `${period.academicYear} · ${period.periodLabel}`
        : "—",
      student: {
        name: fullName,
        code: student.studentCode,
        classLabel: student.classLabel ?? "—",
      },
      lines: lines.map((l) => ({
        subject: l.subject,
        classScore: toNum(l.classScore),
        examScore: toNum(l.examScore),
        total: toNum(l.total),
        grade: l.grade ?? null,
      })),
      overallTotal: toNum(card?.overallTotal),
      overallGrade: card?.overallGrade ?? null,
      remark: card?.remark ?? null,
      generatedAt: card?.generatedAt
        ? new Date(card.generatedAt).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : null,
    };
  });

  if (!built) return new Response("Student not found", { status: 404 });

  const pdf = await renderReportCardPdf(built);
  const filename = `Report-${slug(built.student.code)}-${slug(built.periodLabel)}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
