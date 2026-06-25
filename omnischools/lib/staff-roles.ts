import type { AppRole } from "@/lib/auth";

/**
 * Staff-assignable roles (excludes STUDENT / PARENT). Shared by the Staff module's
 * server actions and UI so the catalogue stays in one place. Labels use Ghanaian
 * school vocabulary. Boarding roles apply to Senior schools; harmless for Basic.
 */
export const STAFF_ROLES = [
  { code: "ADMIN", label: "Administrator" },
  { code: "HEADMASTER", label: "Headmaster" },
  { code: "VICE_HEADMASTER_ACADEMIC", label: "Vice Headmaster (Academic)" },
  { code: "VICE_HEADMASTER_ADMIN", label: "Vice Headmaster (Administration)" },
  { code: "HEAD_OF_DEPARTMENT", label: "Head of Department" },
  { code: "TEACHER", label: "Teacher" },
  { code: "FORM_MASTER", label: "Form Master" },
  { code: "EXAMS_OFFICER", label: "Examinations Officer" },
  { code: "GUIDANCE_COUNSELLOR", label: "Guidance & Counselling" },
  { code: "SPORTS_MASTER", label: "Sports Master / Mistress" },
  { code: "LIBRARIAN", label: "Librarian" },
  { code: "BURSAR", label: "Bursar" },
  { code: "ACCOUNTANT", label: "Accountant" },
  { code: "HOUSEMASTER", label: "Housemaster" },
  { code: "DEAN_OF_BOARDING", label: "Dean of Boarding" },
  { code: "MATRON", label: "Matron" },
] as const satisfies ReadonlyArray<{ code: AppRole; label: string }>;

export type StaffRoleCode = (typeof STAFF_ROLES)[number]["code"];

export const STAFF_ROLE_CODES = STAFF_ROLES.map((r) => r.code) as [
  StaffRoleCode,
  ...StaffRoleCode[],
];

export const STAFF_ROLE_LABEL: Record<string, string> = Object.fromEntries(
  STAFF_ROLES.map((r) => [r.code, r.label]),
);

/** Roles that are NOT staff — used to include everyone else (incl. custom roles) as staff. */
export const NON_STAFF_ROLE_CODES = ["STUDENT", "PARENT"] as [string, ...string[]];

/** Academic/classroom roles — a staff member holding any of these counts as a teacher. */
export const TEACHING_ROLE_CODES = [
  "TEACHER",
  "FORM_MASTER",
  "HEAD_OF_DEPARTMENT",
  "VICE_HEADMASTER_ACADEMIC",
  "EXAMS_OFFICER",
  "GUIDANCE_COUNSELLOR",
  "SPORTS_MASTER",
];

/** True when a staff member's roles include a teaching role. */
export const isTeachingStaff = (codes: string[]): boolean =>
  codes.some((c) => TEACHING_ROLE_CODES.includes(c));

/** Slug a custom role label to a stable code, e.g. "Sports Master" → "SPORTS_MASTER". */
export function slugRole(label: string): string {
  return (
    label
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "ROLE"
  );
}

/**
 * Resolve a role input (a known code, a known label, or a free-typed custom label) to a
 * `{ code, label }`. Known roles map to their canonical code+label; anything else becomes
 * a custom role (slugged code + the typed text as the label).
 */
export function resolveRole(input: string): { code: string; label: string } {
  const v = input.trim();
  const known = STAFF_ROLES.find(
    (r) => r.code === v.toUpperCase() || r.label.toLowerCase() === v.toLowerCase(),
  );
  if (known) return { code: known.code, label: known.label };
  return { code: slugRole(v), label: v };
}

/** Display label for a role code, falling back to a humanised version of the code. */
export function roleLabel(code: string, dbLabel?: string | null): string {
  if (dbLabel) return dbLabel;
  if (STAFF_ROLE_LABEL[code]) return STAFF_ROLE_LABEL[code];
  return code
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
