/**
 * Shared, client-safe types + pure helpers for the WhatsApp template authoring UI
 * (schoolup-whatsapp-template-authoring). No DB imports here — the composer, the
 * preview card and the status page all use these on both server and client.
 */

export const CATEGORIES = ["UTILITY", "MARKETING"] as const;
export type Category = (typeof CATEGORIES)[number];

export const LANGUAGES = [
  { code: "en_GH", label: "English (Ghana)" },
  { code: "tw", label: "Twi" },
  { code: "gaa", label: "Ga" },
] as const;
export type Language = (typeof LANGUAGES)[number]["code"];

export const HEADER_TYPES = ["NONE", "TEXT", "IMAGE", "DOCUMENT"] as const;
export type HeaderType = (typeof HEADER_TYPES)[number];

export const BUTTON_TYPES = ["URL", "PHONE", "QUICK_REPLY"] as const;
export type ButtonType = (typeof BUTTON_TYPES)[number];

export const STATUSES = ["DRAFT", "PENDING", "APPROVED", "REJECTED"] as const;
export type TemplateStatus = (typeof STATUSES)[number];

export type TemplateButton = {
  type: ButtonType;
  label: string;
  value?: string;
};

/** Variable chips offered in the composer. */
export const VARIABLE_CHIPS = [
  "{parent_name}",
  "{student_name}",
  "{term}",
  "{school_name}",
] as const;

/** The shape the composer + preview + detail pages share. */
export type TemplateShape = {
  name: string;
  category: Category;
  language: Language;
  headerType: HeaderType;
  headerText: string | null;
  headerFilename: string | null;
  body: string;
  footer: string | null;
  buttons: TemplateButton[];
  sampleValues: Record<string, string>;
};

const VAR_RE = /\{[a-z_]+\}/g;

/** Every distinct `{variable}` referenced in the body + a TEXT header, in first-seen order. */
export function extractVariables(body: string, headerText?: string | null): string[] {
  const seen: string[] = [];
  for (const source of [headerText ?? "", body ?? ""]) {
    const matches = source.match(VAR_RE) ?? [];
    for (const m of matches) if (!seen.includes(m)) seen.push(m);
  }
  return seen;
}

/** Replace every `{variable}` with its sample value (or leave the token if none given). */
export function fillSampleValues(
  text: string | null | undefined,
  sampleValues: Record<string, string>,
): string {
  if (!text) return "";
  return text.replace(VAR_RE, (m) => {
    const v = sampleValues[m];
    return v && v.trim() ? v : m;
  });
}

export function languageLabel(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

export function categoryLabel(code: string): string {
  return code === "MARKETING" ? "Marketing" : "Utility";
}

export function buttonTypeLabel(type: string): string {
  if (type === "URL") return "Visit website";
  if (type === "PHONE") return "Call";
  return "Quick reply";
}

/** Meta routes a template through manual review when it's Marketing, has a document
 * header, or carries 2+ buttons — mirrors the stub in submitTemplate. */
export function needsManualReview(t: {
  category: string;
  headerType: string;
  buttons: unknown;
}): boolean {
  const count = Array.isArray(t.buttons) ? t.buttons.length : 0;
  return t.category === "MARKETING" || t.headerType === "DOCUMENT" || count >= 2;
}

/** Tailwind classes for a status badge — solid tokens only (no slash-opacity). */
export const STATUS_BADGE: Record<TemplateStatus, string> = {
  DRAFT: "bg-bg text-navy-3 border border-border-2",
  PENDING: "bg-warn-bg text-warn",
  APPROVED: "bg-green-bg text-green",
  REJECTED: "bg-terra-bg text-terra",
};

export const STATUS_LABEL: Record<TemplateStatus, string> = {
  DRAFT: "Draft",
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};
