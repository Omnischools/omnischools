"use server";
import { and, asc, desc, eq, notInArray } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { requireSchool } from "@/lib/auth/server";
import { csvTemplate } from "@/lib/import/csv";
import { schoolFile } from "@/lib/filename";
import { NON_STAFF_ROLE_CODES } from "@/lib/staff-roles";
import {
  students,
  users,
  roles,
  roleAssignments,
  feeStructures,
  feeStructureItems,
} from "@/db/schema";

type ExportResult =
  | { ok: true; filename: string; csv: string; rows: number }
  | { ok: false; error: string };

const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** Students → CSV (code, name parts, sex, DOB, class, status). */
export async function exportStudentsCsv(): Promise<ExportResult> {
  const { school } = await requireSchool();
  try {
    const rows = await withSchool(school.id, (tx) =>
      tx
        .select()
        .from(students)
        .where(eq(students.schoolId, school.id))
        .orderBy(asc(students.lastName)),
    );
    const headers = [
      "Student code",
      "Last name",
      "First name",
      "Other names",
      "Sex",
      "Date of birth",
      "Class",
      "Status",
    ];
    const body = rows.map((s) => [
      s.studentCode,
      s.lastName,
      s.firstName,
      s.otherNames ?? "",
      cap(s.sex),
      s.dateOfBirth ? String(s.dateOfBirth).slice(0, 10) : "",
      s.currentClassLabel ?? "",
      cap(s.status),
    ]);
    return {
      ok: true,
      filename: schoolFile(school.name, "students.csv"),
      csv: csvTemplate(headers, body),
      rows: body.length,
    };
  } catch {
    return { ok: false, error: "Could not export students." };
  }
}

/** Staff → CSV (name, phone, email, roles). Excludes student/parent accounts. */
export async function exportStaffCsv(): Promise<ExportResult> {
  const { school } = await requireSchool();
  try {
    const rows = await withSchool(school.id, (tx) =>
      tx
        .select({
          userId: users.id,
          name: users.fullName,
          phone: users.phone,
          email: users.email,
          roleCode: roles.code,
          roleLabel: roles.label,
        })
        .from(roleAssignments)
        .innerJoin(users, eq(roleAssignments.userId, users.id))
        .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
        .where(
          and(
            eq(roleAssignments.schoolId, school.id),
            notInArray(roles.code, NON_STAFF_ROLE_CODES),
          ),
        ),
    );
    const byUser = new Map<
      string,
      { name: string; phone: string; email: string; roles: string[] }
    >();
    for (const r of rows) {
      let g = byUser.get(r.userId);
      if (!g) {
        g = { name: r.name ?? "", phone: r.phone, email: r.email ?? "", roles: [] };
        byUser.set(r.userId, g);
      }
      if (r.roleLabel) g.roles.push(r.roleLabel);
    }
    const headers = ["Full name", "Phone", "Email", "Roles"];
    const body = Array.from(byUser.values()).map((m) => [
      m.name,
      m.phone,
      m.email,
      m.roles.join(" · "),
    ]);
    return {
      ok: true,
      filename: schoolFile(school.name, "staff.csv"),
      csv: csvTemplate(headers, body),
      rows: body.length,
    };
  } catch {
    return { ok: false, error: "Could not export staff." };
  }
}

/** Fee structures + line items → CSV. */
export async function exportFeesCsv(): Promise<ExportResult> {
  const { school } = await requireSchool();
  try {
    const rows = await withSchool(school.id, (tx) =>
      tx
        .select({
          structure: feeStructures.name,
          level: feeStructures.level,
          academicYear: feeStructures.academicYear,
          item: feeStructureItems.description,
          amount: feeStructureItems.amount,
        })
        .from(feeStructureItems)
        .innerJoin(
          feeStructures,
          eq(feeStructureItems.feeStructureId, feeStructures.id),
        )
        .where(eq(feeStructureItems.schoolId, school.id))
        .orderBy(desc(feeStructures.academicYear), asc(feeStructures.name)),
    );
    const headers = ["Fee structure", "Level", "Academic year", "Item", "Amount (GHS)"];
    const body = rows.map((r) => [
      r.structure,
      r.level ?? "",
      r.academicYear,
      r.item,
      String(r.amount),
    ]);
    return {
      ok: true,
      filename: schoolFile(school.name, "fees.csv"),
      csv: csvTemplate(headers, body),
      rows: body.length,
    };
  } catch {
    return { ok: false, error: "Could not export fees." };
  }
}
