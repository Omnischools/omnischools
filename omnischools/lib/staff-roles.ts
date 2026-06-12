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
  { code: "TEACHER", label: "Teacher" },
  { code: "FORM_MASTER", label: "Form Master" },
  { code: "BURSAR", label: "Bursar" },
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
