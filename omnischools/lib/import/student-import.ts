import { isValidGhanaPhone, normalizePhone } from "./csv";

/**
 * Student bulk-import spec + validator. Pure + client-safe so the review table can
 * validate live. Column order matches the downloadable template.
 */
export const STUDENT_IMPORT_HEADERS = [
  "First name",
  "Last name",
  "Other names",
  "Gender (M/F)",
  "Date of birth (YYYY-MM-DD)",
  "Class",
  "Guardian name",
  "Guardian phone",
  "Relationship (Mother/Father/Guardian)",
];

export const STUDENT_IMPORT_SAMPLE: string[][] = [
  [
    "Akosua",
    "Boateng",
    "",
    "F",
    "2014-05-12",
    "JHS 1A",
    "Ama Boateng",
    "0241112222",
    "Mother",
  ],
  ["Kwame", "Mensah", "Kofi", "M", "2013-09-01", "", "", "", ""],
];

export type RelationCode = "MOTHER" | "FATHER" | "GUARDIAN" | "OTHER";

export type StudentRow = {
  index: number; // 1-based data-row number for display
  firstName: string;
  lastName: string;
  otherNames: string;
  sex: "MALE" | "FEMALE" | null;
  dateOfBirth: string | null;
  className: string;
  classId: string | null;
  guardianName: string;
  guardianPhone: string; // normalised E.164 when valid
  relationship: RelationCode;
  errors: string[];
  warnings: string[];
};

export type ImportSummary = {
  total: number;
  ready: number;
  warning: number;
  error: number;
};

const isIsoDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

function normSex(v: string): "MALE" | "FEMALE" | null {
  const s = v.trim().toUpperCase();
  if (["M", "MALE", "BOY"].includes(s)) return "MALE";
  if (["F", "FEMALE", "GIRL"].includes(s)) return "FEMALE";
  return null;
}

function normRelation(v: string): RelationCode {
  const s = v.trim().toUpperCase();
  if (s.startsWith("MOTH")) return "MOTHER";
  if (s.startsWith("FATH")) return "FATHER";
  if (s === "OTHER") return "OTHER";
  return "GUARDIAN";
}

/** Validate parsed data rows (excluding the header) against the school's classes. */
export function validateStudentRows(
  dataRows: string[][],
  classByName: Record<string, string>,
): { rows: StudentRow[]; summary: ImportSummary } {
  const lookup = new Map(
    Object.entries(classByName).map(([name, id]) => [name.trim().toLowerCase(), id]),
  );

  const rows = dataRows.map((cells, i): StudentRow => {
    const get = (n: number) => (cells[n] ?? "").trim();
    const errors: string[] = [];
    const warnings: string[] = [];

    const firstName = get(0);
    const lastName = get(1);
    const otherNames = get(2);
    if (!firstName) errors.push("First name is required");
    if (!lastName) errors.push("Last name is required");

    const sex = normSex(get(3));
    if (!sex) errors.push("Gender must be M or F");

    const dobRaw = get(4);
    let dateOfBirth: string | null = null;
    if (dobRaw) {
      if (isIsoDate(dobRaw)) dateOfBirth = dobRaw;
      else errors.push("Date of birth must be YYYY-MM-DD");
    }

    const className = get(5);
    let classId: string | null = null;
    if (className) {
      classId = lookup.get(className.toLowerCase()) ?? null;
      if (!classId) warnings.push(`Class "${className}" not found — imported unassigned`);
    }

    const guardianName = get(6);
    const guardianPhoneRaw = get(7);
    let guardianPhone = "";
    if (guardianPhoneRaw) {
      if (isValidGhanaPhone(guardianPhoneRaw))
        guardianPhone = normalizePhone(guardianPhoneRaw);
      else errors.push("Guardian phone is invalid (10 digits or +233…)");
    }
    if (guardianName && !guardianPhoneRaw)
      warnings.push("Guardian has no phone — won't be invited");
    if (!guardianName && !guardianPhoneRaw)
      warnings.push("No guardian — parent won't be invited");

    return {
      index: i + 1,
      firstName,
      lastName,
      otherNames,
      sex,
      dateOfBirth,
      className,
      classId,
      guardianName,
      guardianPhone,
      relationship: normRelation(get(8)),
      errors,
      warnings,
    };
  });

  const summary: ImportSummary = {
    total: rows.length,
    ready: rows.filter((r) => r.errors.length === 0 && r.warnings.length === 0).length,
    warning: rows.filter((r) => r.errors.length === 0 && r.warnings.length > 0).length,
    error: rows.filter((r) => r.errors.length > 0).length,
  };
  return { rows, summary };
}
