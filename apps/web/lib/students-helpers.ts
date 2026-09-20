import { eq, sql } from "drizzle-orm";
import { students } from "@/db/schema";
import type { Tx } from "@/lib/db";

/**
 * Generate the next student code for a school: OS{YY}{NNNN}, e.g. OS260001.
 * Explicitly scoped by school_id (do not rely on RLS — the dev superuser bypasses it).
 * The unique(school_id, student_code) constraint is the final guard against races.
 */
export async function nextStudentCode(tx: Tx, schoolId: string): Promise<string> {
  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(students)
    .where(eq(students.schoolId, schoolId));
  const yy = String(new Date().getFullYear() % 100).padStart(2, "0");
  return `OS${yy}${String(count + 1).padStart(4, "0")}`;
}
