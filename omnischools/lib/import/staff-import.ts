import { isValidGhanaPhone, normalizePhone } from "./csv";
import { STAFF_ROLES, type StaffRoleCode } from "@/lib/staff-roles";

/**
 * Staff bulk-import spec + validator. Pure + client-safe so the review table can
 * validate live. Column order matches the downloadable template. Mirrors the student
 * importer; phone is the login identity, email optional, role maps by label or code.
 */
export const STAFF_IMPORT_HEADERS = [
  "Full name",
  "Phone (login)",
  "Email",
  "Role",
];

export const STAFF_IMPORT_SAMPLE: string[][] = [
  ["Ama Owusu", "0244000001", "ama.owusu@example.com", "Teacher"],
  ["Kojo Mensah", "0209876543", "", "Bursar"],
  ["Yaa Asantewaa", "0271234567", "", "Form Master"],
];

export type StaffImportRow = {
  index: number; // 1-based data-row number for display
  fullName: string;
  phone: string; // normalised E.164 when valid
  email: string;
  role: StaffRoleCode;
  roleLabel: string;
  errors: string[];
  warnings: string[];
};

export type ImportSummary = {
  total: number;
  ready: number;
  warning: number;
  error: number;
};

const ROLE_BY_KEY = new Map<string, (typeof STAFF_ROLES)[number]>();
for (const r of STAFF_ROLES) {
  ROLE_BY_KEY.set(r.code.toLowerCase(), r);
  ROLE_BY_KEY.set(r.label.toLowerCase(), r);
}
const ROLE_NAMES = STAFF_ROLES.map((r) => r.label).join(", ");

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** Validate parsed data rows (excluding the header). Flags duplicate phones in-file. */
export function validateStaffRows(dataRows: string[][]): {
  rows: StaffImportRow[];
  summary: ImportSummary;
} {
  const seenPhones = new Set<string>();

  const rows = dataRows.map((cells, i): StaffImportRow => {
    const get = (n: number) => (cells[n] ?? "").trim();
    const errors: string[] = [];
    const warnings: string[] = [];

    const fullName = get(0);
    if (fullName.length < 2) errors.push("Full name is required");

    const phoneRaw = get(1);
    let phone = "";
    if (!phoneRaw) {
      errors.push("Phone is required (it's their login)");
    } else if (isValidGhanaPhone(phoneRaw)) {
      phone = normalizePhone(phoneRaw);
      if (seenPhones.has(phone)) errors.push("Duplicate phone in this file");
      else seenPhones.add(phone);
    } else {
      errors.push("Phone is invalid (10 digits or +233…)");
    }

    const email = get(2);
    if (email && !isEmail(email)) errors.push("Email is invalid");

    const roleRaw = get(3);
    let role: StaffRoleCode = "TEACHER";
    let roleLabel = "Teacher";
    if (!roleRaw) {
      warnings.push("Role blank — defaulting to Teacher");
    } else {
      const match = ROLE_BY_KEY.get(roleRaw.toLowerCase());
      if (match) {
        role = match.code;
        roleLabel = match.label;
      } else {
        errors.push(`Unknown role "${roleRaw}" — use one of: ${ROLE_NAMES}`);
      }
    }

    return { index: i + 1, fullName, phone, email, role, roleLabel, errors, warnings };
  });

  const summary: ImportSummary = {
    total: rows.length,
    ready: rows.filter((r) => r.errors.length === 0 && r.warnings.length === 0).length,
    warning: rows.filter((r) => r.errors.length === 0 && r.warnings.length > 0).length,
    error: rows.filter((r) => r.errors.length > 0).length,
  };
  return { rows, summary };
}
