import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  students,
  academicPeriod,
  subjects,
  gradebookScores,
  reportCards,
  gradeScale,
  attendanceRecords,
  schools,
} from "@/db/schema";
import {
  averageOfTotals,
  gradeForScore,
  gradeLegend,
  type GradeBand,
} from "@/lib/gradebook/grade-scale";
import { schoolInitials } from "@/lib/school-initials";
import { renderReportCardPdf } from "@/lib/pdf/render-report-card";
import type { ReportCardData } from "@/lib/pdf/report-card-document";

// @react-pdf/renderer is Node-only (fontkit); never run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const toNum = (v: unknown): number | null =>
  v == null || v === "" ? null : Number(v);
const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * GET /api/report-cards/[studentId]?periodId=… — the authenticated staff report-card
 * download. Renders the terminal report card (term average, attendance summary, grade key)
 * for a student × period to a PDF and streams it inline. Tenant-scoped via requireSchool +
 * withSchool. Mirrors app/(app)/gradebook/report/[studentId].
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
        startsOn: academicPeriod.startsOn,
        endsOn: academicPeriod.endsOn,
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
      .select({ remark: reportCards.remark, generatedAt: reportCards.generatedAt })
      .from(reportCards)
      .where(
        and(
          eq(reportCards.studentId, params.studentId),
          eq(reportCards.periodId, periodId),
          eq(reportCards.schoolId, school.id),
        ),
      );

    // Grade scale → average grade + legend.
    const scaleRows = await tx
      .select({
        grade: gradeScale.grade,
        label: gradeScale.label,
        minScore: gradeScale.minScore,
      })
      .from(gradeScale)
      .where(eq(gradeScale.schoolId, school.id))
      .orderBy(asc(gradeScale.ordinal));
    const bands: GradeBand[] = scaleRows.map((g) => ({
      grade: g.grade,
      label: g.label,
      minScore: Number(g.minScore),
    }));

    // Attendance for the term (only when the period is dated).
    let attendance: ReportCardData["attendance"] = null;
    if (period?.startsOn && period?.endsOn) {
      const attRows = await tx
        .select({
          status: attendanceRecords.status,
          n: sql<number>`count(*)::int`,
        })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.schoolId, school.id),
            eq(attendanceRecords.studentId, params.studentId),
            gte(attendanceRecords.date, period.startsOn),
            lte(attendanceRecords.date, period.endsOn),
          ),
        )
        .groupBy(attendanceRecords.status);
      const by = (st: string) => attRows.find((r) => r.status === st)?.n ?? 0;
      attendance = {
        present: by("PRESENT") + by("LATE"),
        absent: by("ABSENT"),
        excused: by("EXCUSED") + by("MEDICAL"),
      };
    }

    const [sc] = await tx
      .select({ name: schools.name })
      .from(schools)
      .where(eq(schools.id, school.id));
    const schoolName = sc?.name ?? school.name;

    const fullName = `${student.firstName} ${student.otherNames ?? ""} ${student.lastName}`
      .replace(/\s+/g, " ")
      .trim();

    const average = averageOfTotals(lines.map((l) => toNum(l.total)));
    const overallGrade = average != null ? gradeForScore(bands, average) : null;

    return {
      school: { name: schoolName, initials: schoolInitials(schoolName) },
      title: "Terminal Report",
      periodLabel: period ? `${period.academicYear} · ${period.periodLabel}` : "—",
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
      overallAverage: average,
      overallGrade,
      attendance,
      gradeLegend: gradeLegend(bands),
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
