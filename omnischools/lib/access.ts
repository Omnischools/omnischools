/**
 * Access policy for finance-only staff (Accountant / Bursar).
 *
 * When a user's *only* roles are finance roles — no admin, leadership, or teaching role
 * — they are confined to the billing-related sections of the app. This mirrors
 * schoolup-accountant-role §02 ("the accountant's view"): a delegated finance person
 * sees billing, fees, reports and books, plus read-only students & classes (so they can
 * look up who to invoice), and nothing else.
 *
 * Pure module — safe to import from both client (sidebar) and server (guards).
 */
import type { KnownAppRole } from "@/lib/auth";

/** Roles that, on their own, restrict a user to the finance sections. */
export const FINANCE_ROLES = ["ACCOUNTANT", "BURSAR"];

/**
 * Senior (SHS) tier role groups. The score ledger is a teaching surface (teachers + form
 * masters + academic leadership); the Vice Headmaster progress view is management-only
 * (Admin, Headmaster, Vice Headmaster Academic). STUDENT / PARENT never reach either.
 * `satisfies readonly KnownAppRole[]` makes a typo'd role code a compile error.
 */
export const SENIOR_LEDGER_ROLES = [
  "ADMIN",
  "HEADMASTER",
  "VICE_HEADMASTER_ACADEMIC",
  "TEACHER",
  "FORM_MASTER",
] as const satisfies readonly KnownAppRole[];
export const SENIOR_MANAGEMENT_ROLES = [
  "ADMIN",
  "HEADMASTER",
  "VICE_HEADMASTER_ACADEMIC",
] as const satisfies readonly KnownAppRole[];

/**
 * WASSCE setup/registration surface (SHS module 4.3 / INCR-15) — the frozen cohort spine is
 * school-wide leadership data: Admin + Headmaster + Vice Headmaster Academic (= Head of Academics;
 * the two freeze co-signers). Same set as SENIOR_MANAGEMENT_ROLES today but named per-surface so a
 * later WASSCE write-flow can diverge (e.g. a WAEC liaison) without touching the ledger gate.
 * STUDENT / PARENT / TEACHER never reach it.
 */
export const WASSCE_SETUP_ROLES = [
  "ADMIN",
  "HEADMASTER",
  "VICE_HEADMASTER_ACADEMIC",
] as const satisfies readonly KnownAppRole[];

/**
 * Boarding (SHS module 4.2 / INCR-7) — who may see and manage House rosters. Admin +
 * Headmaster + Dean of Boarding are school-scoped (any House); a plain HOUSEMASTER is
 * house-scoped (only the House they master — Kofi G4, enforced by `canAccessHouse`).
 * MATRON is sickbay-only and NOT here. STUDENT / PARENT / TEACHER never reach it.
 */
export const BOARDING_ROLES = [
  "ADMIN",
  "HEADMASTER",
  "DEAN_OF_BOARDING",
  "HOUSEMASTER",
] as const satisfies readonly KnownAppRole[];

/** Boarding roles that see EVERY House in the school (not confined to one they master). */
export const BOARDING_SCHOOL_SCOPED_ROLES = [
  "ADMIN",
  "HEADMASTER",
  "DEAN_OF_BOARDING",
] as const satisfies readonly KnownAppRole[];

/**
 * True when the user may view/reassign within a given House (Kofi G4). School-scoped roles
 * (Admin/Headmaster/Dean) reach any House; a plain HOUSEMASTER only the House whose
 * `hm_user_id` is their own user id. Pure — used by the page guard and the reassign action.
 */
export function canAccessHouse(
  roles: readonly string[],
  userId: string | null | undefined,
  houseHmUserId: string | null | undefined,
): boolean {
  if (hasAnyRole(roles, BOARDING_SCHOOL_SCOPED_ROLES)) return true;
  if (roles.includes("HOUSEMASTER")) {
    return !!userId && !!houseHmUserId && houseHmUserId === userId;
  }
  return false;
}

/** True when the user holds at least one of the allowed roles. */
export function hasAnyRole(
  roles: readonly string[],
  allowed: readonly string[],
): boolean {
  return roles.some((r) => allowed.includes(r));
}

/** Section prefixes a finance-only user may reach. Order-independent. */
export const FINANCE_SECTIONS = [
  "/billing",
  "/fees",
  "/reports",
  "/books",
  "/students",
  "/classes",
];

/** Sections a finance-only user may reach but only *read* (no create/edit/delete). */
export const FINANCE_READONLY_SECTIONS = ["/students", "/classes"];

/** Where a finance-only user lands — their billing dashboard. */
export const FINANCE_HOME = "/billing";

/**
 * True when every role the user holds is a finance role (and they hold at least one).
 * A user who is also ADMIN / TEACHER / HEADMASTER / etc. is NOT finance-only and keeps
 * full access.
 */
export function isFinanceOnly(roles: readonly string[]): boolean {
  const r = roles.filter(Boolean);
  return r.length > 0 && r.every((role) => FINANCE_ROLES.includes(role));
}

const matches = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(prefix + "/");

/** True when a finance-only user is allowed to load this path. */
export function pathAllowedForFinance(pathname: string): boolean {
  return FINANCE_SECTIONS.some((p) => matches(pathname, p));
}
