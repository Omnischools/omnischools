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

export const STATUSES = [
  "DRAFT",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "ARCHIVED",
] as const;
export type TemplateStatus = (typeof STATUSES)[number];

export type TemplateButton = {
  type: ButtonType;
  label: string;
  value?: string;
};

/** Variable chips offered in the composer body toolbar (the "Insert variable" row). */
export const VARIABLE_CHIPS = [
  "{parent_name}",
  "{student_name}",
  "{term}",
  "{school_name}",
] as const;

/** Extra variables surfaced behind the "+ More" chip. */
export const MORE_VARIABLE_CHIPS = [
  "{amount}",
  "{due_date}",
  "{class_name}",
  "{report_id}",
] as const;

/**
 * Category tile metadata for the composer's three-tile picker. Authentication is
 * present but disabled — OTPs route through SMS in Omnischools.
 */
export const CATEGORY_META: {
  value: Category | "AUTHENTICATION";
  name: string;
  desc: string;
  tag?: string;
  tagTone?: "green" | "muted";
  disabled?: boolean;
}[] = [
  {
    value: "UTILITY",
    name: "Utility",
    desc: "Transactional notifications, account updates",
    tag: "Most used",
    tagTone: "green",
  },
  {
    value: "MARKETING",
    name: "Marketing",
    desc: "General announcements, school events",
  },
  {
    value: "AUTHENTICATION",
    name: "Authentication",
    desc: "OTPs route through SMS in Omnischools",
    tag: "SMS only",
    tagTone: "muted",
    disabled: true,
  },
];

/**
 * Where each variable's real value comes from in production — shown in the
 * "Variables & sample data" panel next to each row. Unknown variables fall back
 * to "from your data".
 */
export const SAMPLE_SOURCES: Record<string, string> = {
  "{parent_name}": "from guardian record",
  "{student_name}": "from student record",
  "{term}": "from school calendar",
  "{school_name}": "from school settings · always full name",
  "{amount}": "from billing record",
  "{due_date}": "from billing record",
  "{class_name}": "from student record",
  "{report_id}": "from report record",
};

/** The production source hint for a variable (falls back to "from your data"). */
export function sampleSource(variable: string): string {
  return SAMPLE_SOURCES[variable] ?? "from your data";
}

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

/**
 * Split text into runs of plain copy and substituted `{variable}` values so the
 * preview can wrap each filled value in a gold highlight chip. A `{variable}` with
 * no sample value stays as plain text (the raw token). Runs are merged so adjacent
 * plain text collapses into one segment.
 */
export type FilledSegment = { text: string; filled: boolean };

export function fillSampleSegments(
  text: string | null | undefined,
  sampleValues: Record<string, string>,
): FilledSegment[] {
  if (!text) return [];
  const segments: FilledSegment[] = [];
  let last = 0;
  const re = new RegExp(VAR_RE.source, "g");
  let m: RegExpExecArray | null;
  const pushPlain = (s: string) => {
    if (!s) return;
    const prev = segments[segments.length - 1];
    if (prev && !prev.filled) prev.text += s;
    else segments.push({ text: s, filled: false });
  };
  while ((m = re.exec(text)) !== null) {
    pushPlain(text.slice(last, m.index));
    const sample = sampleValues[m[0]];
    if (sample && sample.trim()) segments.push({ text: sample, filled: true });
    else pushPlain(m[0]);
    last = m.index + m[0].length;
  }
  pushPlain(text.slice(last));
  return segments;
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
  ARCHIVED: "bg-bg text-navy-3 border border-border-2",
};

export const STATUS_LABEL: Record<TemplateStatus, string> = {
  DRAFT: "Draft",
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ARCHIVED: "Archived",
};

// ---- status-page pipeline timeline --------------------------------------

export type TimelineState = "done" | "current" | "future";

export type TimelineStep = {
  /** Numeric marker, or a glyph (✓ / ⋯ / ×) for the final decision step. */
  marker: string;
  name: string;
  when: string;
  state: TimelineState;
  /** terra tint for the rejected decision step. */
  tone?: "terra";
};

export type TimelineInput = {
  status: TemplateStatus;
  createdAt: Date | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  updatedAt: Date | null;
};

const stepWhen = (d: Date | null): string =>
  d
    ? new Date(d).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

/**
 * Build the five-step review pipeline (Drafted → Submitted → Auto-checks →
 * Manual review → Decision) with done / current / future dot states derived from
 * the row. Timestamps are shown where known; placeholders ("in queue",
 * "expected", "—") otherwise. Intermediate auto-check / manual-review exact times
 * are Meta-API dependent and stubbed — we anchor them to submittedAt / decidedAt.
 */
export function buildTimeline(row: TimelineInput): TimelineStep[] {
  const drafted = stepWhen(row.createdAt ?? row.updatedAt);
  const submitted = stepWhen(row.submittedAt);
  const decided = stepWhen(row.decidedAt);

  switch (row.status) {
    case "PENDING":
      return [
        { marker: "1", name: "Drafted", when: drafted, state: "done" },
        { marker: "2", name: "Submitted", when: submitted, state: "done" },
        {
          marker: "3",
          name: "Auto-checks passed",
          when: submitted,
          state: "done",
        },
        { marker: "⋯", name: "Manual review", when: "in queue", state: "current" },
        { marker: "5", name: "Decision", when: "expected", state: "future" },
      ];
    case "APPROVED":
      return [
        { marker: "1", name: "Drafted", when: drafted, state: "done" },
        { marker: "2", name: "Submitted", when: submitted, state: "done" },
        {
          marker: "3",
          name: "Auto-checks passed",
          when: submitted,
          state: "done",
        },
        { marker: "4", name: "Manual review", when: submitted, state: "done" },
        { marker: "✓", name: "Approved", when: decided, state: "current" },
      ];
    case "REJECTED":
      return [
        { marker: "1", name: "Drafted", when: drafted, state: "done" },
        { marker: "2", name: "Submitted", when: submitted, state: "done" },
        {
          marker: "3",
          name: "Auto-checks passed",
          when: submitted,
          state: "done",
        },
        { marker: "4", name: "Manual review", when: submitted, state: "done" },
        {
          marker: "×",
          name: "Rejected",
          when: decided,
          state: "current",
          tone: "terra",
        },
      ];
    // DRAFT (and ARCHIVED) — only the first step is done.
    default:
      return [
        { marker: "1", name: "Drafted", when: drafted, state: "current" },
        { marker: "2", name: "Submitted", when: "—", state: "future" },
        {
          marker: "3",
          name: "Auto-checks passed",
          when: "—",
          state: "future",
        },
        { marker: "4", name: "Manual review", when: "—", state: "future" },
        { marker: "5", name: "Decision", when: "—", state: "future" },
      ];
  }
}
