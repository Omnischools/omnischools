/**
 * Sickbay VISIT lifecycle — PURE, DB-free, unit-tested (visits.test.ts). SHS module 4.4 / INCR-22a.
 *
 * The R24 precedent, applied to the clinical trunk: every rule that spans rows lives HERE as a
 * function of plain values, and `lib/actions/sickbay-visit.ts` is the thin server shell that fetches
 * rows, calls these, and writes. No trigger, no derived column, no DB CHECK (portability).
 *
 * 🔴 R32 — THERE IS NO STATUS COLUMN, and you must not add one. The state is DERIVED from four
 * timestamps plus the admission's `discharged_at`. A stored enum can disagree with its own
 * timestamps, which is the R10 stored-count failure again.
 */

// ============================================================================
// Shapes — the projection of sickbay_visit / sickbay_admission these rules read
// ============================================================================

/** Mirrors db/schema/_enums.ts `sickbay_disposition`. R46: ADMIT/REFER fire 22b's attendance hook. */
export type SickbayDisposition = "DISCHARGE" | "ADMIT" | "REFER";

/**
 * The seven states a visit can be in. NOT an enum column, NOT stored, NOT written anywhere —
 * `visitState()` is the only producer and it is a pure function of the timestamps.
 *
 * ON_WARD_DISCHARGED is distinct from DISCHARGED on purpose (Lucy W11): the visit's OUTCOME was an
 * admission, and `disposition` stays ADMIT forever. "Discharged from the ward" is the admission
 * ending, not the disposition changing — R36 makes the disposition immutable once set.
 */
export type VisitState =
  | "QUEUED"
  | "IN_PROGRESS"
  | "DISCHARGED"
  | "ADMITTED"
  | "ON_WARD_DISCHARGED"
  | "REFERRED"
  | "VOIDED";

/** The four timestamps + the disposition. Everything else on the visit row is content, not state. */
export interface VisitTimeline {
  presentedAt: Date;
  startedAt: Date | null;
  disposition: SickbayDisposition | null;
  dispositionAt: Date | null;
  voidedAt: Date | null;
}

/** The fifth timestamp, and the only one that does not live on the visit (R64/8). */
export interface AdmissionTimeline {
  dischargedAt: Date | null;
}

// ============================================================================
// R32 — the derived state
// ============================================================================

/**
 * The whole of R32 in one expression. Order matters and is the medico-legal order:
 *
 *   voided_at set                    → VOIDED   (retracted; legal only while open, R37)
 *   disposition ADMIT + discharged   → ON_WARD_DISCHARGED
 *   disposition ADMIT                → ADMITTED
 *   disposition DISCHARGE            → DISCHARGED
 *   disposition REFER                → REFERRED
 *   started_at set                   → IN_PROGRESS
 *   otherwise                        → QUEUED
 *
 * `dispositionAt` is carried on the shape (and audited) but is deliberately NOT read here: the
 * disposition VALUE is what closes a visit. A row with a disposition and a null stamp is a bug in
 * the writer, not a fifth state — and inventing an eighth state for it would hide that bug.
 */
export function visitState(
  visit: VisitTimeline,
  admission?: AdmissionTimeline | null,
): VisitState {
  if (visit.voidedAt) return "VOIDED";
  switch (visit.disposition) {
    case "ADMIT":
      return admission?.dischargedAt ? "ON_WARD_DISCHARGED" : "ADMITTED";
    case "DISCHARGE":
      return "DISCHARGED";
    case "REFER":
      return "REFERRED";
    default:
      return visit.startedAt ? "IN_PROGRESS" : "QUEUED";
  }
}

/** A visit nobody has closed or retracted — the predicate every write guard starts from. */
export function isOpen(visit: Pick<VisitTimeline, "disposition" | "voidedAt">): boolean {
  return visit.disposition === null && visit.voidedAt === null;
}

// ============================================================================
// R33 — the queue predicate and the wait clock
// ============================================================================

/**
 * Ghana keeps UTC+0 all year with no DST, so the UTC calendar date IS the Accra civil date — the
 * repo-wide idiom (`lib/auth/roles.ts:47`, `lib/boarding/daily-life.ts`). Same reasoning, same call.
 */
export function civilDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * R33 — QUEUED means: not voided, not started, no disposition, and presented TODAY. The civil-day
 * clause is what stops last night's forgotten open visit from sitting at the top of this morning's
 * bench-side queue for the rest of the term; it stays OPEN (and still blocks a second open visit for
 * that student), it just is not "waiting now".
 */
export function isQueued(
  visit: Pick<VisitTimeline, "presentedAt" | "startedAt" | "disposition" | "voidedAt">,
  now: Date,
): boolean {
  return (
    isOpen(visit) && visit.startedAt === null && civilDate(visit.presentedAt) === civilDate(now)
  );
}

/**
 * R33 — the wait clock STOPS AT `Begin visit`, not at assessment. Once the matron has begun, the
 * number stops growing: a matron mid-consultation is not making that student wait, and a clock that
 * kept running would rank a patient she is treating above one nobody has seen.
 */
export function waitMs(
  visit: Pick<VisitTimeline, "presentedAt" | "startedAt">,
  now: Date,
): number {
  return Math.max(0, (visit.startedAt ?? now).getTime() - visit.presentedAt.getTime());
}

/** `05h 31m` — zero-padded hours, the status strip's `Time on ward` format (Lucy V1.3 tile 2). */
export function formatElapsed(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}h ${String(mins % 60).padStart(2, "0")}m`;
}

// ============================================================================
// R34/R36/R37 — the write guards. Each returns a NAMED error or null.
// ============================================================================

/** What the disposition guard needs to know that the visit row cannot tell it. */
export interface DispositionContext {
  /** R34/Sarah-advisory-2: `attending_user_id` points at the GLOBAL ref_user, so the DB cannot
   *  check the clinician belongs to this school. `holdsMatronRole()` is the ONLY tenancy guard on
   *  it — the caller resolves it and passes the answer here. Do not weaken it. */
  attendingIsMatron: boolean;
  /** From the shipped `sickbayCapabilities(mode).admissions` — never a mode string compared inline. */
  admissionsAllowed: boolean;
}

/**
 * R34 — the four preconditions, plus R36 (immutable) and R55 (Mode C refuses ADMIT AT THE ACTION).
 *
 * `working_impression` is required for **ADMIT and REFER only**. A routine discharge is a Tier-1
 * non-event: forcing prose onto a 40-second dressing change produces garbage, not a record.
 */
export function dispositionGuard(
  visit: VisitTimeline & { presentingComplaint: string; workingImpression: string | null },
  disposition: SickbayDisposition,
  ctx: DispositionContext,
): string | null {
  if (visit.voidedAt) return "This visit was voided and cannot be given a disposition.";
  // R36 — immutable once set. An ADMIT that later needs a hospital is INCR-25's referral EVENT,
  // never an overwrite: over-writing would destroy the record of what was decided when.
  if (visit.disposition) {
    return `This visit is already closed as ${DISPOSITION_LABEL[visit.disposition]} and cannot be changed.`;
  }
  if (!visit.startedAt) return "Begin the visit before recording a disposition.";
  if (!visit.presentingComplaint.trim()) {
    return "Record the presenting complaint before recording a disposition.";
  }
  if (!ctx.attendingIsMatron) {
    return "The attending clinician must hold the Matron role in this school.";
  }
  if (disposition === "ADMIT" && !ctx.admissionsAllowed) {
    // R55 — refused at the SERVER, not hidden in the UI. Mode C is ~49% of public SHS and it is a
    // first-class state, so the reason is NAMED rather than the control silently doing nothing.
    return "This school is referral-only — it has no on-site beds, so a patient cannot be admitted. Discharge or refer instead.";
  }
  if (disposition !== "DISCHARGE" && !visit.workingImpression?.trim()) {
    return `Record a working impression before you ${disposition === "ADMIT" ? "admit" : "refer"} this student.`;
  }
  return null;
}

/** How a closed visit reads back in an error string. Never a "diagnosis" word anywhere (R43). */
export const DISPOSITION_LABEL: Record<SickbayDisposition, string> = {
  DISCHARGE: "Discharged",
  ADMIT: "Admitted",
  REFER: "Referred",
};

/**
 * R37 — a visit is VOIDABLE ONLY WHILE OPEN, and a reason is required. An open visit on the wrong
 * student is an active attendance-coercion source, so it must be retractable; a closed one is the
 * record. Nothing in 4.4 is ever hard-deleted — no code path in 22a issues a DELETE.
 *
 * Because void is legal only while `disposition IS NULL`, and only ADMIT/REFER write attendance,
 * voiding can never touch an attendance row BY CONSTRUCTION (22b relies on this).
 */
export function voidGuard(visit: VisitTimeline, reason: string): string | null {
  if (visit.voidedAt) return "This visit has already been voided.";
  if (visit.disposition) {
    return `This visit is closed as ${DISPOSITION_LABEL[visit.disposition]} — a closed visit is the record and cannot be voided.`;
  }
  if (!reason.trim()) return "Give a reason for voiding this visit.";
  return null;
}

/**
 * R57 — `admission.is_isolation` MUST EQUAL `bed.is_isolation`. Isolation is a property of the CASE,
 * so there is no judgment call and no overflow in EITHER direction: a full general pool never spills
 * into isolation (R9's two pools that never merge), and an isolation case never lands in a general
 * bed because that one was free.
 */
export function isolationGuard(bedIsIsolation: boolean, requestedIsolation: boolean): string | null {
  if (bedIsIsolation === requestedIsolation) return null;
  return bedIsIsolation
    ? "That is an isolation bed — an isolation bed can only take an isolation admission."
    : "That is a general bed — an isolation admission needs an isolation bed.";
}

// ============================================================================
// R56 — the mode guard INCR-21 recorded and could not test
// ============================================================================

/**
 * R56 — reject a switch to REFERRAL_ONLY while ANY admission is open, in the R11 error grammar:
 * name the count, name the beds, say nothing was saved. Open VISITS do not block (they need no bed
 * and Mode C keeps the visit record); only occupied BEDS do, because Mode C asserts the school has
 * none and there is a patient lying in one.
 */
export function referralOnlyGuard(openAdmissionBedNumbers: readonly number[]): string | null {
  if (openAdmissionBedNumbers.length === 0) return null;
  const n = openAdmissionBedNumbers.length;
  const beds = [...openAdmissionBedNumbers].sort((a, b) => a - b).join(", ");
  return (
    `Cannot switch to referral-only — ${n} patient${n === 1 ? " is" : "s are"} still admitted ` +
    `(bed ${beds}). Discharge ${n === 1 ? "that patient" : "those patients"} first. Nothing was saved.`
  );
}
