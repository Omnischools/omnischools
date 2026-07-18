/**
 * SERVER-ONLY exeat reads (SHS module 4.2 / INCR-9). Imports the DB driver via withSchool — must
 * NEVER be imported by a client component; the page passes plain serializable props to the client
 * console. Every query is tenant-scoped through withSchool (RLS boundary) and house-scoped for a
 * plain HOUSEMASTER (canAccessHouse).
 *
 * Reads only. Config comes through the FROZEN getExeatPolicy / getBoardingCalendar contract
 * (READ-ONLY, never re-derived — a cross-increment break otherwise). Fee-owing is a live READ of
 * invoices.balance_amount (no billing write). Nothing derived is stored: quota_used is counted,
 * returned_late / overdue are computed here from timestamps.
 */
import "server-only";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { withSchool } from "@/lib/db/rls";
import {
  boardingExeat,
  exeatNotification,
  students,
  houses,
  classes,
  boardingBunk,
  boardingDormitory,
  invoices,
  academicPeriod,
  users,
  schools,
} from "@/db/schema";
import { canAccessHouse } from "@/lib/access";
import { getExeatPolicy, getBoardingCalendar, type ExeatPolicy } from "./config";
import { getCurrentPeriod } from "./period";
import {
  isOverdue,
  isReturnedLate,
  isQueuedRowClean,
  overdueStageLabels,
  dueOverdueStages,
  type ExeatType,
  type ExeatStatus,
  type NotificationKind,
} from "./exeat-decision";

/** Invoice statuses that count as owing (AC C1). DRAFT/PAID/EXEMPT/VOIDED never do. */
export const OWING_STATUSES = ["ISSUED", "PARTIAL", "OVERDUE"] as const;

const pad2 = (n: number) => String(n).padStart(2, "0");
const shortName = (first: string, last: string) => `${first.charAt(0)}. ${last}`;
const initials = (first: string, last: string) =>
  `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
const money = (n: number) =>
  `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDateTime = (d: Date | null): string | null =>
  d
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d)
    : null;
const fmtTime = (d: Date): string =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

/**
 * Live fee-owing balance for one student (AC C1) — SUM(invoices.balance_amount) over owing
 * statuses only, tenant-scoped, READ-only (never a billing write). Frozen into fee_owing_snapshot
 * at approval by the caller; not re-read per view (T5).
 */
export async function feeOwingForStudent(
  tx: Tx,
  schoolId: string,
  studentId: string,
): Promise<number> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${invoices.balanceAmount}), 0)` })
    .from(invoices)
    .where(
      and(
        eq(invoices.schoolId, schoolId),
        eq(invoices.studentId, studentId),
        inArray(invoices.status, [...OWING_STATUSES]),
      ),
    );
  return Number(row?.total ?? 0);
}

// The current SHS semester (quota scope) is resolved by the canonical resolver (INCR-11 tweak #2 —
// co-located beside config.ts). Re-exported here so INCR-9/10's `from "./exeat-data"` imports hold.
export { getCurrentPeriod };

/**
 * Quota used = count(SCHEDULED+FEE_COLLECTION, status≠DECLINED) for this student × semester
 * (Kofi OQ3 / AC B). Derived by counting rows — there is deliberately no counter column.
 */
export async function countQuotaUsed(
  tx: Tx,
  schoolId: string,
  studentId: string,
  periodId: string,
): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(boardingExeat)
    .where(
      and(
        eq(boardingExeat.schoolId, schoolId),
        eq(boardingExeat.studentId, studentId),
        eq(boardingExeat.academicPeriodId, periodId),
        inArray(boardingExeat.exeatType, ["SCHEDULED", "FEE_COLLECTION"]),
        ne(boardingExeat.status, "DECLINED"),
      ),
    );
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Serializable board shapes (the page passes these straight to the client console)
// ---------------------------------------------------------------------------

export interface FeeStatus {
  owed: boolean;
  label: string;
}
export interface ExeatRow {
  id: string;
  refCode: string;
  studentId: string;
  houseId: string;
  studentName: string;
  fullName: string;
  initials: string;
  addressLine: string; // "F2 GA · Aggrey · A-03"
  type: ExeatType;
  status: ExeatStatus;
  reason: string | null;
  outLabel: string | null;
  inLabel: string | null;
  fee: FeeStatus;
  approval: "approved" | "pending" | "needs";
  approvalLabel: string;
  clean: boolean; // passes every clean-check → included in "Approve all clean (N)"
}
export interface ExeatStage {
  label: string;
  done: boolean;
  active: boolean;
  timeLabel: string | null;
  actor: string | null;
}
export interface InFlightRow extends ExeatRow {
  elapsedLabel: string;
  stages: ExeatStage[];
}
export interface ReturnRow {
  id: string;
  initials: string;
  studentName: string;
  addressLine: string;
  timeLabel: string;
  late: boolean;
}
export interface LateRow {
  id: string;
  refCode: string;
  studentName: string;
  addressLine: string;
  returnByLabel: string | null;
  overdueLabel: string;
  dueStages: NotificationKind[];
  sentStages: NotificationKind[];
}
export interface LateStage {
  kind: NotificationKind;
  offsetMin: number;
  label: string;
}
export interface ExeatBoard {
  policy: ExeatPolicy;
  windowLabel: string | null;
  windowSequence: number | null;
  periodLabel: string | null;
  summary: {
    inFlight: number;
    inQueue: number;
    awaitingSrHm: number;
    returnsToday: number;
    lateReturns: number;
    queueBreakdown: string;
    inFlightSub: string;
  };
  inFlight: InFlightRow[];
  queue: ExeatRow[];
  cleanCount: number;
  returnsToday: ReturnRow[];
  late: LateRow[];
  lateStages: LateStage[];
  hasBoarders: boolean;
}

interface RawExeat extends RawActorIds {
  id: string;
  refCode: string;
  studentId: string;
  houseId: string;
  hmUserId: string | null;
  firstName: string;
  lastName: string;
  formLabel: string | null;
  houseName: string;
  dormName: string | null;
  bunkPos: number | null;
  type: ExeatType;
  status: ExeatStatus;
  reason: string | null;
  departAt: Date | null;
  returnBy: Date | null;
  feeSnapshot: number;
  requestedAt: Date | null;
  requestedBy: string | null;
  hmApprovedAt: Date | null;
  hmApprovedBy: string | null;
  srHmSignedAt: Date | null;
  srHmSignedBy: string | null;
  departedAt: Date | null;
  departedBy: string | null;
  returnedAt: Date | null;
  returnedBy: string | null;
  declineReason: string | null;
  declinedAt: Date | null;
}

interface RawActorIds {
  requestedByUserId: string | null;
  hmApprovedByUserId: string | null;
  srHmSignedByUserId: string | null;
  departedByUserId: string | null;
  returnedByUserId: string | null;
}

const CLEAN_APPROVAL = { approval: "approved" as const, label: "AUTO-APPROVED" };

/** Type pill label for the queue. */
function feeStatus(snapshot: number): FeeStatus {
  return snapshot > 0 ? { owed: true, label: money(snapshot) } : { owed: false, label: "CLEAR" };
}

/** Approval column state for a queued (not-yet-departed) exeat (surface qc-row.approval). */
function approvalState(r: RawExeat): { approval: "approved" | "pending" | "needs"; label: string } {
  if (r.status === "HM_APPROVED" && r.type === "SPECIAL")
    return { approval: "pending", label: "SR HM PENDING" };
  if (r.status === "HM_APPROVED") return CLEAN_APPROVAL;
  if (r.status === "SR_HM_SIGNED") return { approval: "approved", label: "SIGNED" };
  // REQUESTED — a special needs the HM→Sr-HM path; an owing/flagged sched needs review.
  if (r.type === "SPECIAL") return { approval: "needs", label: "HM REVIEW" };
  if (r.feeSnapshot > 0) return { approval: "needs", label: "HM REVIEW" };
  return { approval: "pending", label: "PENDING" };
}

function addressLine(r: RawExeat): string {
  const bunk = r.dormName && r.bunkPos != null ? ` · ${r.dormName}-${pad2(r.bunkPos)}` : "";
  const form = r.formLabel ? `${r.formLabel} · ` : "";
  return `${form}${r.houseName}${bunk}`;
}

function baseRow(r: RawExeat): ExeatRow {
  const ap = approvalState(r);
  const routed = r.type === "FEE_COLLECTION";
  return {
    id: r.id,
    refCode: r.refCode,
    studentId: r.studentId,
    houseId: r.houseId,
    studentName: shortName(r.firstName, r.lastName),
    fullName: `${r.firstName} ${r.lastName}`,
    initials: initials(r.firstName, r.lastName),
    addressLine: addressLine(r),
    type: r.type,
    status: r.status,
    reason: r.reason,
    outLabel: fmtDateTime(r.departAt),
    inLabel: fmtDateTime(r.returnBy),
    fee: feeStatus(r.feeSnapshot),
    approval: ap.approval,
    approvalLabel: ap.label,
    // Clean = would "Approve all clean (N)" include it: only a still-REQUESTED, non-special,
    // fees-clear-or-routed, standard-window row (disciplineFlag stubbed false — trap T3).
    clean:
      r.status === "REQUESTED" &&
      isQueuedRowClean({
        type: r.type,
        feesClearOrRouted: routed || r.feeSnapshot === 0,
        disciplineFlag: false,
        standardWindow: r.type !== "SPECIAL",
      }),
  };
}

const elapsed = (from: Date | null, to: Date): string => {
  if (!from) return "—";
  const ms = Math.max(0, to.getTime() - from.getTime());
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  return d > 0 ? `${d}D ${h % 24}H ELAPSED` : `${h}H ELAPSED`;
};

function inFlightStages(r: RawExeat): ExeatStage[] {
  const special = r.type === "SPECIAL";
  const stages: ExeatStage[] = [
    {
      label: "Requested",
      done: !!r.requestedAt,
      active: false,
      timeLabel: fmtDateTime(r.requestedAt),
      actor: r.requestedBy,
    },
    {
      label: "HM approved",
      done: !!r.hmApprovedAt,
      active: false,
      timeLabel: fmtDateTime(r.hmApprovedAt),
      actor: r.hmApprovedBy,
    },
  ];
  if (special) {
    stages.push({
      label: "Senior HM signed",
      done: !!r.srHmSignedAt,
      active: false,
      timeLabel: fmtDateTime(r.srHmSignedAt),
      actor: r.srHmSignedBy,
    });
  }
  stages.push(
    {
      label: "Departed",
      done: !!r.departedAt,
      active: false,
      timeLabel: fmtDateTime(r.departedAt),
      actor: r.departedBy,
    },
    {
      // In flight → the return stage is the current (active) one, shown as the deadline.
      label: r.returnedAt ? "Returned" : "Expected return",
      done: !!r.returnedAt,
      active: !r.returnedAt,
      timeLabel: fmtDateTime(r.returnedAt ?? r.returnBy),
      actor: r.returnedBy,
    },
  );
  return stages;
}

/**
 * The full exeat board for the accessible Houses (AC A–F). School-scoped roles see every House;
 * a plain HOUSEMASTER sees only the House they master (canAccessHouse). Returns coherent (possibly
 * empty) data on every edge, never throwing. `now` is injected only for tests; defaults to Date.now.
 */
export async function getExeatBoard(
  schoolId: string,
  roles: readonly string[],
  userId: string | null,
  now: Date = new Date(),
): Promise<ExeatBoard> {
  const policy = await getExeatPolicy(schoolId);

  return withSchool(schoolId, async (tx) => {
    const period = await getCurrentPeriod(tx, schoolId);
    const calendar = period ? await getBoardingCalendar(schoolId, period.academicYear) : null;
    const todayIso = now.toISOString().slice(0, 10);
    const nextWindow =
      calendar?.events.find((e) => e.eventType === "EXEAT_WINDOW" && e.date >= todayIso) ??
      calendar?.events.filter((e) => e.eventType === "EXEAT_WINDOW").slice(-1)[0] ??
      null;

    const anyBoarder = await tx
      .select({ id: students.id })
      .from(students)
      .where(
        and(
          eq(students.schoolId, schoolId),
          eq(students.residency, "BOARDER"),
          eq(students.status, "ACTIVE"),
        ),
      )
      .limit(1);

    const rows = await tx
      .select({
        id: boardingExeat.id,
        refCode: boardingExeat.refCode,
        studentId: boardingExeat.studentId,
        houseId: boardingExeat.houseId,
        hmUserId: houses.hmUserId,
        firstName: students.firstName,
        lastName: students.lastName,
        formLabel: classes.name,
        houseName: houses.name,
        dormName: boardingDormitory.name,
        bunkPos: boardingBunk.positionNumber,
        type: boardingExeat.exeatType,
        status: boardingExeat.status,
        reason: boardingExeat.reason,
        departAt: boardingExeat.departAt,
        returnBy: boardingExeat.returnBy,
        feeSnapshot: boardingExeat.feeOwingSnapshot,
        requestedAt: boardingExeat.requestedAt,
        hmApprovedAt: boardingExeat.hmApprovedAt,
        srHmSignedAt: boardingExeat.srHmSignedAt,
        departedAt: boardingExeat.departedAt,
        returnedAt: boardingExeat.returnedAt,
        declinedAt: boardingExeat.declinedAt,
        declineReason: boardingExeat.declineReason,
        // Actor ids — names resolved via one users lookup below (avoids 5 self-joins).
        requestedByUserId: boardingExeat.requestedByUserId,
        hmApprovedByUserId: boardingExeat.hmApprovedByUserId,
        srHmSignedByUserId: boardingExeat.srHmSignedByUserId,
        departedByUserId: boardingExeat.departedByUserId,
        returnedByUserId: boardingExeat.returnedByUserId,
      })
      .from(boardingExeat)
      .innerJoin(
        students,
        and(eq(students.schoolId, boardingExeat.schoolId), eq(students.id, boardingExeat.studentId)),
      )
      .innerJoin(
        houses,
        and(eq(houses.schoolId, boardingExeat.schoolId), eq(houses.id, boardingExeat.houseId)),
      )
      .leftJoin(classes, and(eq(classes.schoolId, students.schoolId), eq(classes.id, students.classId)))
      .leftJoin(
        boardingBunk,
        and(eq(boardingBunk.schoolId, students.schoolId), eq(boardingBunk.id, students.currentBunkId)),
      )
      .leftJoin(
        boardingDormitory,
        and(
          eq(boardingDormitory.schoolId, boardingBunk.schoolId),
          eq(boardingDormitory.id, boardingBunk.dormitoryId),
        ),
      )
      .where(eq(boardingExeat.schoolId, schoolId))
      .orderBy(desc(boardingExeat.createdAt));

    // Resolve every actor id → full_name in one lookup (the timeline shows who did each stage).
    const actorIds = Array.from(
      new Set(
        rows.flatMap((r) =>
          [
            r.requestedByUserId,
            r.hmApprovedByUserId,
            r.srHmSignedByUserId,
            r.departedByUserId,
            r.returnedByUserId,
          ].filter((v): v is string => !!v),
        ),
      ),
    );
    const actorNameById = new Map<string, string | null>();
    if (actorIds.length) {
      const names = await tx
        .select({ id: users.id, fullName: users.fullName })
        .from(users)
        .where(inArray(users.id, actorIds));
      for (const n of names) actorNameById.set(n.id, n.fullName);
    }
    const nameOf = (id: string | null): string | null => (id ? actorNameById.get(id) ?? null : null);

    // Sent notification kinds per exeat (for the idempotency-aware late band).
    const notes = await tx
      .select({ exeatId: exeatNotification.exeatId, kind: exeatNotification.kind })
      .from(exeatNotification)
      .where(eq(exeatNotification.schoolId, schoolId));
    const sentByExeat = new Map<string, NotificationKind[]>();
    for (const n of notes) {
      const list = sentByExeat.get(n.exeatId) ?? [];
      list.push(n.kind as NotificationKind);
      sentByExeat.set(n.exeatId, list);
    }

    const accessible = rows.filter((r) => canAccessHouse(roles, userId, r.hmUserId));
    const raw: RawExeat[] = accessible.map((r) => ({
      ...r,
      feeSnapshot: r.feeSnapshot != null ? Number(r.feeSnapshot) : 0,
      requestedBy: nameOf(r.requestedByUserId),
      hmApprovedBy: nameOf(r.hmApprovedByUserId),
      srHmSignedBy: nameOf(r.srHmSignedByUserId),
      departedBy: nameOf(r.departedByUserId),
      returnedBy: nameOf(r.returnedByUserId),
    }));

    const inFlightRaw = raw.filter((r) => r.status === "DEPARTED" && !r.returnedAt);
    const queueRaw = raw.filter(
      (r) => r.status === "REQUESTED" || r.status === "HM_APPROVED" || r.status === "SR_HM_SIGNED",
    );
    const returnsRaw = raw.filter(
      (r) => r.status === "RETURNED" && r.returnedAt && r.returnedAt.toISOString().slice(0, 10) === todayIso,
    );

    const inFlight: InFlightRow[] = inFlightRaw.map((r) => ({
      ...baseRow(r),
      elapsedLabel: elapsed(r.departedAt, now),
      stages: inFlightStages(r),
    }));

    const queue: ExeatRow[] = queueRaw.map(baseRow);
    const cleanCount = queue.filter((q) => q.clean).length;

    const returnsToday: ReturnRow[] = returnsRaw.map((r) => ({
      id: r.id,
      initials: initials(r.firstName, r.lastName),
      studentName: shortName(r.firstName, r.lastName),
      addressLine: addressLine(r),
      timeLabel: r.returnedAt ? fmtTime(r.returnedAt) : "—",
      late: isReturnedLate(r.returnedAt as Date, r.returnBy),
    }));

    // Overdue = DEPARTED ∧ now>return_by ∧ not returned (computed, never a status enum — AC E2).
    const lateRaw = inFlightRaw.filter((r) =>
      isOverdue(r.status, r.returnBy, r.returnedAt, now),
    );
    const late: LateRow[] = lateRaw.map((r) => {
      const dueStages = r.returnBy ? dueOverdueStages(r.returnBy, now) : [];
      const overMs = r.returnBy ? now.getTime() - r.returnBy.getTime() : 0;
      const overMin = Math.floor(overMs / 60_000);
      return {
        id: r.id,
        refCode: r.refCode,
        studentName: shortName(r.firstName, r.lastName),
        addressLine: addressLine(r),
        returnByLabel: fmtDateTime(r.returnBy),
        overdueLabel:
          overMin >= 60 ? `+${Math.floor(overMin / 60)}H ${overMin % 60}M` : `+${overMin} MIN`,
        dueStages,
        sentStages: sentByExeat.get(r.id) ?? [],
      };
    });

    const awaitingSrHm = queueRaw.filter(
      (r) => r.type === "SPECIAL" && r.status === "HM_APPROVED",
    ).length;
    const nSched = queueRaw.filter((r) => r.type === "SCHEDULED").length;
    const nSpecial = queueRaw.filter((r) => r.type === "SPECIAL").length;
    const nFee = queueRaw.filter((r) => r.type === "FEE_COLLECTION").length;
    const firstInFlight = inFlight[0];

    return {
      policy,
      windowLabel: nextWindow?.label ?? null,
      windowSequence: nextWindow?.sequence ?? null,
      periodLabel: period?.periodLabel ?? null,
      summary: {
        inFlight: inFlight.length,
        inQueue: queue.length,
        awaitingSrHm,
        returnsToday: returnsToday.length,
        lateReturns: late.length,
        queueBreakdown: `${nSched} scheduled · ${nSpecial} special · ${nFee} fee-collection`,
        inFlightSub: firstInFlight
          ? `${firstInFlight.studentName} · ${firstInFlight.addressLine}`
          : "no boarder off campus",
      },
      inFlight,
      queue,
      cleanCount,
      returnsToday,
      late,
      lateStages: overdueStageLabels(policy.returnByTime),
      hasBoarders: anyBoarder.length > 0,
    } satisfies ExeatBoard;
  });
}

export interface ExeatBoarderOption {
  id: string;
  name: string;
  house: string;
}

/** Active boarders in the user's accessible Houses — the "New exeat" picker (residency gate T4). */
export async function listExeatBoarders(
  schoolId: string,
  roles: readonly string[],
  userId: string | null,
): Promise<ExeatBoarderOption[]> {
  return withSchool(schoolId, async (tx) => {
    const rows = await tx
      .select({
        id: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        houseName: houses.name,
        hmUserId: houses.hmUserId,
      })
      .from(students)
      .innerJoin(houses, and(eq(houses.schoolId, students.schoolId), eq(houses.id, students.houseId)))
      .where(
        and(
          eq(students.schoolId, schoolId),
          eq(students.residency, "BOARDER"),
          eq(students.status, "ACTIVE"),
        ),
      )
      .orderBy(students.lastName);
    return rows
      .filter((r) => canAccessHouse(roles, userId, r.hmUserId))
      .map((r) => ({
        id: r.id,
        name: `${r.firstName} ${r.lastName}`,
        house: r.houseName,
      }));
  });
}

// ---------------------------------------------------------------------------
// Exeat card PDF data (keyed by exeat id only — the route never puts PII in the URL)
// ---------------------------------------------------------------------------

export interface ExeatCardData {
  school: { name: string; code: string };
  refCode: string;
  studentName: string;
  formHouseBunk: string;
  typeLabel: string;
  dateOut: string;
  dateIn: string;
  dressCode: string;
  feeLine: string;
  signerLabel: string;
  signerActor: string | null;
  houseName: string;
  academicYear: string;
  /** For the route's house-scope guard — the House HM, so a plain HM can only print their own. */
  houseHmUserId: string | null;
}

const TYPE_LABEL: Record<ExeatType, string> = {
  SCHEDULED: "Scheduled",
  SPECIAL: "Special",
  FEE_COLLECTION: "Fee collection",
};

/** Card data for one exeat, or null if not in this tenant / not found (RLS + predicate both scope). */
export async function getExeatCardData(
  tx: Tx,
  schoolId: string,
  exeatId: string,
): Promise<ExeatCardData | null> {
  const policy = await getExeatPolicy(schoolId);
  const [r] = await tx
    .select({
      refCode: boardingExeat.refCode,
      type: boardingExeat.exeatType,
      departAt: boardingExeat.departAt,
      departedAt: boardingExeat.departedAt,
      returnBy: boardingExeat.returnBy,
      feeSnapshot: boardingExeat.feeOwingSnapshot,
      academicYear: academicPeriod.academicYear,
      firstName: students.firstName,
      lastName: students.lastName,
      formLabel: classes.name,
      houseName: houses.name,
      hmUserId: houses.hmUserId,
      dormName: boardingDormitory.name,
      bunkPos: boardingBunk.positionNumber,
      schoolName: schools.name,
      schoolCode: schools.gesCode,
      signerActor: users.fullName,
    })
    .from(boardingExeat)
    .innerJoin(
      students,
      and(eq(students.schoolId, boardingExeat.schoolId), eq(students.id, boardingExeat.studentId)),
    )
    .innerJoin(
      houses,
      and(eq(houses.schoolId, boardingExeat.schoolId), eq(houses.id, boardingExeat.houseId)),
    )
    .innerJoin(
      academicPeriod,
      and(
        eq(academicPeriod.schoolId, boardingExeat.schoolId),
        eq(academicPeriod.periodId, boardingExeat.academicPeriodId),
      ),
    )
    .leftJoin(classes, and(eq(classes.schoolId, students.schoolId), eq(classes.id, students.classId)))
    .leftJoin(
      boardingBunk,
      and(eq(boardingBunk.schoolId, students.schoolId), eq(boardingBunk.id, students.currentBunkId)),
    )
    .leftJoin(
      boardingDormitory,
      and(
        eq(boardingDormitory.schoolId, boardingBunk.schoolId),
        eq(boardingDormitory.id, boardingBunk.dormitoryId),
      ),
    )
    .leftJoin(schools, eq(schools.id, boardingExeat.schoolId))
    .leftJoin(users, eq(users.id, boardingExeat.srHmSignedByUserId))
    .where(and(eq(boardingExeat.schoolId, schoolId), eq(boardingExeat.id, exeatId)))
    .limit(1);
  if (!r) return null;

  const fmtCard = (d: Date | null): string =>
    d
      ? new Intl.DateTimeFormat("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(d)
      : "—";
  const bunk = r.dormName && r.bunkPos != null ? ` · ${r.dormName}-${pad2(r.bunkPos)}` : "";
  const snapshot = r.feeSnapshot != null ? Number(r.feeSnapshot) : 0;
  const feeLine =
    r.type === "FEE_COLLECTION"
      ? `Collect ${money(snapshot)} — settle before return`
      : snapshot > 0
        ? `${money(snapshot)} outstanding`
        : "All clear · no collection";

  return {
    school: { name: r.schoolName ?? "School", code: r.schoolCode ?? "" },
    refCode: r.refCode,
    studentName: `${r.firstName} ${r.lastName}`,
    formHouseBunk: `${r.formLabel ?? "—"} · ${r.houseName}${bunk}`,
    typeLabel: TYPE_LABEL[r.type as ExeatType],
    dateOut: fmtCard(r.departedAt ?? r.departAt),
    dateIn: fmtCard(r.returnBy),
    dressCode: policy.dressCode,
    feeLine,
    signerLabel: policy.cardSigner,
    signerActor: r.signerActor ?? null,
    houseName: r.houseName,
    academicYear: r.academicYear,
    houseHmUserId: r.hmUserId ?? null,
  } satisfies ExeatCardData;
}
