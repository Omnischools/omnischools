/**
 * SERVER-ONLY boarding visiting-day read (SHS module 4.2 / INCR-12) — surface 06, the digital Visitor's
 * Book. Imports the DB driver via withSchool; NEVER import from a client component (the page passes
 * plain, PRE-MASKED serializable props). Every query is tenant-scoped through withSchool (RLS boundary)
 * and house-scoped for a plain HOUSEMASTER (canAccessHouse — Dean/HM/Admin school-wide).
 *
 * READS + DERIVES only (NO storage — AC K): the 5 summary cards, RSVP-by-House, zone occupancy, the
 * arrival counter and overstay are pure derivations (./visiting) fed by the boarding_visit +
 * boarding_approved_visitor rows + the frozen config contract (getVisitingPolicy / getBoardingCalendar —
 * READ-ONLY, never re-modelled). NOT fee/discipline-gated (OQ-F) — no feeOwingForStudent call.
 *
 * PII discipline (AC J4): visitor phones are MASKED here (maskPhone) before they reach the client; the
 * ID is a hint; no photo/QR. Full names render in the authed surface but never in a URL/SMS-log.
 */
import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import {
  boardingVisit,
  boardingApprovedVisitor,
  students,
  houses,
  classes,
  users,
  schools,
} from "@/db/schema";
import { canAccessHouse, hasAnyRole, BOARDING_SCHOOL_SCOPED_ROLES } from "@/lib/access";
import { getVisitingPolicy, getBoardingCalendar, type VisitingPolicy } from "./config";
import { getCurrentPeriod } from "./period";
import { isLightColour } from "./roster";
import { isPastorallyFlagged } from "./pastoral-stub";
import {
  deriveRsvpByHouse,
  deriveVisitStats,
  deriveZoneOccupancy,
  getVisitorZones,
  listMatchOf,
  maskPhone,
  overstayState,
  formInScope,
  formScopeLabel,
  ZONE_CAP_TOTAL,
  type ApprovalStatus,
  type ListMatch,
  type OverstayState,
  type VisitStatus,
  type VisitVerification,
  type VisitorZone,
} from "./visiting";

const PROGRAMME_ABBR: Record<string, string> = {
  GENERAL_ARTS: "GA",
  GENERAL_SCIENCE: "GS",
  BUSINESS: "BUS",
  AGRICULTURE: "AGRIC",
  VISUAL_ARTS: "VA",
  HOME_ECONOMICS: "HE",
  TECHNICAL: "TECH",
};

const shortName = (first: string, last: string) => `${first.charAt(0)}. ${last}`;
const initials = (first: string, last: string) =>
  `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();

const fmtTime = (d: Date): string =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(d);

function formNumberOf(level: string | null, name: string | null): number | null {
  const src = `${level ?? ""} ${name ?? ""}`;
  const m = src.match(/(?:Form|F)\s*([123])/i);
  return m ? Number(m[1]) : null;
}
function shortForm(form: number | null, programme: string | null, className: string | null): string {
  if (form && programme) return `F${form} ${PROGRAMME_ABBR[programme] ?? programme}`;
  if (form) return `F${form}`;
  return className ?? "—";
}

// ---------------------------------------------------------------------------
// Client-facing view types — every string PRE-FORMATTED / PRE-MASKED (client never imports this module).
// ---------------------------------------------------------------------------

export interface HouseRsvpCard {
  id: string;
  name: string;
  colour: string | null;
  isLight: boolean;
  gender: "BOYS" | "GIRLS" | "COED" | null;
  hmName: string | null;
  expected: number;
  rsvpd: number;
  arrived: number;
  pct: number;
  byForm: { form: number; expected: number; rsvpd: number }[];
}
export interface IndicatedArrival {
  visitId: string;
  studentId: string;
  studentName: string;
  studentInitials: string;
  studentSub: string;
  pastoral: boolean;
  visitorName: string;
  visitorPhoneMasked: string | null;
  idHint: string | null;
  relationship: string | null;
  listMatch: ListMatch;
  status: VisitStatus;
  verification: VisitVerification;
  arrivedLabel: string | null;
  departedLabel: string | null;
  zoneKey: string | null;
  zoneLabel: string | null;
  overstay: OverstayState;
}
export interface ApprovedSlot {
  id: string | null;
  name: string;
  relationship: string;
  phoneMasked: string | null;
  idHint: string | null;
  status: ApprovalStatus | null;
  pastoralReview: boolean;
  note: string | null;
}
export interface ApprovedListCard {
  studentId: string;
  studentName: string;
  studentSub: string;
  pastoral: boolean;
  approvedCount: number;
  pendingCount: number;
  slots: ApprovedSlot[];
}
export interface ZoneCard extends VisitorZone {
  occupancy: number;
  pct: number;
}
export interface OverstayRow {
  visitId: string;
  studentName: string;
  visitorName: string;
  tier: Exclude<OverstayState, "none">;
  arrivedLabel: string | null;
  zoneLabel: string | null;
}
export interface BoarderOption {
  id: string;
  name: string;
  formLabel: string;
  houseName: string;
  rsvpd: boolean;
}
export interface ApprovedVisitorOption {
  id: string;
  name: string;
  relationship: string;
  status: ApprovalStatus;
}
export interface VisitingBoard {
  hasEvent: boolean;
  eventId: string | null;
  dateIso: string | null;
  cal: { day: string; num: string; mon: string };
  dayLabel: string;
  daysAway: number | null;
  live: boolean;
  past: boolean;
  formScope: string | null;
  formScopeLabel: string | null;
  policy: VisitingPolicy;
  schoolName: string;
  clockLabel: string;
  windowLabel: string;
  hasBoarders: boolean;
  countdown: { rsvpd: number; expected: number; pctFamilies: number };
  summary: {
    rsvpd: number;
    expectedBoarders: number;
    notRsvpd: number;
    approvedNames: number;
    avgPerBoarder: string;
    pendingApprovals: number;
    zoneCount: number;
    zoneCapTotal: number;
    onCampus: number;
    arrivedTotal: number;
    departed: number;
    overstaying: number;
  };
  houses: HouseRsvpCard[];
  arrivals: IndicatedArrival[];
  focus: ApprovedListCard | null;
  focusOptions: { id: string; label: string }[];
  zones: ZoneCard[];
  overstays: OverstayRow[];
  boarderOptions: BoarderOption[];
  approvedByStudent: Record<string, ApprovedVisitorOption[]>;
  canManagePastoral: boolean;
}

interface Opts {
  dateIso?: string;
  eventId?: string;
  studentId?: string;
}

/**
 * The full visiting-day board for the accessible Houses (AC A–K). School-scoped roles (Admin/
 * Headmaster/Dean) see every House; a plain HOUSEMASTER only the House they master (canAccessHouse).
 * Returns a coherent (possibly empty) board on every edge — no event, no boarders, no visits render a
 * calm shell, never a throw. `now` is injected for tests; defaults to Date.now.
 */
export async function getVisitingBoard(
  schoolId: string,
  roles: readonly string[],
  userId: string | null,
  opts: Opts = {},
  now: Date = new Date(),
): Promise<VisitingBoard> {
  const canManagePastoral = hasAnyRole(roles, BOARDING_SCHOOL_SCOPED_ROLES);
  const policy = await getVisitingPolicy(schoolId);
  const period = await withSchool(schoolId, (tx) => getCurrentPeriod(tx, schoolId));
  const calendar = period ? await getBoardingCalendar(schoolId, period.academicYear) : null;

  // Resolve the target VISITING event: ?eventId → ?date → nextVisiting → latest visiting.
  const visitingEvents = (calendar?.events ?? []).filter((e) => e.eventType === "VISITING");
  const event =
    (opts.eventId && visitingEvents.find((e) => e.id === opts.eventId)) ||
    (opts.dateIso && visitingEvents.find((e) => e.date === opts.dateIso)) ||
    calendar?.nextVisiting ||
    visitingEvents[visitingEvents.length - 1] ||
    null;

  const zonesConst = getVisitorZones(schoolId);
  const windowLabel = `${policy.hoursStart} — ${policy.hoursEnd}`;
  const nowIso = now.toISOString().slice(0, 10);

  return withSchool(schoolId, async (tx): Promise<VisitingBoard> => {
    const [school] = await tx.select({ name: schools.name }).from(schools).where(eq(schools.id, schoolId)).limit(1);
    const schoolName = school?.name ?? "School";

    // Accessible Houses (house-scope for a plain HM).
    const houseRows = await tx
      .select({
        id: houses.id,
        name: houses.name,
        colour: houses.colour,
        gender: houses.gender,
        hmUserId: houses.hmUserId,
        hmName: users.fullName,
      })
      .from(houses)
      .leftJoin(users, eq(houses.hmUserId, users.id))
      .where(eq(houses.schoolId, schoolId));
    const accessibleHouses = houseRows.filter((h) => canAccessHouse(roles, userId, h.hmUserId));
    const houseIds = accessibleHouses.map((h) => h.id);
    const houseById = new Map(accessibleHouses.map((h) => [h.id, h]));

    const cal = calBox(event?.date ?? null);
    const dayLabel = event ? dayLabelOf(event.date) : "No visiting Sunday scheduled";
    const daysAway = event ? daysBetween(nowIso, event.date) : null;
    const base = {
      hasEvent: !!event,
      eventId: event?.id ?? null,
      dateIso: event?.date ?? null,
      cal,
      dayLabel,
      daysAway,
      live: !!event && event.date === nowIso,
      past: !!event && event.date < nowIso,
      formScope: event?.formScope ?? null,
      formScopeLabel: formScopeLabel(event?.formScope ?? null),
      policy,
      schoolName,
      clockLabel: fmtTime(now),
      windowLabel,
      zones: deriveZoneOccupancy(zonesConst, []) as ZoneCard[],
      zoneCapTotal: ZONE_CAP_TOTAL,
    };

    const emptyBoard = (): VisitingBoard => ({
      ...base,
      hasBoarders: false,
      countdown: { rsvpd: 0, expected: 0, pctFamilies: 0 },
      summary: {
        rsvpd: 0,
        expectedBoarders: 0,
        notRsvpd: 0,
        approvedNames: 0,
        avgPerBoarder: "0",
        pendingApprovals: 0,
        zoneCount: zonesConst.length,
        zoneCapTotal: ZONE_CAP_TOTAL,
        onCampus: 0,
        arrivedTotal: 0,
        departed: 0,
        overstaying: 0,
      },
      houses: [],
      arrivals: [],
      focus: null,
      focusOptions: [],
      overstays: [],
      boarderOptions: [],
      approvedByStudent: {},
      canManagePastoral,
    });

    if (houseIds.length === 0) return emptyBoard();

    // Active boarders in the accessible Houses (cohort = ACTIVE ∧ BOARDER — AC E4).
    const boarderRaw = await tx
      .select({
        studentId: students.id,
        studentCode: students.studentCode,
        houseId: students.houseId,
        firstName: students.firstName,
        lastName: students.lastName,
        programme: students.programme,
        classLevel: classes.level,
        className: classes.name,
      })
      .from(students)
      .leftJoin(classes, and(eq(classes.schoolId, students.schoolId), eq(classes.id, students.classId)))
      .where(
        and(
          eq(students.schoolId, schoolId),
          inArray(students.houseId, houseIds),
          eq(students.residency, "BOARDER"),
          eq(students.status, "ACTIVE"),
        ),
      )
      .orderBy(students.lastName);

    const boarders = boarderRaw.map((b) => {
      const form = formNumberOf(b.classLevel, b.className);
      return {
        studentId: b.studentId,
        studentCode: b.studentCode,
        houseId: b.houseId!,
        firstName: b.firstName,
        lastName: b.lastName,
        form,
        shortFormLabel: shortForm(form, b.programme, b.className),
        houseName: houseById.get(b.houseId!)?.name ?? "—",
      };
    });
    const boarderById = new Map(boarders.map((b) => [b.studentId, b]));
    const studentIds = boarders.map((b) => b.studentId);

    if (studentIds.length === 0) return emptyBoard();

    // Approved-visitor lists for the cohort (per-student list read, the gate's match lookup source).
    const approvedRaw = await tx
      .select({
        id: boardingApprovedVisitor.id,
        studentId: boardingApprovedVisitor.studentId,
        name: boardingApprovedVisitor.name,
        relationship: boardingApprovedVisitor.relationship,
        phone: boardingApprovedVisitor.phone,
        idHint: boardingApprovedVisitor.idHint,
        status: boardingApprovedVisitor.status,
        pastoralReview: boardingApprovedVisitor.pastoralReview,
        note: boardingApprovedVisitor.note,
        createdAt: boardingApprovedVisitor.createdAt,
      })
      .from(boardingApprovedVisitor)
      .where(
        and(
          eq(boardingApprovedVisitor.schoolId, schoolId),
          inArray(boardingApprovedVisitor.studentId, studentIds),
        ),
      )
      .orderBy(asc(boardingApprovedVisitor.createdAt));

    const approvedByStudentId = new Map<string, typeof approvedRaw>();
    for (const a of approvedRaw) {
      const list = approvedByStudentId.get(a.studentId) ?? [];
      list.push(a);
      approvedByStudentId.set(a.studentId, list);
    }
    const pendingCountOf = (sid: string) =>
      (approvedByStudentId.get(sid) ?? []).filter((a) => a.status === "PENDING_REVIEW").length;

    // Visits for the resolved event (indicated arrivals + the live gate log).
    const visitRaw = event
      ? await tx
          .select({
            id: boardingVisit.id,
            studentId: boardingVisit.studentId,
            houseId: boardingVisit.houseId,
            visitorName: boardingVisit.visitorName,
            visitorPhone: boardingVisit.visitorPhone,
            relationship: boardingVisit.relationship,
            status: boardingVisit.status,
            verification: boardingVisit.verification,
            zoneKey: boardingVisit.zoneKey,
            arrivedAt: boardingVisit.arrivedAt,
            departedAt: boardingVisit.departedAt,
            createdAt: boardingVisit.createdAt,
          })
          .from(boardingVisit)
          .where(
            and(
              eq(boardingVisit.schoolId, schoolId),
              eq(boardingVisit.calendarEventId, event.id),
              inArray(boardingVisit.houseId, houseIds),
            ),
          )
          .orderBy(desc(boardingVisit.createdAt))
      : [];

    const zoneLabelOf = (key: string | null) => zonesConst.find((z) => z.key === key)?.label ?? null;
    const dateIso = event?.date ?? nowIso;

    // --- Summary + counters (DERIVED) ---
    const stats = deriveVisitStats(
      visitRaw.map((v) => ({ studentId: v.studentId, arrivedAt: v.arrivedAt, departedAt: v.departedAt })),
    );
    const inScopeBoarders = boarders.filter((b) => formInScope(b.form, event?.formScope ?? null));
    const expectedBoarders = inScopeBoarders.length;
    const approvedNames = approvedRaw.filter((a) => a.status === "APPROVED").length;
    const pendingApprovals = approvedRaw.filter((a) => a.status === "PENDING_REVIEW").length;
    const overstaying = event
      ? visitRaw.filter(
          (v) => overstayState({ status: v.status, departedAt: v.departedAt }, dateIso, policy.hoursEnd, now) !== "none",
        ).length
      : 0;

    // --- RSVP-by-House (DERIVED, formScope-aware) ---
    const rsvpMap = deriveRsvpByHouse(
      boarders.map((b) => ({ studentId: b.studentId, houseId: b.houseId, form: b.form })),
      visitRaw.map((v) => ({ studentId: v.studentId, arrived: v.arrivedAt != null })),
      event?.formScope ?? null,
    );
    const houseCards: HouseRsvpCard[] = accessibleHouses
      .map((h) => {
        const r = rsvpMap.get(h.id) ?? { expected: 0, rsvpd: 0, arrived: 0, pct: 0, byForm: [] };
        return {
          id: h.id,
          name: h.name,
          colour: h.colour,
          isLight: isLightColour(h.colour),
          gender: (h.gender ?? null) as "BOYS" | "GIRLS" | "COED" | null,
          hmName: h.hmName ?? null,
          expected: r.expected,
          rsvpd: r.rsvpd,
          arrived: r.arrived,
          pct: r.pct,
          byForm: r.byForm,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    // --- Indicated arrivals (MASKED PII) ---
    const arrivals: IndicatedArrival[] = visitRaw.map((v) => {
      const b = boarderById.get(v.studentId);
      return {
        visitId: v.id,
        studentId: v.studentId,
        studentName: b ? shortName(b.firstName, b.lastName) : "—",
        studentInitials: b ? initials(b.firstName, b.lastName) : "—",
        studentSub: `${b?.shortFormLabel ?? "—"} · ${b?.houseName ?? "—"}`,
        pastoral: isPastorallyFlagged(b?.studentCode),
        visitorName: v.visitorName,
        visitorPhoneMasked: maskPhone(v.visitorPhone),
        idHint: null, // ID is a hint, not surfaced in the list row (§2 — the check is out of parent sight)
        relationship: v.relationship,
        listMatch: listMatchOf(v.verification, v.status, pendingCountOf(v.studentId)),
        status: v.status,
        verification: v.verification,
        arrivedLabel: v.arrivedAt ? fmtTime(v.arrivedAt) : null,
        departedLabel: v.departedAt ? fmtTime(v.departedAt) : null,
        zoneKey: v.zoneKey,
        zoneLabel: zoneLabelOf(v.zoneKey),
        overstay: event
          ? overstayState({ status: v.status, departedAt: v.departedAt }, dateIso, policy.hoursEnd, now)
          : "none",
      };
    });

    // --- Zones + occupancy (DERIVED) ---
    const zones = deriveZoneOccupancy(
      zonesConst,
      visitRaw.map((v) => ({ zoneKey: v.zoneKey, onCampus: v.arrivedAt != null && v.departedAt == null })),
    ) as ZoneCard[];

    // --- Overstays (on-read) ---
    const overstays: OverstayRow[] = arrivals
      .filter((a) => a.overstay !== "none")
      .map((a) => ({
        visitId: a.visitId,
        studentName: a.studentName,
        visitorName: a.visitorName,
        tier: a.overstay as Exclude<OverstayState, "none">,
        arrivedLabel: a.arrivedLabel,
        zoneLabel: a.zoneLabel,
      }));

    // --- Focus approved-visitor detail card (default: a pastoral boarder with a list, else first list) ---
    const focusStudentId =
      (opts.studentId && boarderById.has(opts.studentId) && opts.studentId) ||
      boarders.find((b) => isPastorallyFlagged(b.studentCode) && (approvedByStudentId.get(b.studentId)?.length ?? 0) > 0)?.studentId ||
      boarders.find((b) => (approvedByStudentId.get(b.studentId)?.length ?? 0) > 0)?.studentId ||
      boarders[0]?.studentId ||
      null;
    const focus = focusStudentId ? buildFocusCard(focusStudentId, boarderById, approvedByStudentId) : null;

    const focusOptions = boarders
      .filter((b) => isPastorallyFlagged(b.studentCode) || (approvedByStudentId.get(b.studentId)?.length ?? 0) > 0)
      .map((b) => ({ id: b.studentId, label: `${shortName(b.firstName, b.lastName)} · ${b.houseName}` }))
      .slice(0, 60);
    // Ensure the focus student is always selectable even with an empty list.
    if (focus && !focusOptions.some((o) => o.id === focus.studentId)) {
      const b = boarderById.get(focus.studentId)!;
      focusOptions.unshift({ id: b.studentId, label: `${shortName(b.firstName, b.lastName)} · ${b.houseName}` });
    }

    // --- Gate-check modal data ---
    const rsvpStudents = new Set(visitRaw.map((v) => v.studentId));
    const boarderOptions: BoarderOption[] = boarders
      .map((b) => ({
        id: b.studentId,
        name: shortName(b.firstName, b.lastName),
        formLabel: b.shortFormLabel,
        houseName: b.houseName,
        rsvpd: rsvpStudents.has(b.studentId),
      }))
      .sort((a, b) => a.houseName.localeCompare(b.houseName) || a.name.localeCompare(b.name));
    const approvedByStudent: Record<string, ApprovedVisitorOption[]> = {};
    for (const [sid, list] of approvedByStudentId) {
      approvedByStudent[sid] = list.map((a) => ({
        id: a.id,
        name: a.name,
        relationship: a.relationship,
        status: a.status as ApprovalStatus,
      }));
    }

    const rsvpd = stats.expectingStudents;
    return {
      ...base,
      zones,
      hasBoarders: boarders.length > 0,
      countdown: {
        rsvpd,
        expected: expectedBoarders,
        pctFamilies: expectedBoarders > 0 ? Math.round((rsvpd / expectedBoarders) * 100) : 0,
      },
      summary: {
        rsvpd,
        expectedBoarders,
        notRsvpd: Math.max(0, expectedBoarders - rsvpd),
        approvedNames,
        avgPerBoarder: expectedBoarders > 0 ? (approvedNames / expectedBoarders).toFixed(1) : "0",
        pendingApprovals,
        zoneCount: zonesConst.length,
        zoneCapTotal: ZONE_CAP_TOTAL,
        onCampus: stats.onCampus,
        arrivedTotal: stats.arrivedVisits,
        departed: stats.departed,
        overstaying,
      },
      houses: houseCards,
      arrivals,
      focus,
      focusOptions,
      overstays,
      boarderOptions,
      approvedByStudent,
      canManagePastoral,
    };
  });
}

type BoarderLite = {
  studentId: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  shortFormLabel: string;
  houseName: string;
};
type ApprovedRow = {
  id: string;
  name: string;
  relationship: string;
  phone: string | null;
  idHint: string | null;
  status: string;
  pastoralReview: boolean;
  note: string | null;
};

function buildFocusCard(
  studentId: string,
  boarderById: Map<string, BoarderLite>,
  approvedByStudentId: Map<string, ApprovedRow[]>,
): ApprovedListCard {
  const b = boarderById.get(studentId)!;
  const list = approvedByStudentId.get(studentId) ?? [];
  const slots: ApprovedSlot[] = list.map((a) => ({
    id: a.id,
    name: a.name,
    relationship: a.relationship,
    phoneMasked: maskPhone(a.phone),
    idHint: a.idHint,
    status: a.status as ApprovalStatus,
    pastoralReview: a.pastoralReview,
    note: a.note,
  }));
  // Pad to 6 slots with the empty "Available to add" affordance (surface: slot 6 · empty).
  while (slots.length < 6) {
    slots.push({
      id: null,
      name: `Slot ${slots.length + 1} · empty`,
      relationship: "Available to add (max 6 per student)",
      phoneMasked: null,
      idHint: null,
      status: null,
      pastoralReview: false,
      note: null,
    });
  }
  return {
    studentId,
    studentName: shortName(b.firstName, b.lastName),
    studentSub: `${b.shortFormLabel} · ${b.houseName}`,
    pastoral: isPastorallyFlagged(b.studentCode),
    approvedCount: list.filter((a) => a.status === "APPROVED").length,
    pendingCount: list.filter((a) => a.status === "PENDING_REVIEW").length,
    slots: slots.slice(0, 6),
  };
}

// ---------------------------------------------------------------------------
// Small display helpers (UTC — Ghana is GMT+0).
// ---------------------------------------------------------------------------
function calBox(dateIso: string | null): { day: string; num: string; mon: string } {
  if (!dateIso) return { day: "—", num: "—", mon: "—" };
  const d = new Date(`${dateIso}T12:00:00Z`);
  const day = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getUTCDay()];
  const mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getUTCMonth()];
  return { day, num: String(d.getUTCDate()), mon };
}
function dayLabelOf(dateIso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateIso}T12:00:00Z`));
}
function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}
