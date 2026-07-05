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

/** Roles that, on their own, restrict a user to the finance sections. */
export const FINANCE_ROLES = ["ACCOUNTANT", "BURSAR"];

/**
 * Senior (SHS) tier role groups. The score ledger is a teaching surface; the Vice
 * Headmaster progress view is management-only. STUDENT / PARENT never reach either.
 */
export const SENIOR_LEDGER_ROLES = [
  "ADMIN",
  "HEADMASTER",
  "VICE_HEADMASTER_ACADEMIC",
  "TEACHER",
  "FORM_MASTER",
];
export const SENIOR_MANAGEMENT_ROLES = [
  "ADMIN",
  "HEADMASTER",
  "VICE_HEADMASTER_ACADEMIC",
];

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
