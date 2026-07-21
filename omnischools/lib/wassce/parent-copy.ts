/**
 * The parent-portal copy layer (SHS module 4.3 / INCR-19b) — every parent-facing STRING, PURE and
 * DB-free so it unit-tests in parent-copy.test.ts and a client component can import it without pulling
 * the server-only loader. This is where the staff→parent translation register lives (Kofi R1-R6, Lucy
 * Part I): the school owns the language, so NO staff jargon reaches a parent (the exclusion list is the
 * FORBIDDEN_JARGON regex below, asserted over every constant here). Nothing here reads a table; the
 * server loader (parent-portal-data.ts) feeds it already-parent-safe values.
 *
 * HARD RULES encoded here (not conventions — gate findings):
 *  • R2 — `Missed · medical` is a STAFF label; the parent pill is `Postponed · SC-12 filed`. A separate
 *    map (`parentSittingLabel`), never the shared staff constant. NEVER "Failed"/"Absent"/"In NaN days".
 *  • R3 — the signature line is honesty-corrected: the ack is STAFF-recorded, not challenge-proven, so it
 *    reads "Acknowledgement recorded by the school · confirmed by phone…" — NEVER "Phone-OTP signature",
 *    NEVER a HH:MM stamp (minute precision is what reads as cryptographic).
 *  • R6 — the cohort-tier `band` vocabulary (`AGGREGATE_BANDS`: "Top tier · 6–12", …) NEVER renders; the
 *    parent sees the numeric aggregate + the "lower is better" gloss only. `sanitizeSnapshot` strips it.
 */
import { MATCH_TIER_LABEL, cutOffLabel, type FrozenTargetUniversity } from "./university-match";

/* ─────────────────────────────────────────────────────────────────── small pure formatters ── */

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** "three" for 3 (≤ 9), else the numeral. Used for reader-friendly small counts ("three papers"). */
export function numberWord(n: number): string {
  return n >= 0 && n <= 9 ? NUMBER_WORDS[n] : String(n);
}

/** Initial + surname from a full name — "Ama Aidoo" → "A. Aidoo" (Lucy §0.4 header). */
export function initialSurname(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

/** Two-letter avatar initials — first + last initial ("Yaa Aidoo" → "YA"). */
export function avatarInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** guardianRelationEnum → title-case display ("MOTHER" → "Mother"). */
export function relationshipLabel(rel: string): string {
  const r = rel.trim().toLowerCase();
  return r ? r[0].toUpperCase() + r.slice(1) : "";
}

// All exam times are GMT (Accra); render in UTC so "14:45 GMT" doesn't drift with the server zone.
const LONG = new Intl.DateTimeFormat("en-GB", {
  weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
});
const SIG = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
});
const SHORT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
});

/** "Saturday 28 March 2026" — the long parent date (Lucy E.1: longer than the staff format). */
export function parentLongDate(d: Date): string {
  return LONG.format(d);
}
/** "28 March 2026" — NO time (R3: a HH:MM stamp reads as cryptographic; drop it). */
export function parentSignatureDate(d: Date): string {
  return SIG.format(d);
}
/** "Wed 3 Jun" — the schedule/next-paper short date. */
export function parentShortDate(d: Date): string {
  return SHORT.format(d);
}

/** Whole days from `today` (00:00) to a 'YYYY-MM-DD' date; null when the date is absent/unparseable
 *  (the guard that makes "In NaN days" unreachable — R2 / M.2). */
export function daysUntil(dateStr: string | null, today: Date): number | null {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return null;
  const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return Math.round((target.getTime() - base.getTime()) / 86_400_000);
}

/* ───────────────────────────────────────────────────────── §2 — the sitting pill map (R2) ── */

export type SittingPillKind = "sat" | "missed" | "next" | "upcoming";
export type SittingPill = { text: string; kind: SittingPillKind };

/** Inputs the pill derives from — all parent-safe (never a staff status label). */
export type SittingInput = {
  satAt: Date | null;
  exemptedAt: Date | null;
  scheduledDate: string | null; // 'YYYY-MM-DD'
  isNext: boolean; // the earliest future un-sat paper (computed by the caller across the list)
  scRejected: boolean; // the covering SC filing was REJECTED
};

/**
 * The parent sitting label (Kofi R2) — NEVER the staff `Missed · medical`. Exhaustive over the states:
 *   sat → "Sat · attended" · exempted+open-SC → "Postponed · SC-12 filed" · exempted+REJECTED-SC →
 *   "Not sat · school to advise" · earliest future → "Next paper · N days" · other future → "In N days"
 *   · null/unparseable date → "Upcoming" (NEVER "In NaN days").
 */
export function parentSittingLabel(input: SittingInput, today: Date): SittingPill {
  if (input.satAt) return { text: "Sat · attended", kind: "sat" };
  if (input.exemptedAt) {
    return input.scRejected
      ? { text: "Not sat · school to advise", kind: "missed" }
      : { text: "Postponed · SC-12 filed", kind: "missed" };
  }
  const days = daysUntil(input.scheduledDate, today);
  if (days == null) return { text: "Upcoming", kind: "upcoming" };
  const dayPhrase = `${days} ${days === 1 ? "day" : "days"}`;
  if (input.isNext) return { text: `Next paper · ${dayPhrase}`, kind: "next" };
  return { text: `In ${dayPhrase}`, kind: "upcoming" };
}

/** "08:00 · 1 hr 30 min · essay" — the parent-friendly paper meta (Lucy B.2). */
export function paperTimeLine(
  scheduledTime: string | null,
  durationMinutes: number | null,
  paperType: string,
): string {
  const parts: string[] = [];
  if (scheduledTime) parts.push(scheduledTime);
  if (durationMinutes != null) {
    const h = Math.floor(durationMinutes / 60);
    const m = durationMinutes % 60;
    const dur = h > 0 ? (m > 0 ? `${h} hr ${m} min` : `${h} ${h === 1 ? "hour" : "hours"}`) : `${m} minutes`;
    parts.push(dur);
  }
  if (paperType) parts.push(paperType.toLowerCase());
  return parts.join(" · ");
}

/* ─────────────────────────────────────────────────────── §1 — aggregate + target gloss (R1) ── */

/**
 * The aggregate DEFINITION (Kofi R1) — the one place the parent surface defines "aggregate". Conveys
 * best-SIX without exposing the best-3 mechanics (which are on the exclusion list).
 */
export const AGGREGATE_FAQ = {
  q: "What does the projected aggregate mean?",
  a: "An aggregate totals a student's results — each grade is worth points, 1 for A1 up to 9 for F9, and the six subjects that count are added together. A lower aggregate is better: 6 is the best possible, 54 the lowest.",
};

/** The primary target's display line — "KNUST · Biochemistry". */
export function targetLine(t: FrozenTargetUniversity): string {
  return `${t.shortName} · ${t.programmeName}`;
}

/**
 * The §1 child-card gloss (Kofi R1) — cut-off ALWAYS with its reference year (never bare), lower-is-better
 * stated in words, margin in "one point inside" prose. Degrades gracefully when off/on the cut-off.
 */
export function targetGloss(childFirst: string, t: FrozenTargetUniversity): string {
  const cut = cutOffLabel(t.cutOff, t.cutOffReferenceYear);
  const m = t.margin;
  const pts = `${numberWord(m.points)} ${m.points === 1 ? "point" : "points"}`;
  if (m.direction === "inside") {
    return `A lower aggregate is better — ${childFirst}'s projected ${t.projectedAggregate} is ${pts} inside ${t.shortName}'s cut-off of ${cut}, so ${childFirst} is on course for a first choice.`;
  }
  if (m.direction === "on") {
    return `A lower aggregate is better — ${childFirst}'s projected ${t.projectedAggregate} is right on ${t.shortName}'s cut-off of ${cut}.`;
  }
  return `A lower aggregate is better — ${childFirst}'s projected ${t.projectedAggregate} is ${pts} above ${t.shortName}'s cut-off of ${cut}; the school will talk you through the options.`;
}

/** The §1 target-meta read line — "Projected aggregate 10 · cut-off 11 (2025) · one point inside". */
export function targetMetaLine(t: FrozenTargetUniversity): string {
  const cut = cutOffLabel(t.cutOff, t.cutOffReferenceYear);
  const m = t.margin;
  const marginPhrase =
    m.direction === "on"
      ? "on the cut-off"
      : `${numberWord(m.points)} ${m.points === 1 ? "point" : "points"} ${m.direction}`;
  return `Projected aggregate ${t.projectedAggregate} · cut-off ${cut} · ${marginPhrase}`;
}

/** The §5 body's supporting-choice phrase — "Legon Biochemistry (comfortable)". Tier word used AND
 *  explained (the four tier words render bare, Kofi R2). Never the primary (that leads the sentence). */
export function supportingChoicePhrase(t: FrozenTargetUniversity): string {
  return `${t.shortName} ${t.programmeName} (${MATCH_TIER_LABEL[t.matchBand].toLowerCase()})`;
}

/* ─────────────────────────────────────────────── §1 — the live-case hero (SC public fields, R5) ── */

export type HeroSlots = {
  childFirst: string;
  missedCount: number; // exempted papers under the open SC
  filedTime: string | null; // parentShortDate(filedAt)
  acknowledged: boolean; // waec_acknowledged_at present
  makeUpCentre: string | null;
  nextPaperName: string | null;
  nextPaperDate: string | null; // parentShortDate
};

/** The hero headline — derived from the SC public fields, NOT reg_flag, NO ward/bed (Sickbay omitted). */
export function heroHeadline(s: HeroSlots): string {
  if (s.missedCount <= 0) {
    return `${s.childFirst}'s make-up sitting is in progress with WAEC.`;
  }
  const n = numberWord(s.missedCount);
  const papers = s.missedCount === 1 ? "paper has" : "papers have";
  return `${cap(n)} of ${s.childFirst}'s ${papers} been formally postponed by WAEC.`;
}

/** The hero body — a grammatical paragraph that OMITS any absent slot (Lucy A.1: degrade cleanly). */
export function heroBody(s: HeroSlots): string {
  const out: string[] = [];
  out.push(
    `We have filed the special-consideration form (SC-12) for ${s.childFirst}${s.filedTime ? ` on ${s.filedTime}` : ""}.`,
  );
  if (s.acknowledged) {
    out.push("WAEC's regional office has acknowledged the filing, so the papers are officially registered for a make-up sitting.");
  }
  out.push(
    `The postponed papers will be rescheduled${s.makeUpCentre ? ` at ${s.makeUpCentre}` : " by WAEC"}. We do not have the make-up date yet; WAEC will advise once the clinician confirms ${s.childFirst} is fit to sit.`,
  );
  if (s.nextPaperName && s.nextPaperDate) {
    out.push(`${cap(s.childFirst)}'s next paper at our centre is ${s.nextPaperName} on ${s.nextPaperDate}.`);
  }
  return out.join(" ");
}

/** The single hero cell that HAS a binding — "Next paper" (Sickbay cells 1-2 omitted, not em-dashed). */
export function nextPaperCell(nextPaperName: string | null, nextPaperDate: string | null, days: number | null) {
  if (!nextPaperName || !nextPaperDate) return null;
  return {
    label: "Next paper",
    value: `${nextPaperName} · ${nextPaperDate}`,
    meta: days != null ? `${days} ${days === 1 ? "day" : "days"} · fit-to-sit pending` : "fit-to-sit pending",
  };
}

/* ────────────────────────────────────────────────── §3 — the SC-12 5-step process (K.3, R3b) ── */

export type ScStepState = "done" | "active" | "pending";
export type ScStep = { n: number; label: string; state: ScStepState; meta: string | null };

/** The subtitle copy (rendered verbatim; Lucy O.5 flags the step-number contradiction — do not "fix"). */
export const SC_PROCESS_SUBTITLE =
  "The school is handling the paperwork. You and the clinician confirm fitness to sit.";
export const SC_PROCESS_TITLE = "Make-up sitting · the 5 steps";

/** The make-up window convention — ONE constant, so §3 and the FAQ can't diverge (Lucy O.9). */
export const WAEC_MAKEUP_WINDOW = "typically within 10 working days of the fit-to-sit confirmation";

export type ScProcessInput = {
  status: string; // FILED | ACKNOWLEDGED | APPROVED | SCHEDULED | COMPLETED (DRAFT filtered upstream)
  filedAt: Date | null;
  waecAcknowledgedAt: Date | null;
  makeUpScheduledAt: Date | null;
  makeUpCentre: string | null;
  completedAt: Date | null;
};

/**
 * The 5 parent steps derived from the SC public fields (Kofi K.3 recommend (b) — step 3 "Awaiting
 * fit-to-sit" has no column, so we pulse it and carry NO fabricated date). Never renders REJECTED (that
 * degrades away entirely, R3b) and never DRAFT (filtered in the loader).
 */
export function scSteps(sc: ScProcessInput): ScStep[] {
  const s = sc.status;
  const done = (cond: boolean): ScStepState => (cond ? "done" : "pending");
  const ge = (target: string) => STATUS_RANK[s] >= STATUS_RANK[target];

  const scheduled = ge("SCHEDULED");
  const completed = ge("COMPLETED");
  const acknowledged = ge("ACKNOWLEDGED");

  // Step 3 (fit-to-sit) is "active" once acknowledged and not yet scheduled (K.3: pulse, no date).
  const step3State: ScStepState = completed || scheduled ? "done" : acknowledged ? "active" : "pending";
  const step2State: ScStepState = acknowledged ? "done" : ge("FILED") ? "active" : "pending";

  return [
    { n: 1, label: "Filed", state: done(ge("FILED")), meta: sc.filedAt ? parentShortDate(sc.filedAt) : null },
    { n: 2, label: "Acknowledged by WAEC", state: step2State, meta: sc.waecAcknowledgedAt ? parentShortDate(sc.waecAcknowledgedAt) : null },
    { n: 3, label: "Awaiting fit-to-sit", state: step3State, meta: null },
    { n: 4, label: "Date scheduled", state: completed ? "done" : scheduled ? "done" : "pending", meta: sc.makeUpScheduledAt ? parentShortDate(sc.makeUpScheduledAt) : "By WAEC" },
    { n: 5, label: "Papers sat", state: completed ? "done" : scheduled ? "active" : "pending", meta: sc.makeUpCentre ?? null },
  ];
}

const STATUS_RANK: Record<string, number> = {
  DRAFT: 0, FILED: 1, ACKNOWLEDGED: 2, APPROVED: 3, SCHEDULED: 4, COMPLETED: 5, REJECTED: -1,
};

/** An SC filing is "open" (drives the hero + the live process card) when it is neither done nor rejected. */
export function isOpenSc(status: string): boolean {
  return status !== "COMPLETED" && status !== "REJECTED" && status !== "DRAFT";
}

export const SC_EXPLAINER_LEAD = "What the school is doing for you:";

/** The §3 explainer bullets (Lucy C.3) — staff NAMES generalised to role titles (per-child staff names
 *  are not parent-readable under the RLS boundary; omit-not-fake). makeUpCentre is a real SC field. */
export function scExplainerBullets(childFirst: string, makeUpCentre: string | null): string[] {
  const centre = makeUpCentre ?? "the WAEC regional office";
  return [
    `The Head of Academics has filed the SC-12 form with WAEC's regional office, together with the medical documentation.`,
    `WAEC has acknowledged the filing — this means they have the paperwork and ${childFirst} is officially registered as a candidate with special consideration.`,
    `The matron and the hospital clinician will assess ${childFirst}. If they confirm she is fit to sit, the school informs WAEC the same day.`,
    `WAEC then sets a make-up sitting date — ${WAEC_MAKEUP_WINDOW}. The make-up papers are taken at ${centre}, not here at the school.`,
    `The school will arrange transport and a teacher will accompany ${childFirst} on the day. You will be informed before, during, and after.`,
  ];
}

/** The REJECTED calm degrade line (Kofi R3b) — no pulsing card; the school reaches out. */
export function rejectedDegradeLine(childFirst: string): string {
  return `Some of ${childFirst}'s papers need follow-up — the Head of Academics will call you.`;
}

/* ─────────────────────────────────────────────────── §5 — readiness statement copy (R3, R6) ── */

/** The card title — "acknowledged on", NOT "you signed on" (Kofi R3). */
export function statementTitle(acknowledged: boolean, ackDate: Date | null): string {
  return acknowledged && ackDate
    ? `Mock 2 readiness statement · acknowledged on ${parentLongDate(ackDate)}`
    : `Mock 2 readiness statement`;
}

export const STATEMENT_SUBTITLE = "After the March mock cycle · before the WASSCE in May";

/** The §5 body — numeric aggregate + supporting choices + the verbatim concern; NO band (R6). */
export function statementBody(
  childFirst: string,
  aggregate: number | null,
  targets: FrozenTargetUniversity[],
  concern: string | null,
): string {
  const primary = targets.find((t) => t.isPrimary) ?? targets[0] ?? null;
  const supporting = targets.filter((t) => t !== primary);
  const out: string[] = [];
  if (aggregate != null) {
    out.push(`You acknowledged ${childFirst}'s projected aggregate of ${aggregate}, based on the Mock 2 results.`);
  }
  if (primary) {
    const support = supporting.length
      ? ` and ${supporting.map(supportingChoicePhrase).join(", ")}`
      : "";
    out.push(`The primary target is ${primary.shortName} ${primary.programmeName}${support}.`);
  }
  if (concern && concern.trim()) {
    out.push(`You raised one concern: "${concern.trim()}". The school noted it on the form.`);
  }
  return out.join(" ");
}

export type AckMethod = "PHONE_OTP" | "IN_PERSON" | "PDF_UPLOAD" | null;

/**
 * The signature line (Kofi R3, honesty-corrective) — the ack is STAFF-recorded, not challenge-proven.
 * NEVER "Phone-OTP signature", NEVER a HH:MM stamp. Null ack → no line (the caller renders the
 * not-acknowledged note + NO button instead).
 */
export function signatureLine(method: AckMethod, phone: string | null, ackDate: Date | null): string | null {
  if (!ackDate) return null;
  const date = parentSignatureDate(ackDate);
  switch (method) {
    case "PHONE_OTP":
      return `Acknowledgement recorded by the school · confirmed by phone${phone ? ` with ${phone}` : ""} on ${date}.`;
    case "IN_PERSON":
      return `Acknowledgement recorded by the school in person on ${date}.`;
    case "PDF_UPLOAD":
      return `A signed form was received by the school on ${date}.`;
    default:
      return `Acknowledgement recorded by the school on ${date}.`;
  }
}

/** The unsigned state (Kofi R3) — a note, NOT a sign/OTP button (a button makes it a write surface). */
export const NOT_ACKNOWLEDGED_NOTE = "Not yet acknowledged — the school will contact you.";

/* ─────────────────────────────────────────────────────────────── R4 — multi-school notice ── */

export function multiSchoolNotice(activeSchoolName: string): string {
  return `You have children registered at more than one school. This portal is showing ${activeSchoolName} only. To see a child at another school, contact that school's office.`;
}

/* ─────────────────────────────────────────────────────────────────────────── §5 — the FAQ ── */

export type FaqItem = { q: string; a: string };

export type FaqSlots = {
  childFirst: string;
  nextPaperName: string | null;
  nextPaperDate: string | null;
  makeUpCentre: string | null;
};

/** The SC-specific FAQ (shown only alongside an open SC — Lucy M.5). Staff names generalised; unbound
 *  dates dropped (fit-to-sit has no column, K.3) — only bound facts (next paper) are named. */
export function scFaqItems(s: FaqSlots): FaqItem[] {
  const centre = s.makeUpCentre ?? "the WAEC regional office";
  const nextPaper =
    s.nextPaperName && s.nextPaperDate ? `${s.nextPaperName} on ${s.nextPaperDate}` : "her next paper";
  return [
    {
      q: `Will ${s.childFirst} fail because of the postponed papers?`,
      a: `No. The SC-12 special-consideration process is exactly for this. WAEC will reschedule the postponed papers within the WASSCE window, and the aggregate calculation will include the grades from the make-up sitting — not zeros.`,
    },
    {
      q: "When will we know the make-up sitting date?",
      a: `After the fit-to-sit confirmation. WAEC then schedules the date and notifies the school and you by SMS — ${WAEC_MAKEUP_WINDOW}.`,
    },
    {
      q: `Will ${s.childFirst} be able to sit ${nextPaper}?`,
      a: `That depends on the matron and clinician's assessment. If ${s.childFirst} is well enough, she sits at the school centre as scheduled. If not, the school files an additional SC-12 and the Head of Academics will update you by phone.`,
    },
    {
      q: "How will I know about the make-up papers when they happen?",
      a: `You will get a phone call from the Head of Academics before the sitting, and a follow-up SMS confirming the date, time, and transport plan. On the day, the school collects ${s.childFirst}, accompanies her to ${centre}, and brings her back.`,
    },
  ];
}

/** The evergreen FAQ — true with or without an open SC. */
export const EVERGREEN_FAQ: FaqItem[] = [
  {
    q: "Do I need to come to the school?",
    a: "No. Everything that involves you happens by phone or through this portal. The heavy work is done by the school.",
  },
];

/* ───────────────────────────────────────────────────── R6 — the band-strip snapshot helper ── */

export type ParentSubjectRow = { name: string; type: string; grade: string; counted: boolean };
export type SanitizedSnapshot = { projectedAggregate: number | null; subjects: ParentSubjectRow[] };

/**
 * Strip the cohort-tier `band` vocabulary from the frozen snapshot (Kofi R6 / Lucy leak #3). Returns a
 * shape with NO `band` key and, if a per-subject panel is ever added, plain A1/B2 grades only — never a
 * tier label. Any non-object input → empty. The returned object is provably band-free (tested).
 */
export function sanitizeSnapshot(raw: unknown): SanitizedSnapshot {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const projectedAggregate =
    typeof src.projectedAggregate === "number" ? src.projectedAggregate : null;
  const rawSubjects = Array.isArray(src.subjects) ? src.subjects : [];
  const subjects: ParentSubjectRow[] = rawSubjects
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => ({
      name: typeof s.name === "string" ? s.name : "",
      type: typeof s.type === "string" ? s.type : "",
      grade: typeof s.grade === "string" ? s.grade : "",
      counted: s.counted === true,
    }));
  // NOTE: `band` is deliberately NOT copied out of `src`. Do not add it.
  return { projectedAggregate, subjects };
}

/* ──────────────────────────────────────────────── AC-COPY-3 — the forbidden-jargon guard ── */

/**
 * The staff vocabulary that must NEVER reach a parent (Kofi R2 exclusion list + the band labels + the
 * two banned rendered strings). The parent-copy test regexes EVERY exported constant/label against this
 * so a future copy edit that leaks jargon fails RED. Word-ish anchors keep innocent substrings safe
 * (e.g. "aggregate" and "Mock 2" are ALLOWED — they are used and explained).
 */
export const FORBIDDEN_JARGON: RegExp[] = [
  /\bmoderat/i, // moderated / moderation
  /\bpredictor\b/i,
  /\bbest[-\s]?3\b/i,
  /\btier\b/i,
  /\bcohort\b/i,
  /\bpercentile\b/i,
  /\bquartile\b/i,
  /\bdistribution\b/i,
  /\bof\s+240\b/i,
  /\bcredit[-\s]pass\b/i,
  /\bat[-\s]?risk\b/i,
  /\brank\b/i, // R2 exclusion — cohort position
  /\bdropped[-\s]subject\b/i, // R2 exclusion — best-3 mechanics
  /\braw\s+score\b/i,
  /\breg[_\s]?flag\b/i,
  /ON_MEDICAL/i,
  /\bsuperseded\b/i,
  /\bTop tier\b/i,
  /\bNo clear path\b/i,
  /\d\s*–\s*\d/, // an en-dash numeric range (the "· N–N" band range)
  /Phone[-\s]?OTP signature/i,
  /Missed\s*[·.]\s*medical/i,
  /\bFailed\b/,
  /\bAbsent\b/,
];

/** Every forbidden pattern that matches `text` (empty array = clean). Used by the test + assertable. */
export function findForbiddenJargon(text: string): string[] {
  return FORBIDDEN_JARGON.filter((re) => re.test(text)).map((re) => re.source);
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
