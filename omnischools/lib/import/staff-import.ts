import { isValidGhanaPhone, normalizePhone } from "./csv";
import { STAFF_ROLES } from "@/lib/staff-roles";
import { resolveQualification } from "@/lib/staff-qualifications";

/**
 * Staff bulk-import spec + validator. Pure + client-safe so the review table can
 * validate live. Column order matches the downloadable template. Mirrors the student
 * importer; phone is the login identity, email optional, role maps by label or code.
 * The columns after "Role" are OPTIONAL staff-profile fields (personal & contact,
 * qualifications & licensure) — they never error, only warn on unparseable values.
 */
export const STAFF_IMPORT_HEADERS = [
  "Full name",
  "Phone (login)",
  "Email",
  "Role",
  "Date of birth",
  "Gender",
  "Address",
  "Emergency contact",
  "Qualification level",
  "Highest qualification",
  "Undergraduate",
  "NTC licence no",
  "NTC licence expiry",
  "Specialisations",
];

export const STAFF_IMPORT_SAMPLE: string[][] = [
  [
    "Ama Owusu",
    "0244000001",
    "ama.owusu@example.com",
    "Teacher",
    "1988-04-12",
    "Male",
    "East Legon, Accra",
    "Mrs Mensah · spouse · 0244000099",
    "Masters",
    "M.Ed. Mathematics · UCC · 2019",
    "B.Sc. Mathematics · KNUST 2008",
    "TC-89241",
    "2026-08-31",
    "Calculus, Statistics",
  ],
  [
    "Kojo Mensah",
    "0209876543",
    "",
    "Bursar",
    "1988-04-12",
    "Male",
    "East Legon, Accra",
    "Mrs Mensah · spouse · 0244000099",
    "Masters",
    "M.Ed. Mathematics · UCC · 2019",
    "B.Sc. Mathematics · KNUST 2008",
    "TC-89241",
    "2026-08-31",
    "Calculus, Statistics",
  ],
  [
    "Yaa Asantewaa",
    "0271234567",
    "",
    "Form Master",
    "1988-04-12",
    "Male",
    "East Legon, Accra",
    "Mrs Mensah · spouse · 0244000099",
    "Masters",
    "M.Ed. Mathematics · UCC · 2019",
    "B.Sc. Mathematics · KNUST 2008",
    "TC-89241",
    "2026-08-31",
    "Calculus, Statistics",
  ],
];

export type StaffImportRow = {
  index: number; // 1-based data-row number for display
  fullName: string;
  phone: string; // normalised E.164 when valid
  email: string;
  roleLabel: string; // known label or the custom text (sent to the action verbatim)
  custom: boolean;
  // Optional staff-profile fields (all strings; "" when blank/unparseable).
  dateOfBirth: string; // "" or valid YYYY-MM-DD
  gender: string;
  address: string;
  emergencyContact: string;
  qualificationLevel: string; // RESOLVED code (e.g. "MASTERS"), or "" if unresolved/blank
  qualificationRaw: string; // original "Qualification level" text
  highestQualification: string;
  undergraduate: string;
  ntcLicenceNumber: string;
  ntcLicenceExpiry: string; // "" or valid YYYY-MM-DD
  specialisations: string;
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

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** True for a real YYYY-MM-DD calendar date (rejects e.g. 2024-13-40). */
const isIsoDate = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
};

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
    let roleLabel = "Teacher";
    let custom = false;
    if (!roleRaw) {
      warnings.push("Role blank — defaulting to Teacher");
    } else {
      const match = ROLE_BY_KEY.get(roleRaw.toLowerCase());
      if (match) {
        roleLabel = match.label;
      } else {
        roleLabel = roleRaw;
        custom = true;
        warnings.push(`Custom role "${roleRaw}" — will be created`);
      }
    }

    // ---- Optional staff-profile fields (cols 4..13). Never error, only warn. ----
    const dobRaw = get(4);
    let dateOfBirth = "";
    if (dobRaw) {
      if (isIsoDate(dobRaw)) dateOfBirth = dobRaw;
      else
        warnings.push(
          `Date of birth "${dobRaw}" isn't a valid YYYY-MM-DD date — will be left blank`,
        );
    }

    const gender = get(5);
    const address = get(6);
    const emergencyContact = get(7);

    const qualificationRaw = get(8);
    let qualificationLevel = "";
    if (qualificationRaw) {
      const code = resolveQualification(qualificationRaw);
      if (code) qualificationLevel = code;
      else
        warnings.push(
          `Unrecognised qualification level "${qualificationRaw}" — will be left blank`,
        );
    }

    const highestQualification = get(9);
    const undergraduate = get(10);
    const ntcLicenceNumber = get(11);

    const expiryRaw = get(12);
    let ntcLicenceExpiry = "";
    if (expiryRaw) {
      if (isIsoDate(expiryRaw)) ntcLicenceExpiry = expiryRaw;
      else
        warnings.push(
          `NTC licence expiry "${expiryRaw}" isn't a valid YYYY-MM-DD date — will be left blank`,
        );
    }

    const specialisations = get(13);

    return {
      index: i + 1,
      fullName,
      phone,
      email,
      roleLabel,
      custom,
      dateOfBirth,
      gender,
      address,
      emergencyContact,
      qualificationLevel,
      qualificationRaw,
      highestQualification,
      undergraduate,
      ntcLicenceNumber,
      ntcLicenceExpiry,
      specialisations,
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
