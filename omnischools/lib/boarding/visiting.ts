/**
 * Boarding visiting day (SHS module 4.2 / INCR-12) — the PURE derivation + gate-check core for surface
 * 06 (the digital Visitor's Book). No DB, no I/O: every function here is deterministic and unit-tested
 * (visiting.test.ts). The server read layer (visiting-data.ts) fetches rows and delegates the shaping
 * here; the write actions (lib/actions/boarding-visiting.ts) validate + decide here. Keeping it pure
 * means RSVP-by-House, zone occupancy, the arrival counter and overstay are display-and-write
 * DERIVATIONS with ZERO storage (Kofi OQ5, AC K): no counter column, no occupancy column, no overstay
 * flag, no trigger.
 *
 * Time frame: Ghana runs on UTC (GMT+0), so a visiting window's wall-clock time == UTC. Every clock
 * comparison (overstay past hoursEnd+grace) uses UTC, never the runtime machine's local zone.
 *
 * PII discipline (AC J4 — the biggest external-PII surface in Boarding): visitor names/phones/ID hints
 * are adults' external PII. maskPhone() hands the client a masked string; names render in the authed
 * surface but NEVER reach a URL/SMS-log; the ID is a hint, not a document (no photo/QR).
 */
import { z } from "zod";

export type ApprovalStatus = "PENDING_REVIEW" | "APPROVED";
export type VisitStatus = "RSVP" | "ARRIVED" | "DEPARTED";
export type VisitVerification = "VERIFIED" | "FLAGGED" | "HM_AUTHORISED";

// ---------------------------------------------------------------------------
// Canonical constants (Kofi OQ3/OQ5) — the deboardinization-ladder pattern: fixed lib/ constants with
// `schoolId` in the getter signature (unused) so a future per-school override is not a cross-increment
// signature break. NO config table (YAGNI).
// ---------------------------------------------------------------------------

/** Max approved visitors per student — APP-enforced (no DB cardinality constraint); the 7th is rejected. */
export const MAX_APPROVED_VISITORS = 6;

/** Overstay grace past hoursEnd before the HM console SMS fires (surface: "past 4:15 PM"). */
export const OVERSTAY_GRACE_MIN = 15;
/** Senior-HM escalation tier past hoursEnd (surface: "past 4:30, Senior HM intervenes") — display only. */
export const SENIOR_HM_ESCALATION_MIN = 30;

export interface VisitorZone {
  key: string;
  label: string;
  /** The surface's "for all Houses" / "for weather backup" / "for private conversations" line. */
  forWhom: string;
  where: string;
  capacity: number;
}

/** The three visitor zones — surface 06 §Visitor zones verbatim (main lawn ~700 / dining ~300 / quad ~200). */
export const VISITOR_ZONES: readonly VisitorZone[] = [
  {
    key: "main_lawn",
    label: "Main lawn",
    forWhom: "For all Houses",
    where: "In front of admin block · shaded benches · sit on grass or own mats · most parents bring food",
    capacity: 700,
  },
  {
    key: "dining_annex",
    label: "Dining annex",
    forWhom: "For weather backup",
    where: "Adjacent to dining hall · indoor tables & chairs · families having lunch with students",
    capacity: 300,
  },
  {
    key: "library_quad",
    label: "Library quad",
    forWhom: "For private conversations",
    where: "Quieter, shaded · grandparents · pastoral conversations",
    capacity: 200,
  },
] as const;

/** Contract getter (schoolId accepted, unused — override-ready, deboardinization-ladder pattern). */
export function getVisitorZones(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  schoolId: string,
): readonly VisitorZone[] {
  return VISITOR_ZONES;
}

export const ZONE_CAP_TOTAL = VISITOR_ZONES.reduce((s, z) => s + z.capacity, 0);

/** A valid zone_key or null. Used to Zod-validate the gate-check zone (no arbitrary keys stored). */
export function isValidZoneKey(key: string | null | undefined): boolean {
  return key == null || VISITOR_ZONES.some((z) => z.key === key);
}

// ---------------------------------------------------------------------------
// PII masking (AC J4) — phone rendered masked, ID is a hint. Names render in the authed surface.
// ---------------------------------------------------------------------------

/**
 * Mask a phone to the surface form "+233 24 *** *** 91" — country code + first 2 + masked middle +
 * last 2. Never returns the full number. A too-short/blank value masks entirely. Ghana E.164 is
 * 233XXXXXXXXX; a non-233 international number keeps its leading + but still masks the middle.
 */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  let cc = "";
  let rest = digits;
  if (digits.startsWith("233")) {
    cc = "+233 ";
    rest = digits.slice(3);
  } else if (phone.trim().startsWith("+")) {
    cc = "+";
  }
  const first2 = rest.slice(0, 2);
  const last2 = rest.slice(-2);
  return `${cc}${first2} *** *** ${last2}`;
}

// ---------------------------------------------------------------------------
// formScope cohort (AC E) — a VISITING event's form_scope shrinks the expected cohort (FORMS_1_2 → F3
// excluded). null → whole school. The seed's "Forms 1 & 2 only" event carries formScope='FORMS_1_2'.
// ---------------------------------------------------------------------------

/** True when a boarder's Form is inside the event's scope. FORMS_1_2 → F1/F2 only; null → all. */
export function formInScope(form: number | null, formScope: string | null): boolean {
  if (!formScope || formScope === "ALL") return true;
  if (formScope === "FORMS_1_2") return form === 1 || form === 2;
  const m = formScope.match(/([123])/);
  if (m) return form === Number(m[1]);
  return true;
}

/** Human label for the event's form scope, or null for whole-school. */
export function formScopeLabel(formScope: string | null): string | null {
  if (!formScope || formScope === "ALL") return null;
  if (formScope === "FORMS_1_2") return "Forms 1 & 2 only";
  const m = formScope.match(/([123])/);
  return m ? `Form ${m[1]} only` : formScope;
}

// ---------------------------------------------------------------------------
// Gate list-check (AC C) — list-CHECK not list-RECORD (§2 tenet). SAFE default FLAGGED; only an
// APPROVED match verifies; a PENDING_REVIEW entry at the gate is FLAGGED. Admitting a FLAGGED visit
// needs an actor-stamped HM override → HM_AUTHORISED (never silent, never a hard turn-away).
// ---------------------------------------------------------------------------

/**
 * The verification a visit gets from the list check. An APPROVED matched entry → VERIFIED; anything
 * else (no match / a PENDING_REVIEW entry) → FLAGGED (the safe default). NEVER returns HM_AUTHORISED —
 * that is only ever set by an explicit actor-stamped override (applyHmOverride), never by the list check.
 */
export function verifyAgainstList(
  match: { status: ApprovalStatus } | null | undefined,
): Exclude<VisitVerification, "HM_AUTHORISED"> {
  return match?.status === "APPROVED" ? "VERIFIED" : "FLAGGED";
}

/** Only a FLAGGED visit can be HM-overridden to admit; a VERIFIED/already-authorised visit cannot. */
export function canAuthorise(verification: VisitVerification): boolean {
  return verification === "FLAGGED";
}

// ---------------------------------------------------------------------------
// Two-stamp in/out (AC D) — mirrors the exeat depart/return. Arrive stamps arrived_at; depart stamps
// departed_at and is rejected before an arrival; departed_at must be ≥ arrived_at.
// ---------------------------------------------------------------------------

/** A visit may be departed only once it has ARRIVED (has an arrival stamp). Depart-before-arrive → false. */
export function canDepart(visit: { status: VisitStatus; arrivedAt: Date | null }): boolean {
  return visit.status === "ARRIVED" && visit.arrivedAt != null;
}

/** The out-stamp must be at or after the in-stamp (AC D4). */
export function departAfterArrive(arrivedAt: Date, departedAt: Date): boolean {
  return departedAt.getTime() >= arrivedAt.getTime();
}

// ---------------------------------------------------------------------------
// Overstay on-read (AC G) — no cron, no stored flag. Overstaying = ARRIVED ∧ no depart ∧ now past
// hoursEnd + grace. A +30m tier is a derived DISPLAY escalation (no extra send). Departed → not over.
// ---------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Whole minutes `now` is past the event's hoursEnd on `dateIso` (negative before close). */
export function minutesPastEnd(dateIso: string, hoursEnd: string, now: Date): number {
  const [h, m] = hoursEnd.split(":").map(Number);
  const end = new Date(`${dateIso}T${pad2(h)}:${pad2(m)}:00Z`).getTime();
  return Math.floor((now.getTime() - end) / 60000);
}

export type OverstayState = "none" | "overstay" | "senior";

/**
 * The overstay state of a visit, DERIVED from the clock alone (AC G1/G4/G5). A visit that has not
 * arrived, or has already departed, is never overstaying. Past hoursEnd+15m → "overstay" (HM SMS);
 * past hoursEnd+30m → "senior" (Senior-HM display tier, no extra send).
 */
export function overstayState(
  visit: { status: VisitStatus; departedAt: Date | null },
  dateIso: string,
  hoursEnd: string,
  now: Date,
): OverstayState {
  if (visit.status !== "ARRIVED" || visit.departedAt != null) return "none";
  const mins = minutesPastEnd(dateIso, hoursEnd, now);
  if (mins > SENIOR_HM_ESCALATION_MIN) return "senior";
  if (mins > OVERSTAY_GRACE_MIN) return "overstay";
  return "none";
}

/** Convenience predicate — the visit is past close + grace (either tier). */
export function isOverstaying(
  visit: { status: VisitStatus; departedAt: Date | null },
  dateIso: string,
  hoursEnd: string,
  now: Date,
): boolean {
  return overstayState(visit, dateIso, hoursEnd, now) !== "none";
}

// ---------------------------------------------------------------------------
// RSVP-by-House (AC E) — derived per accessible House, respecting formScope. Cohort = ACTIVE ∧ BOARDER
// (the data layer filters those before calling); this shapes the counters with NO stored counter.
// ---------------------------------------------------------------------------

export interface RsvpBoarder {
  studentId: string;
  houseId: string;
  form: number | null;
}
export interface RsvpVisit {
  studentId: string;
  arrived: boolean; // has an arrival stamp (ARRIVED or DEPARTED)
}
export interface HouseRsvp {
  houseId: string;
  expected: number; // boarders in scope
  rsvpd: number; // distinct in-scope students with ≥1 visit
  arrived: number; // distinct in-scope students with an arrived visit
  pct: number; // rsvpd / expected
  byForm: { form: number; expected: number; rsvpd: number }[];
}

/**
 * Per-House RSVP counters (AC E1/E2/E3). `expected` counts only boarders whose Form is inside the
 * event's `formScope` (FORMS_1_2 excludes F3 — E2); a null scope counts the whole school (E3). `rsvpd`/
 * `arrived` count DISTINCT in-scope students (a student with two visitor RSVPs counts once). Per-Form
 * breakdown for Forms 1–3. All from row counts — no counter column (E1).
 */
export function deriveRsvpByHouse(
  boarders: readonly RsvpBoarder[],
  visits: readonly RsvpVisit[],
  formScope: string | null,
): Map<string, HouseRsvp> {
  const inScope = boarders.filter((b) => formInScope(b.form, formScope));
  const rsvpStudents = new Set(visits.map((v) => v.studentId));
  const arrivedStudents = new Set(visits.filter((v) => v.arrived).map((v) => v.studentId));

  const byHouse = new Map<string, RsvpBoarder[]>();
  for (const b of inScope) {
    const list = byHouse.get(b.houseId) ?? [];
    list.push(b);
    byHouse.set(b.houseId, list);
  }

  const out = new Map<string, HouseRsvp>();
  for (const [houseId, list] of byHouse) {
    const expected = list.length;
    const rsvpd = list.filter((b) => rsvpStudents.has(b.studentId)).length;
    const arrived = list.filter((b) => arrivedStudents.has(b.studentId)).length;
    const byForm = [1, 2, 3]
      .map((form) => {
        const inForm = list.filter((b) => b.form === form);
        return {
          form,
          expected: inForm.length,
          rsvpd: inForm.filter((b) => rsvpStudents.has(b.studentId)).length,
        };
      })
      .filter((f) => f.expected > 0);
    out.set(houseId, {
      houseId,
      expected,
      rsvpd,
      arrived,
      pct: expected > 0 ? Math.round((rsvpd / expected) * 100) : 0,
      byForm,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Zone occupancy + arrival counter (AC F / summary cards) — derived, nothing stored.
// ---------------------------------------------------------------------------

export interface ZoneVisit {
  zoneKey: string | null;
  onCampus: boolean; // ARRIVED and not DEPARTED
}
export interface ZoneOccupancy extends VisitorZone {
  occupancy: number;
  pct: number;
}

/** Per-zone occupancy = on-campus (ARRIVED-not-DEPARTED) visits carrying that zone_key (AC F3). Advisory. */
export function deriveZoneOccupancy(
  zones: readonly VisitorZone[],
  visits: readonly ZoneVisit[],
): ZoneOccupancy[] {
  return zones.map((z) => {
    const occupancy = visits.filter((v) => v.onCampus && v.zoneKey === z.key).length;
    return { ...z, occupancy, pct: z.capacity > 0 ? Math.round((occupancy / z.capacity) * 100) : 0 };
  });
}

export interface StatVisit {
  studentId: string;
  arrivedAt: Date | null;
  departedAt: Date | null;
}
export interface VisitStats {
  rsvpVisits: number; // total visit rows (RSVPs received)
  expectingStudents: number; // distinct boarders with ≥1 visit
  arrivedVisits: number; // visits with an arrival stamp
  onCampus: number; // arrived and not departed
  departed: number; // visits with a departure stamp
}

/** The 5-summary-card + arrival-counter tallies, all DERIVED from the visit rows (AC K). */
export function deriveVisitStats(visits: readonly StatVisit[]): VisitStats {
  const expecting = new Set(visits.map((v) => v.studentId));
  let arrivedVisits = 0;
  let onCampus = 0;
  let departed = 0;
  for (const v of visits) {
    if (v.arrivedAt) arrivedVisits += 1;
    if (v.departedAt) departed += 1;
    if (v.arrivedAt && !v.departedAt) onCampus += 1;
  }
  return {
    rsvpVisits: visits.length,
    expectingStudents: expecting.size,
    arrivedVisits,
    onCampus,
    departed,
  };
}

// ---------------------------------------------------------------------------
// Indicated-arrivals list-match display (AC C, the two-flag-vocab distinction — Lucy). Three DISTINCT
// visual states are computed here: the `.approved` column (VERIFIED / +N NEEDS REVIEW / FLAGGED / HM),
// distinct from the pastoral row highlight (isPastorallyFlagged — pastoral-stub) and from the security
// FLAGGED gate state. The pastoral highlight is added by the data layer, NOT here.
// ---------------------------------------------------------------------------

export type ListMatchKind = "verified" | "review" | "flagged" | "hm";
export interface ListMatch {
  kind: ListMatchKind;
  label: string;
}

/**
 * The indicated-arrivals `.approved` column display for one visit (AC C, Lucy two-flag-vocab). VERIFIED
 * (green) on an APPROVED match; HM_AUTHORISED → "HM OK" (a navy security tag); a still-FLAGGED visit
 * shows the GOLD "+N NEEDS REVIEW → Review" pre-arrival (opens the approved-visitor editor) when the
 * student has pending list entries, else the RED security "FLAGGED" tag once at the gate. `pendingCount`
 * is the count of the student's PENDING_REVIEW approved visitors.
 */
export function listMatchOf(
  verification: VisitVerification,
  status: VisitStatus,
  pendingCount: number,
): ListMatch {
  if (verification === "VERIFIED") return { kind: "verified", label: "VERIFIED" };
  if (verification === "HM_AUTHORISED") return { kind: "hm", label: "HM AUTHORISED" };
  // FLAGGED — pre-arrival with a pending list entry reads as the gold review affordance; at/after the
  // gate (or with no pending entry) it reads as the red security flag.
  if (status === "RSVP" && pendingCount > 0) {
    return { kind: "review", label: `+${pendingCount} NEEDS REVIEW` };
  }
  return { kind: "flagged", label: "FLAGGED" };
}

// ---------------------------------------------------------------------------
// SMS bodies (AC I) — console provider, pure copy builders. NEVER include an ID hint / full masked
// address; only the recipient's own delivery to_phone leaves the system (handled by the caller).
// ---------------------------------------------------------------------------

export type NotificationKind =
  | "INVITATION"
  | "REMINDER_T3"
  | "REMINDER_T1"
  | "ARRIVAL_CONFIRM"
  | "OVERSTAY";

/** True when a kind is cohort/event-scoped (visit_id NULL) vs per-visit (AC I1). */
export function isCohortKind(kind: NotificationKind): boolean {
  return kind === "INVITATION" || kind === "REMINDER_T3" || kind === "REMINDER_T1";
}

export function cohortSms(
  kind: "INVITATION" | "REMINDER_T3" | "REMINDER_T1",
  schoolName: string,
  dateLabel: string,
  hoursStart: string,
  hoursEnd: string,
): string {
  const window = `${hoursStart}–${hoursEnd}`;
  if (kind === "INVITATION") {
    return `${schoolName}: Visiting Sunday is ${dateLabel}, ${window}. Reply to indicate if you will attend. Approved visitors only; bring your ID.`;
  }
  const which = kind === "REMINDER_T3" ? "in 3 days" : "tomorrow";
  return `${schoolName}: reminder — Visiting Sunday is ${which} (${dateLabel}, ${window}). Please let the school know if you are coming.`;
}

export function arrivalConfirmSms(
  studentName: string,
  schoolName: string,
  pastoral: boolean,
): string {
  return pastoral
    ? `${schoolName}: ${studentName}'s visitor has arrived and checked in. Housemaster to check in personally (pastoral-active).`
    : `${schoolName}: ${studentName}'s visitor has arrived and checked in for Visiting Sunday.`;
}

export function overstaySms(studentName: string, schoolName: string, hoursEnd: string): string {
  return `${schoolName}: ${studentName}'s visitor is still on campus past ${hoursEnd} (gate close). Please see them off.`;
}

// ---------------------------------------------------------------------------
// Zod input schemas (Kofi/Dex — Zod-in-lib, no DB CHECK). Validated by the actions.
// ---------------------------------------------------------------------------

const phoneSchema = z
  .string()
  .trim()
  .max(20)
  .regex(/^\+?[0-9 ()-]{6,20}$/u, "Enter a valid phone number.")
  .optional();

/** Add/edit an approved visitor (per student). relationship is free text (open-ended, not an enum). */
export const approvedVisitorInputSchema = z.object({
  studentId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  relationship: z.string().trim().min(2).max(60),
  phone: phoneSchema,
  idHint: z.string().trim().max(120).optional(),
  pastoralReview: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
});
export type ApprovedVisitorInput = z.infer<typeof approvedVisitorInputSchema>;

const zoneKeySchema = z
  .string()
  .refine((k) => isValidZoneKey(k), "Unknown visitor zone.")
  .optional();

/**
 * Record a visit at the gate. Either an approved-visitor is chosen (approvedVisitorId — the list-check
 * path) OR a walk-in is typed (visitorName + relationship). `action` picks the stamp: RSVP (indicated,
 * pre-arrival) or ARRIVE (in-stamp now; a walk-in always arrives directly — D5).
 */
export const recordVisitInputSchema = z
  .object({
    studentId: z.string().uuid(),
    calendarEventId: z.string().uuid().nullable().optional(),
    approvedVisitorId: z.string().uuid().nullable().optional(),
    visitorName: z.string().trim().min(2).max(120).optional(),
    relationship: z.string().trim().min(2).max(60).optional(),
    phone: phoneSchema,
    zoneKey: zoneKeySchema,
    action: z.enum(["RSVP", "ARRIVE"]),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => !!v.approvedVisitorId || (!!v.visitorName && !!v.relationship), {
    message: "Pick an approved visitor, or enter a walk-in name + relationship.",
  });
export type RecordVisitInput = z.infer<typeof recordVisitInputSchema>;
