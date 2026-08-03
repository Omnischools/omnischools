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
 * 🔴 Who may administer STAFF — create, edit, delete, set pay, and above all ASSIGN ROLES.
 *
 * This is the school's authorization root. `role_assignment` is the table every other guard in the
 * product reads (`requireSchool`→`isStaff`, `requireSchoolRole`, `isFinanceOnly`, and the sickbay
 * clinical boundary's `chronic_clinical_role`), so an actor who can write it can grant themselves
 * anything downstream. Before this group existed, every action in `lib/actions/staff.ts` was gated
 * by `requireSchool()` alone — which since PR #176 means "authenticated + is staff" — and `ADMIN` is
 * on the same assignable list that /staff renders for every row, so ANY staff member could open
 * /staff, find their own row and become Administrator in three clicks.
 *
 * Deliberately narrow. Widening it is a decision about who may mint administrators, not a
 * convenience tweak; `VICE_HEADMASTER_ACADEMIC` is the obvious candidate if a school asks.
 *
 * 🔴 INCR-37 — PROPRIETOR joins the root. The governance model (owner Option A) is that the
 * proprietor's power IS appointing/role-granting, so it belongs here and NOT in the operational
 * groups. This lifts INCR-35's deliberate "do NOT add PROPRIETOR to STAFF_ADMIN_ROLES" inertness
 * guard. Widening the SET is not widening the ESCALATION: `canGrantRole` still forbids a member
 * from granting a role that OUTRANKS them, so an ADMIN reaching these actions still cannot mint a
 * PROPRIETOR.
 */
export const STAFF_ADMIN_ROLES = [
  "ADMIN",
  "HEADMASTER",
  "PROPRIETOR",
] as const satisfies readonly KnownAppRole[];

/**
 * 🔴 INCR-35 (L2b) — who may open the user-management surface and block / reset / activate OTHER users.
 * PROPRIETOR (top rank) + ADMIN + HEADMASTER. DISTINCT PURPOSE from STAFF_ADMIN_ROLES: this gates
 * login-lifecycle verbs (block/reset/activate) over ALL users incl. parents, whereas STAFF_ADMIN_ROLES
 * gates role-GRANTING. Membership here is only the FIRST gate; the SECOND is `canManageTarget` (you must
 * also strictly outrank the specific target). NB (INCR-37): PROPRIETOR is now ALSO in STAFF_ADMIN_ROLES
 * (its governance power is appointing/granting) — the two groups overlap by design; `canGrantRole` is
 * what stops an ADMIN minting a PROPRIETOR, not the group membership.
 */
export const USER_ADMIN_ROLES = [
  "PROPRIETOR",
  "ADMIN",
  "HEADMASTER",
] as const satisfies readonly KnownAppRole[];

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

/**
 * Sickbay (SHS module 4.4 / INCR-21) — TWO gates on one surface, and the split is load-bearing
 * (Kofi R18/R19). The MATRON READS the module (it is her staff list, her bed inventory and her
 * working hours) but CANNOT WRITE the §1/§2 configuration: not the mode, not the beds, not the
 * schedule. Grounding: the surface's sidebar footer is the Headmaster on §1/§2/§4/§5 and switches to
 * the Matron on §3 alone — two write scopes on one page; INCR-21 builds only the Headmaster one.
 * §3 (standing orders / drug stock) flips to [ADMIN, MATRON] at INCR-24.
 *
 * HOUSEMASTER is deliberately NOT a member: a Housemaster's reach into a student's health data is
 * grant-scoped at INCR-23, never role-scoped. STUDENT / PARENT / TEACHER never reach either gate.
 */
export const SICKBAY_ROLES = [
  "ADMIN",
  "HEADMASTER",
  "MATRON",
] as const satisfies readonly KnownAppRole[];
export const SICKBAY_CONFIG_WRITE_ROLES = [
  "ADMIN",
  "HEADMASTER",
] as const satisfies readonly KnownAppRole[];

/**
 * Sickbay §3 — standing orders / drug stock / the controlled-substance register (SHS module 4.4 /
 * INCR-24a). The ONE gate where the MATRON GAINS write and the HEADMASTER LOSES it, inverting §1/§2
 * (Kofi R165): §3 is the Matron's clinical-supply authority, so [ADMIN, MATRON] write. Grounding —
 * the surface's sidebar footer switches from the Headmaster to the Matron on §3 alone.
 *
 * READ of §3 stays the module gate SICKBAY_ROLES (ADMIN / HEADMASTER / MATRON): §3 is config, not the
 * clinical graph, and ADMIN reading a drug list is exactly why R162 forbids a student name on it. The
 * MAR's tighter SICKBAY_CLINICAL_* pair is a separate boundary (24b).
 *
 * HOUSEMASTER / STUDENT / PARENT / TEACHER never reach it.
 */
export const SICKBAY_STOCK_WRITE_ROLES = [
  "ADMIN",
  "MATRON",
] as const satisfies readonly KnownAppRole[];

/**
 * Sickbay CLINICAL gates (SHS module 4.4 / INCR-22a) — the visit record's first real clinical data,
 * and a SEPARATE, tighter pair from the module gate above. Owner decision D2 + Kofi R39/R40 + Lucy
 * Q2 (rated build-blocking):
 *
 *   • WRITE = MATRON ONLY. The Headmaster READS but must never author a clinical impression; the
 *     ADMIN (proprietor/IT) is not a clinician. Every clinical actor on both surfaces is the Matron.
 *   • READ  = HEADMASTER + MATRON. ⚠️ NOT the same as SICKBAY_ROLES — that set contains ADMIN, and
 *     reusing it as the clinical read gate would hand the proprietor/IT account EVERY student's
 *     impression, vitals and complaint for a whole increment. ADMIN keeps module access (setup) and
 *     gets NO clinical detail; a per-student, expiring grant arrives at INCR-23, which EXTENDS this
 *     gate (`role ∈ READ || hasGrant(actor, student)`) rather than replacing it.
 *
 * HOUSEMASTER is a member of NEITHER: an HM's reach into health data is grant-scoped at INCR-23,
 * never role-scoped. STUDENT / PARENT / TEACHER never reach either.
 */
export const SICKBAY_CLINICAL_READ_ROLES = [
  "HEADMASTER",
  "MATRON",
] as const satisfies readonly KnownAppRole[];
export const SICKBAY_CLINICAL_WRITE_ROLES = [
  "MATRON",
] as const satisfies readonly KnownAppRole[];

/**
 * Sickbay NHIS RECONCILIATION read (SHS module 4.4 / INCR-27 · R219/R223). The §R5 outstanding-cost
 * reconciliation is FINANCE-owned and STRUCTURALLY clinical-free (it reads `sickbay_referral_cost_line`,
 * which has no condition column): a BURSAR reads it clinical-free, and the MATRON may read it too (her
 * name is in the audit; sickbay creates the cost, billing carries it). Deliberately DIFFERENT from the
 * clinical read: the 30-day history's condition column is NOT finance-readable, and a BURSAR never
 * reaches it. HEADMASTER is NOT here (the clinical reader has the history; this is the money view).
 */
export const SICKBAY_RECON_READ_ROLES = [
  "ACCOUNTANT",
  "BURSAR",
  "MATRON",
] as const satisfies readonly KnownAppRole[];

/**
 * VLC — Values Learning Communities (SHS module 4.5 / INCR-40) — the config spine's two gates,
 * mirroring the boarding "Dean writes, Headmaster reads" shape. WRITE (programme cadence, phase
 * durations, value names, session prompts) = DEAN_OF_STUDENTS + ADMIN. READ (the setup surface,
 * read-only for HM/FM) = the write pair + HEADMASTER + FORM_MASTER.
 *
 * DEAN_OF_STUDENTS is INERT everywhere else: it appears in NO other group, so `rankOf` returns 1
 * (any other staff role) and a Dean can never mint an ADMIN/HEADMASTER/PROPRIETOR (`canGrantRole`).
 * `as const satisfies readonly KnownAppRole[]` makes a typo'd code a compile error.
 */
export const VLC_CONFIG_WRITE_ROLES = [
  "DEAN_OF_STUDENTS",
  "ADMIN",
] as const satisfies readonly KnownAppRole[];
export const VLC_CONFIG_READ_ROLES = [
  "DEAN_OF_STUDENTS",
  "ADMIN",
  "HEADMASTER",
  "FORM_MASTER",
] as const satisfies readonly KnownAppRole[];

/**
 * VLC PASTORAL flag (SHS module 4.5 / INCR-42b) — the module's FIRST confidential pastoral-PII gate, and
 * a SEPARATE, tighter pair than the config gates above (mirrors the SICKBAY_CLINICAL_* narrow-gate shape,
 * owner-locked b+c). READ = WRITE = FORM_MASTER + DEAN_OF_STUDENTS ONLY.
 *
 *   • ADMIN + HEADMASTER are DELIBERATELY ABSENT. They are in VLC_CONFIG_READ_ROLES (they see the whole
 *     OPERATIONAL register) but must get NOTHING pastoral — reusing the wider config set as the flag gate
 *     would hand the proprietor/IT account every class's confidential welfare flag.
 *   • This is only the ROLE arm. FORM_MASTER here does NOT mean "every form master reads every flag": the
 *     confidential reader (lib/vlc/pastoral-data.ts) + the actions narrow the FM arm to an OWN-CLASS
 *     IDENTITY match (the flagged student's class.class_teacher_user_id === caller.userId) via
 *     `canAccessPastoralFlag` / `canWritePastoralFlag` (lib/vlc/authz.ts). A bare FORM_MASTER role check
 *     would be the IDOR this increment exists to prevent. The DEAN arm is school-wide (the pastoral
 *     authority); no own-class clause for the Dean.
 *
 * STUDENT / PARENT / PEER-GUIDE never reach either (a PG is not even in VLC_CONFIG_READ_ROLES; the PG is a
 * `surfaced_by` DATA field, never a writer — owner c).
 */
export const VLC_PASTORAL_READ_ROLES = [
  "FORM_MASTER",
  "DEAN_OF_STUDENTS",
] as const satisfies readonly KnownAppRole[];
export const VLC_PASTORAL_WRITE_ROLES = [
  "FORM_MASTER",
  "DEAN_OF_STUDENTS",
] as const satisfies readonly KnownAppRole[];

/**
 * 🔴 INCR-43b — VLC CHARACTER PARAGRAPH read set — the ONE VLC gate the HEADMASTER is admitted to, and the
 * module's ONLY wider-than-FM+Dean read (owner #2, paragraph-only). READ = own-class FM + Dean + HEADMASTER.
 *
 * DELIBERATELY SEPARATE from VLC_PASTORAL_READ_ROLES (which stays FM+DEAN, HM-free): the 43a casework
 * journal/note/observation/case remain invisible to the Headmaster. Only the FM-authored school-leaver
 * character paragraph widens to him, through a SEPARATE reader (lib/vlc/paragraph-data.ts) behind a
 * SEPARATE route (/senior/vlc/reference/[studentId]) — never getStudentCasework, never the journal page.
 *
 *   • This is only the ROLE arm. FORM_MASTER here does NOT mean "every form master reads every paragraph":
 *     the reader + the actions narrow the FM arm to an OWN-CLASS IDENTITY match via `canReadPastoralParagraph`
 *     / `canWritePastoralFlag` (lib/vlc/authz.ts). A bare FORM_MASTER role check would be an IDOR. The DEAN
 *     and HEADMASTER arms are school-wide (no own-class clause).
 *   • WRITE (author / edit / lock) stays VLC_PASTORAL_WRITE_ROLES + `canWritePastoralFlag` — HM is NOT there
 *     (read-only). The HM read is FINALISED-ONLY (locked paragraphs), enforced in the reader.
 *
 * ADMIN / STUDENT / PARENT / PEER-GUIDE never reach it.
 */
export const VLC_PARAGRAPH_READ_ROLES = [
  "FORM_MASTER",
  "DEAN_OF_STUDENTS",
  "HEADMASTER",
] as const satisfies readonly KnownAppRole[];

/**
 * 🔴 INCR-44 — VLC SCHOOL DASHBOARD audience — who may see the school-wide METADATA rollup (counts /
 * aggregates only, NEVER confidential content). READ = DEAN_OF_STUDENTS + HEADMASTER + ADMIN (owner OC1 —
 * ADMIN admitted for proprietor-level programme-health oversight of the AGGREGATE numbers).
 *
 *   • FORM_MASTER is DELIBERATELY ABSENT — an FM's oversight is their own class (the register + the
 *     own-class journal drill-in); a school-wide rollup is a leadership view. An FM in VLC_CONFIG_READ_ROLES
 *     reaches the layout but is redirected off the dashboard page by this gate.
 *   • This gate governs WHO SEES THE PAGE, not a content path (the dashboard has NO confidential content).
 *     ADMIN sees the metadata TIERS ONLY: the confidential per-student drill-in links stay gated to the
 *     tighter VLC_PASTORAL_READ_ROLES (journal/case — Dean) and VLC_PARAGRAPH_READ_ROLES (reference roster
 *     — FM/Dean/HM) and DO NOT render for ADMIN, so an ADMIN reaches NO names, NO roster, NO content.
 *
 * STUDENT / PARENT / PEER-GUIDE never reach it.
 */
export const VLC_DASHBOARD_READ_ROLES = [
  "DEAN_OF_STUDENTS",
  "HEADMASTER",
  "ADMIN",
] as const satisfies readonly KnownAppRole[];

/**
 * 🔴 PLC — Professional Learning Communities / staff CPD (SHS module 4.6 / INCR-47) — the config
 * spine's WRITE gate. Mirrors the VLC "config owner + management" shape, but the owner is the new
 * PD_COORDINATOR (not the Dean of Students). Gates EVERY config write (cadence, the 4 CPD scalars,
 * PLC create/rename/archive, facilitator assignment, membership, term focus).
 *
 *   • VICE_HEADMASTER_ACADEMIC is DELIBERATELY NOT in the write set (R367): an academic leader who
 *     configures PLC wears the PD_COORDINATOR hat (it is additive/double-hattable), rather than the
 *     gate widening to their base role.
 *   • Config READ is the shared `isStaff` (R368 — a bare TEACHER who facilitates must read
 *     cadence/focus/contract for INCR-48); there is deliberately NO PLC_CONFIG_READ_ROLES array.
 *
 * PD_COORDINATOR is rank-1 (rankOf default) and appears in NO other group → it can never mint an
 * ADMIN/HEADMASTER/PROPRIETOR (`canGrantRole`), and ADMIN/HEADMASTER grant IT via /staff.
 */
export const PLC_CONFIG_WRITE_ROLES = [
  "PD_COORDINATOR",
  "ADMIN",
  "HEADMASTER",
] as const satisfies readonly KnownAppRole[];

/**
 * 🔴 PLC session break-glass (INCR-47 · R377) — DEFINED NOW, INERT in 47. No live write path in this
 * increment references it; it is the target for INCR-48's session write-gate + Sarah's mutation test.
 *
 * VHA & ADMIN are DELIBERATELY EXCLUDED (unlike the config write set): a facilitator is an IDENTITY,
 * not a role — the ONLY roles that may author a PLC session WITHOUT being the assigned facilitator are
 * the PD_COORDINATOR (the programme owner) and the HEADMASTER (school head). ADMIN self-grant would be
 * audit-visible; VHA wears the coordinator hat. This is the module's one IDOR fence.
 */
export const PLC_SESSION_BREAKGLASS_ROLES = [
  "PD_COORDINATOR",
  "HEADMASTER",
] as const satisfies readonly KnownAppRole[];

/**
 * 🔴 PLC CPD school dashboard READ set (SHS module 4.6 / INCR-49 · R405) — the module's SECOND app-gate,
 * and a READ-gate (not the INCR-48 IDOR write-fence). Gates WHO SEES the school-wide CPD rollup (per-staff
 * X/8 + status bands + at-risk callout). Gated `hasAnyRole` server-side on BOTH the route and the reader —
 * RLS alone would let any same-school staff SELECT the SHOWN `plc_cpd_ledger`, so the management scope is
 * an APP-LAYER gate.
 *
 *   • This is the config-WRITE set (PD_COORDINATOR / ADMIN / HEADMASTER) + VICE_HEADMASTER_ACADEMIC — the
 *     deliberate READ ⊋ WRITE asymmetry: the VHA MONITORS CPD (oversight) but does NOT configure it, so it
 *     is admitted here yet stays OUT of PLC_CONFIG_WRITE_ROLES and PLC_SESSION_BREAKGLASS_ROLES (an academic
 *     leader who configures PLC wears the PD_COORDINATOR hat — R367).
 *   • HoD department-scoping is DEFERRED (R405): the dashboard is school-wide to these 4 management roles
 *     only; a bare TEACHER / FORM_MASTER / HoD-alone / STUDENT / PARENT sees 0 (the route redirects them,
 *     the reader is never reached). The teacher's OWN X/8 lives on the always-on My-CPD statement instead.
 */
export const PLC_DASHBOARD_READ_ROLES = [
  "PD_COORDINATOR",
  "HEADMASTER",
  "VICE_HEADMASTER_ACADEMIC",
  "ADMIN",
] as const satisfies readonly KnownAppRole[];

/**
 * 🔴 PLC session facilitation gate (INCR-47 · R377) — DEFINED + EXPORTED NOW, WIRED INTO NO LIVE PATH
 * in 47 (INCR-48's session-write flow consumes it). May the caller author/close a PLC session?
 *
 * TRUE iff they ARE the PLC's assigned facilitator (an IDENTITY match on a SERVER-LOADED
 * `plc.facilitator_user_id` — NEVER a facilitator id taken from the request) OR they hold a
 * break-glass role. A bare role alone (TEACHER / FORM_MASTER / VICE_HEADMASTER_ACADEMIC / ADMIN,
 * without the identity match) does NOT satisfy the facilitator arm — that bare-role IDOR is exactly
 * what R377 exists to prevent (see [[builds-widen-ratified-authz-and-self-bless]]).
 */
export function canFacilitatePlcSession(
  roles: readonly string[],
  userId: string | null | undefined,
  plcFacilitatorUserId: string | null | undefined,
): boolean {
  if (!!userId && !!plcFacilitatorUserId && userId === plcFacilitatorUserId) return true;
  return hasAnyRole(roles, PLC_SESSION_BREAKGLASS_ROLES);
}

/**
 * 🔴 PTA — Parent-Teacher Association structure setup (SHS module 4.7 / INCR-50 · R415) — the config
 * spine's WRITE gate, AND (unusually) its READ gate: the whole surface is admin-only, so read == write
 * (the page redirects anyone who fails it; a plain TEACHER/PARENT sees neither the nav link nor the
 * page). Gates EVERY config write (tier config, the forward-only dues change, and Generate).
 *
 *   • ADMIN + HEADMASTER only. PROPRIETOR is DELIBERATELY ABSENT (flagged rec-no at PR — its power is
 *     appointing/governance, not operating the PTA config surface; widen later if a school asks).
 *   • NO new KnownAppRole (OC3 — a PTA officer is a DATA position, not a role; officers land at INCR-51).
 *
 * STUDENT / PARENT / TEACHER never reach it. `as const satisfies` makes a typo'd code a compile error.
 */
export const PTA_CONFIG_WRITE_ROLES = [
  "ADMIN",
  "HEADMASTER",
] as const satisfies readonly KnownAppRole[];

/**
 * 🔴 PTA officer identity-gate (SHS module 4.7 / INCR-51 · R426) — DEFINED + EXPORTED NOW, WIRED INTO
 * NO LIVE PATH in 51 (matrix MANAGEMENT is gated by PTA_CONFIG_WRITE_ROLES, R427 — read == manage,
 * admin-only). It is the target for INCR-52 (meeting register) + INCR-53 (minutes): may the caller
 * ACT as a PTA officer of a given PTA?
 *
 * An officer is a DATA position, NOT a KnownAppRole (OC3): authority derives from HOLDING an office
 * BY IDENTITY, never from a widened app-role. This function TAKES NO `roles` ARGUMENT AT ALL — so no
 * bare KnownAppRole can ever satisfy it (the [[builds-widen-ratified-authz-and-self-bless]] fence,
 * structural rather than a runtime check, mirroring canFacilitatePlcSession's identity arm).
 *
 * TRUE iff the user holds ANY office (when `office` is omitted) or the SPECIFIC `office`, by:
 *   • STORED identity — `heldOffices` = the SERVER-LOADED active `pta_officer` offices for this
 *     (school, pta, user); NEVER a request-supplied list; ∥
 *   • EX-OFFICIO derivation — `exOfficioOffices` = the DERIVED offices this user occupies by staff
 *     role (General→Headmaster, Form→class teacher, House→housemaster), also server-loaded.
 * A user with no held and no ex-officio office is NOT an officer, whatever roles they hold.
 */
export function canActAsPtaOfficer(args: {
  userId: string | null | undefined;
  heldOffices: readonly string[];
  exOfficioOffices: readonly string[];
  office?: string;
}): boolean {
  if (!args.userId) return false;
  const offices = [...args.heldOffices, ...args.exOfficioOffices];
  if (offices.length === 0) return false;
  // office omitted ⇒ "holds ANY office"; office given ⇒ "holds THAT office".
  return args.office == null ? true : offices.includes(args.office);
}

/**
 * 🔴 PTA meeting-register break-glass (SHS module 4.7 / INCR-52 · R433/R439) — the roles that may write a
 * PTA meeting register WITHOUT holding (or ex-officio-occupying) the PTA's Secretary office. ADMIN +
 * HEADMASTER only. DISTINCT from the officer arm: `authorizePtaMeetingWrite` allows a write iff
 * `canActAsPtaOfficer({ office: secretaryOffice })` (a SERVER-loaded identity match, no bare role) ∥
 * `hasAnyRole(roles, PTA_MEETING_BREAKGLASS_ROLES)`. A bare TEACHER / FORM_MASTER never satisfies the
 * officer arm — it is an IDENTITY (the class-teacher-Secretary of THIS PTA), not a role. Chair / any-officer
 * write is DEFERRED (R433, rec-no); the Secretary is the register writer.
 */
export const PTA_MEETING_BREAKGLASS_ROLES = [
  "ADMIN",
  "HEADMASTER",
] as const satisfies readonly KnownAppRole[];

/**
 * 🔴 GOV-6 — who may CAPTURE terminal-exam results (BECE / WASSCE). These are OFFICIAL school outcomes,
 * so the write gate is CROSS-TIER management: ADMIN + HEADMASTER + VICE_HEADMASTER_ACADEMIC (the head of
 * academics, the natural owner of exam outcomes). Cross-tier by design — a BASIC school captures BECE, a
 * SENIOR school WASSCE, a COMBINED school both; a basic school simply has no one holding
 * VICE_HEADMASTER_ACADEMIC, so its inclusion never widens basic-tier reach. Gated on BOTH the capture
 * route (`requireSchoolRole`) AND every capture action (`assertAnyRole`) — a hand-crafted POST that never
 * touched the UI is still refused. `as const satisfies` makes a typo'd code a compile error.
 *
 * NOT the same as STAFF_ADMIN_ROLES (role-granting root, includes PROPRIETOR) — a separate, purpose-named
 * group: this gates data capture, not the authorization root.
 */
export const TERMINAL_RESULTS_WRITE_ROLES = [
  "ADMIN",
  "HEADMASTER",
  "VICE_HEADMASTER_ACADEMIC",
] as const satisfies readonly KnownAppRole[];

/**
 * 🔴 GOV-7 — who may CAPTURE the termly facilities snapshot (classrooms / WASH / ICT / feeding). Facilities
 * are ESTATES, not academics, so the write gate is management-only — ADMIN + HEADMASTER — and DELIBERATELY
 * NOT the terminal-results set: no VICE_HEADMASTER_ACADEMIC (the head of academics has no estates remit).
 * Gated on BOTH the capture route (`requireSchoolRole`) AND the capture action (`assertAnyRole`) — a
 * hand-crafted POST that never touched the UI is still refused. `as const satisfies` makes a typo'd code a
 * compile error.
 */
export const FACILITIES_WRITE_ROLES = [
  "ADMIN",
  "HEADMASTER",
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

/**
 * 🔴 INCR-35 (L2b) — the user-management rank ladder (Kofi R265). A user's rank at a school is the MAX
 * over their roles held there. Higher outranks lower:
 *   3  PROPRIETOR (top; owner ruling)
 *   2  ADMIN, HEADMASTER (peers)
 *   1  every other staff role (Vice Head, Teacher, Matron, Bursar, …)
 *   0  PARENT, STUDENT (non-staff)
 *  -1  no roles at this school (never a valid target)
 */
export function rankOf(roles: readonly string[]): number {
  let rank = -1;
  for (const r of roles) {
    const n =
      r === "PROPRIETOR"
        ? 3
        : r === "ADMIN" || r === "HEADMASTER"
          ? 2
          : r === "PARENT" || r === "STUDENT" || r === "BOARD_MEMBER"
            ? 0 // non-staff (BOARD_MEMBER is read-only, outranks nobody — R337)
            : 1; // any other (staff) role
    if (n > rank) rank = n;
  }
  return rank;
}

/**
 * 🔴 INCR-35 (L2b) — the privilege-inversion guard (Kofi R265), the SINGLE source of truth for both the
 * server action and the UI (the UI disables a control it fails; the server refusal is the real boundary).
 * An actor may block / reset a target IFF they are a DIFFERENT user AND STRICTLY outrank them.
 * Strictly-greater ⇒ no self-action AND no peer action: an ADMIN(2) can never act on another ADMIN(2), a
 * HEADMASTER(2), or a PROPRIETOR(3); a PROPRIETOR(3) cannot act on a co-PROPRIETOR(3). Structural lockout
 * safety: the top rank present in a school can never be blocked by anyone there, so a school always keeps
 * ≥1 active manager — no separate last-manager guard needed.
 */
export function canManageTarget(
  actorRoles: readonly string[],
  targetRoles: readonly string[],
  actorId: string,
  targetId: string,
): boolean {
  return actorId !== targetId && rankOf(actorRoles) > rankOf(targetRoles);
}

/**
 * 🔴 INCR-37 (R280) — the role-GRANT escalation guard, and the fix for a LIVE privilege escalation.
 * An actor may grant a role IFF that role does NOT outrank them: `rank(code) <= rank(actor)`.
 *   ADMIN(2)  granting PROPRIETOR(3) → 3<=2 false → REFUSED (the leak: `resolveRole` turns a typed
 *             "PROPRIETOR" into a real ref_role, so an admin could self-mint the top rank).
 *   ADMIN(2)  granting ADMIN(2)      → 2<=2 true  → allowed (peers may mint peers — preserved).
 *   PROPRIETOR(3) granting anything  → allowed.
 * DISTINCT from `canManageTarget` (block/reset) which needs STRICT outrank + non-self: granting a
 * same-rank role is legitimate, blocking a same-rank user is not. Because the role code is free-text
 * through `resolveRole`, this MUST run server-side at every grant WRITE (addStaff / assignStaffRole /
 * importStaff / createInvite / acceptInvite), never as a UI filter.
 */
export function canGrantRole(actorRoles: readonly string[], code: string): boolean {
  return rankOf([code]) <= rankOf(actorRoles);
}

/**
 * Roles that are NOT staff — a session holding only these never manages the school (mirrors staff-roles).
 * BOARD_MEMBER (GOV-2 / R333) joins STUDENT/PARENT here: the board is a read-only, non-staff persona, so
 * `isStaff(["BOARD_MEMBER"]) === false` — it never enters the staff `(app)` shell (its own `(board)`
 * group + `requireBoard()` gate it instead). A user who is ALSO staff (BOARD_MEMBER + TEACHER) still
 * passes `isStaff`, exactly like a staffer who is also a parent.
 */
const NON_STAFF_ROLES = ["STUDENT", "PARENT", "BOARD_MEMBER"];

/**
 * True when the user holds at least one staff (non-STUDENT/PARENT) role. The invite/manage gate: a
 * PARENT- or STUDENT-only session — even one hand-crafting the request — cannot create invites (AC A1).
 * A staffer who is ALSO a parent still manages, so this is "holds any staff role", not "holds no
 * non-staff role".
 */
export function isStaff(roles: readonly string[]): boolean {
  return roles.some((r) => r != null && r !== "" && !NON_STAFF_ROLES.includes(r));
}

/** Section prefixes a finance-only user may reach. Order-independent. */
export const FINANCE_SECTIONS = [
  "/billing",
  "/fees",
  "/reports",
  "/books",
  "/students",
  "/classes",
  // INCR-27 — the NHIS reconciliation is a Bursar-owned finance surface that lives under the sickbay
  // route tree. This ONE clinical-free page (getNhisReconciliation reads only diagnosis-free cost
  // lines) is reachable by a finance-only Bursar; the rest of /senior/sickbay stays out of reach.
  "/senior/sickbay/referrals/reconciliation",
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

/**
 * GOV-2 (governance track / R333) — the read-only BOARD_MEMBER confinement. Mirrors the finance-only
 * symbols but STRICTER: the board is a NON-STAFF persona (isStaff false), so it never enters the staff
 * `(app)` shell at all — it lives entirely behind `requireBoard()` over the `(board)` route group. There
 * is no write/read section split: EVERY `/board` section is read-only (assertWriteAccess throws for it).
 */
export const BOARD_ROLES = ["BOARD_MEMBER"];

/**
 * Section prefixes a board-only user may reach — ONE read-only prefix. The board account page lives at
 * `/board/account` (covered by `/board`), deliberately NOT `/account` (that is the parent portal's).
 */
export const BOARD_SECTIONS = ["/board"];

/** Where a board-only user lands — their read-only overview. */
export const BOARD_HOME = "/board";

/**
 * True when every role the user holds is a board role (and they hold at least one). A user who is also
 * ADMIN / TEACHER / etc. is NOT board-only and keeps full staff access (mirrors `isFinanceOnly`).
 */
export function isBoardOnly(roles: readonly string[]): boolean {
  const r = roles.filter(Boolean);
  return r.length > 0 && r.every((role) => BOARD_ROLES.includes(role));
}

/** True when a board-only user is allowed to load this path. */
export function pathAllowedForBoard(pathname: string): boolean {
  return BOARD_SECTIONS.some((p) => matches(pathname, p));
}
