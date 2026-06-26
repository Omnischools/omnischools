/**
 * Inbox topic vocabulary + lightweight keyword classifier. Pure + client-safe (the
 * rule builder uses TOPICS for its dropdowns; the inbound webhook uses detectTopic to
 * tag a thread before routing). Deterministic keyword matching — no ML. URGENT is
 * checked first so safety/injury messages always win.
 */
export const TOPICS = [
  { code: "URGENT", label: "Urgent / safety" },
  { code: "BILLING", label: "Billing & payments" },
  { code: "ATTENDANCE", label: "Attendance" },
  { code: "ACADEMIC", label: "Academic" },
  { code: "SCHEDULE", label: "Schedule & dates" },
  { code: "OTHER", label: "Other" },
] as const;

export type TopicCode = (typeof TOPICS)[number]["code"];

export const topicLabel = (code: string | null | undefined): string =>
  TOPICS.find((t) => t.code === code)?.label ?? "—";

// Checked in this order; first hit wins. URGENT first by design.
const TOPIC_KEYWORDS: { code: TopicCode; words: string[] }[] = [
  {
    code: "URGENT",
    words: [
      "hurt", "injured", "injury", "pushed", "blood", "bleed", "cut ", "fell",
      "fight", "emergency", "safety", "accident", "unsafe", "bullied", "bully",
    ],
  },
  {
    code: "BILLING",
    words: [
      "fee", "fees", "pay", "payment", "paid", "balance", "owe", "invoice",
      "receipt", "momo", "mobile money", "cedis", "ghs", "instalment",
      "installment", "arrears", "clear the balance", "school fees",
    ],
  },
  {
    code: "ATTENDANCE",
    words: [
      "absent", "won't be", "will not be", "not coming", "not be at school",
      "sick", "unwell", "doctor", "appointment", "late", "leave early",
      "permission", "off school",
    ],
  },
  {
    code: "ACADEMIC",
    words: [
      "report", "result", "grade", "score", "exam", "test", "homework",
      "teacher", "subject", "mark", "progress", "exercise book", "syllabus",
      "bece",
    ],
  },
  {
    code: "SCHEDULE",
    words: [
      "when does", "term end", "term start", "holiday", "calendar", "vacation",
      "reopen", "closing", "travel", "pta", "meeting", "what time", "what date",
    ],
  },
];

/** Classify a message body into a topic code. Returns "OTHER" when nothing matches. */
export function detectTopic(body: string | null | undefined): TopicCode {
  const text = (body ?? "").toLowerCase();
  if (!text.trim()) return "OTHER";
  for (const { code, words } of TOPIC_KEYWORDS) {
    if (words.some((w) => text.includes(w))) return code;
  }
  return "OTHER";
}
