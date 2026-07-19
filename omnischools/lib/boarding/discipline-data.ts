/**
 * SERVER-ONLY read for the boarding discipline surface (SHS module 4.2 / INCR-13, surface 07). The
 * client table components receive PRE-FORMATTED strings only — this module imports the DB driver and
 * must never be imported by a client component (the reports-data leak rule; only `pnpm build` catches
 * it). Every read is tenant-scoped (withSchool) and house-scoped for a plain HM.
 *
 * The ladder renders READ-only from the frozen getDeboardinizationLadder constant; counts are a
 * derived overlay. The penalty column is DISPLAY-ONLY from stored snapshots (computePenaltyDisplay) —
 * no billing read, no invoice write, fee_penalty_invoice_id stays NULL.
 */
import "server-only";
import { and, eq, inArray, desc } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import {
  boardingInfractions,
  deboardinizationRecords,
  bondArtefacts,
  students,
  houses,
  users,
  classes,
  schools,
} from "@/db/schema";
import { BOARDING_SCHOOL_SCOPED_ROLES, canAccessHouse, hasAnyRole } from "@/lib/access";
import { getCurrentPeriod } from "./period";
import { getDeboardinizationLadder, type DeboardinizationRung, type DeboardinizationSeverity } from "./deboardinization-ladder";
import { isPastorallyFlagged } from "./pastoral-stub";
import {
  SEVERITY_ROMAN,
  computePenaltyDisplay,
  penaltyCalcLine,
  ghs,
  deriveEscalation,
  signedCount,
  coSignStatusLabel,
  bondStatusLabel,
  refCode,
  type EscalationPrompt,
} from "./discipline";

const LEDGER_SEVERITIES: readonly DeboardinizationSeverity[] = ["NOTE", "WARNING", "BOND", "SUSPENSION"];
const ROWS_PER_GROUP = 6;

export interface LedgerRow {
  infractionId: string;
  studentName: string;
  studentSub: string;
  house: string;
  dateLabel: string;
  offence: string;
  loggedBy: string;
  active: boolean;
}
export interface LedgerGroup {
  severity: DeboardinizationSeverity;
  roman: string;
  rungName: string;
  count: number;
  shown: number;
  rows: LedgerRow[];
}
export interface CoSignChip {
  slot: "hm" | "seniorHm" | "headmaster";
  roleLabel: string;
  name: string;
  signed: boolean;
}
export interface DeboardCard {
  recordId: string;
  ref: string;
  studentName: string;
  studentSub: string;
  exHouse: string;
  status: "DEBOARDINIZED" | "REVIEW" | "DRAFT";
  statusLabel: string;
  effectiveLabel: string;
  offence: string;
  daysOffRoll: string;
  penaltyInvoiceLabel: string;
  coSigns: CoSignChip[];
  review: { label: string; motion: string } | null;
}
export interface BondCard {
  bondId: string;
  ref: string;
  studentName: string;
  studentSub: string;
  house: string;
  bondText: string;
  statusLabel: string;
  slots: { roleLabel: string; name: string; signed: boolean; whenLabel: string | null }[];
}
export interface PenaltyRow {
  ref: string;
  studentName: string;
  studentSub: string;
  calcLine: string;
  amountLabel: string;
  statusLabel: string; // "Pending — billing not yet wired" (STUB) unless the seed marks it paid/outstanding
  pending: boolean;
}
export interface PastoralCard {
  studentName: string;
  studentSub: string;
  house: string;
}
export interface DisciplineBoard {
  schoolName: string;
  periodLabel: string;
  academicYear: string;
  todayLabel: string;
  ladder: readonly DeboardinizationRung[];
  ladderCounts: Record<DeboardinizationSeverity, number>;
  summary: {
    openThisSemester: number;
    bondsActive: number;
    deboardinized: number;
    coSignsPending: number;
    penaltyTotal: string;
    penaltyCount: number;
  };
  groups: LedgerGroup[];
  activeCount: number;
  deboardCards: DeboardCard[];
  bonds: BondCard[];
  penaltyRows: PenaltyRow[];
  pastoral: PastoralCard | null;
  escalation: EscalationPrompt;
  boarderOptions: { id: string; label: string }[];
  canManageBoard: boolean;
  hasScope: boolean;
}

const fmtDateTime = (d: Date | null): string =>
  d
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
        .format(d)
        .replace(",", " ·")
    : "—";
const fmtDate = (d: Date | null): string =>
  d ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(d) : "—";

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}

export async function getDisciplineBoard(
  schoolId: string,
  roles: readonly string[],
  userId: string | null,
): Promise<DisciplineBoard> {
  const schoolScoped = hasAnyRole(roles, BOARDING_SCHOOL_SCOPED_ROLES);
  const canManageBoard = hasAnyRole(roles, ["HEADMASTER", "ADMIN"]);
  const now = new Date();

  return withSchool(schoolId, async (tx): Promise<DisciplineBoard> => {
    const [sch] = await tx.select({ name: schools.name }).from(schools).where(eq(schools.id, schoolId)).limit(1);
    const period = await getCurrentPeriod(tx, schoolId);

    // Accessible Houses (house-scope for a plain HM).
    const houseRows = await tx
      .select({ id: houses.id, name: houses.name, hmUserId: houses.hmUserId })
      .from(houses)
      .where(eq(houses.schoolId, schoolId));
    const accessible = houseRows.filter((h) => canAccessHouse(roles, userId, h.hmUserId));
    const houseIds = accessible.map((h) => h.id);
    const houseNameById = new Map(houseRows.map((h) => [h.id, h.name]));
    const hasScope = schoolScoped || houseIds.length > 0;

    const empty: DisciplineBoard = {
      schoolName: sch?.name ?? "School",
      periodLabel: period?.periodLabel ?? "—",
      academicYear: period?.academicYear ?? "—",
      todayLabel: fmtDate(now),
      ladder: getDeboardinizationLadder(schoolId),
      ladderCounts: { NOTE: 0, WARNING: 0, BOND: 0, SUSPENSION: 0, DEBOARDINIZATION: 0 },
      summary: { openThisSemester: 0, bondsActive: 0, deboardinized: 0, coSignsPending: 0, penaltyTotal: ghs(0), penaltyCount: 0 },
      groups: [],
      activeCount: 0,
      deboardCards: [],
      bonds: [],
      penaltyRows: [],
      pastoral: null,
      escalation: { eligible: null, message: null },
      boarderOptions: [],
      canManageBoard,
      hasScope,
    };
    if (!hasScope) return empty;

    // --- OPEN infractions (ledger), joined student/house/loggedBy ---
    const infr = await tx
      .select({
        id: boardingInfractions.id,
        studentId: boardingInfractions.studentId,
        houseId: boardingInfractions.houseId,
        severity: boardingInfractions.severity,
        narrative: boardingInfractions.narrativeText,
        status: boardingInfractions.status,
        loggedAt: boardingInfractions.loggedAt,
        firstName: students.firstName,
        lastName: students.lastName,
        studentCode: students.studentCode,
        className: classes.name,
        loggedByName: users.fullName,
      })
      .from(boardingInfractions)
      .innerJoin(students, and(eq(students.schoolId, boardingInfractions.schoolId), eq(students.id, boardingInfractions.studentId)))
      .leftJoin(classes, and(eq(classes.schoolId, students.schoolId), eq(classes.id, students.classId)))
      .leftJoin(users, eq(users.id, boardingInfractions.loggedByUserId))
      .where(and(eq(boardingInfractions.schoolId, schoolId), eq(boardingInfractions.status, "OPEN")))
      .orderBy(desc(boardingInfractions.loggedAt));

    const inScope = (houseId: string | null) => schoolScoped || (houseId != null && houseIds.includes(houseId));
    const scopedInfr = infr.filter((r) => inScope(r.houseId));

    const shortName = (f: string, l: string) => `${f.charAt(0)}. ${l}`;
    const ladderCounts: Record<DeboardinizationSeverity, number> = { NOTE: 0, WARNING: 0, BOND: 0, SUSPENSION: 0, DEBOARDINIZATION: 0 };
    for (const r of scopedInfr) ladderCounts[r.severity as DeboardinizationSeverity] += 1;

    const groups: LedgerGroup[] = LEDGER_SEVERITIES.map((sev) => {
      const rung = getDeboardinizationLadder(schoolId).find((x) => x.severity === sev)!;
      const all = scopedInfr.filter((r) => r.severity === sev);
      return {
        severity: sev,
        roman: SEVERITY_ROMAN[sev],
        rungName: rung.name,
        count: all.length,
        shown: Math.min(all.length, ROWS_PER_GROUP),
        rows: all.slice(0, ROWS_PER_GROUP).map((r) => ({
          infractionId: r.id,
          studentName: shortName(r.firstName, r.lastName),
          studentSub: r.className ?? "—",
          house: r.houseId ? houseNameById.get(r.houseId) ?? "—" : "—",
          dateLabel: fmtDateTime(r.loggedAt),
          offence: r.narrative,
          loggedBy: r.loggedByName ?? "System",
          active: sev === "BOND", // gold-highlight the in-flight bond rows (surface .active)
        })),
      };
    }).filter((g) => g.count > 0);
    const activeCount = scopedInfr.filter((r) => LEDGER_SEVERITIES.includes(r.severity as DeboardinizationSeverity)).length;

    // --- Deboardinization records (cards + penalty rows) ---
    const recs = await tx
      .select({
        id: deboardinizationRecords.id,
        studentId: deboardinizationRecords.studentId,
        infractionId: deboardinizationRecords.infractionId,
        hmSignUserId: deboardinizationRecords.hmSignUserId,
        hmSignAt: deboardinizationRecords.hmSignAt,
        seniorHmSignUserId: deboardinizationRecords.seniorHmSignUserId,
        seniorHmSignAt: deboardinizationRecords.seniorHmSignAt,
        headmasterSignUserId: deboardinizationRecords.headmasterSignUserId,
        headmasterSignAt: deboardinizationRecords.headmasterSignAt,
        effectiveAt: deboardinizationRecords.effectiveAt,
        boardReviewAt: deboardinizationRecords.boardReviewAt,
        boardDecisionText: deboardinizationRecords.boardDecisionText,
        reinstatedAt: deboardinizationRecords.reinstatedAt,
        penaltyDays: deboardinizationRecords.penaltyDays,
        penaltyPerDayAmount: deboardinizationRecords.penaltyPerDayAmount,
        penaltyAdjustedAmount: deboardinizationRecords.penaltyAdjustedAmount,
        penaltyAdjustmentReason: deboardinizationRecords.penaltyAdjustmentReason,
        createdAt: deboardinizationRecords.createdAt,
        firstName: students.firstName,
        lastName: students.lastName,
        studentCode: students.studentCode,
        className: classes.name,
        houseId: students.houseId,
        infractionHouseId: boardingInfractions.houseId,
        offence: boardingInfractions.narrativeText,
      })
      .from(deboardinizationRecords)
      .innerJoin(students, and(eq(students.schoolId, deboardinizationRecords.schoolId), eq(students.id, deboardinizationRecords.studentId)))
      .leftJoin(classes, and(eq(classes.schoolId, students.schoolId), eq(classes.id, students.classId)))
      .innerJoin(boardingInfractions, and(eq(boardingInfractions.schoolId, deboardinizationRecords.schoolId), eq(boardingInfractions.id, deboardinizationRecords.infractionId)))
      .where(eq(deboardinizationRecords.schoolId, schoolId))
      .orderBy(desc(deboardinizationRecords.createdAt));

    // Resolve all signer names in one pass.
    const signerIds = new Set<string>();
    for (const r of recs) {
      for (const uid of [r.hmSignUserId, r.seniorHmSignUserId, r.headmasterSignUserId]) if (uid) signerIds.add(uid);
    }
    const signerRows = signerIds.size
      ? await tx.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, [...signerIds]))
      : [];
    const signerById = new Map(signerRows.map((u) => [u.id, u.fullName ?? "—"]));

    const scopedRecs = recs.filter((r) => {
      const houseForScope = r.infractionHouseId ?? r.houseId;
      return schoolScoped || (houseForScope != null && houseIds.includes(houseForScope));
    });
    // Active (not reinstated) records only — a reinstated record leaves the "currently deboardinized" set.
    const liveRecs = scopedRecs.filter((r) => r.reinstatedAt == null);

    const yr = period ? Number(period.academicYear.slice(0, 4)) : now.getFullYear();
    const deboardCards: DeboardCard[] = liveRecs.map((r, i) => {
      const isEffective = r.effectiveAt != null;
      const status: DeboardCard["status"] = !isEffective ? "DRAFT" : r.boardReviewAt && !r.reinstatedAt ? "REVIEW" : "DEBOARDINIZED";
      const coSigns: CoSignChip[] = [
        { slot: "hm", roleLabel: "HM", name: r.hmSignUserId ? signerById.get(r.hmSignUserId) ?? "—" : "—", signed: r.hmSignAt != null },
        { slot: "seniorHm", roleLabel: "SR HM", name: r.seniorHmSignUserId ? signerById.get(r.seniorHmSignUserId) ?? "—" : "—", signed: r.seniorHmSignAt != null },
        { slot: "headmaster", roleLabel: "HEAD", name: r.headmasterSignUserId ? signerById.get(r.headmasterSignUserId) ?? "—" : "—", signed: r.headmasterSignAt != null },
      ];
      const days = r.effectiveAt ? daysBetween(r.effectiveAt, now) : 0;
      return {
        recordId: r.id,
        ref: refCode("DEB", yr, i + 1),
        studentName: shortName(r.firstName, r.lastName),
        studentSub: `${r.className ?? "—"} · ex-${r.houseId ? houseNameById.get(r.houseId) ?? "House" : "House"}`,
        exHouse: r.houseId ? houseNameById.get(r.houseId) ?? "House" : "House",
        status,
        statusLabel: status === "DRAFT" ? coSignStatusLabel({ hmAt: r.hmSignAt, seniorHmAt: r.seniorHmSignAt, headmasterAt: r.headmasterSignAt }) : status === "REVIEW" ? "★ Board review pending" : "Deboardinized",
        effectiveLabel: isEffective ? `Effective · ${fmtDate(r.effectiveAt)}` : "Draft · not yet effected",
        offence: r.offence,
        daysOffRoll: isEffective ? `${days} day${days === 1 ? "" : "s"}` : "—",
        penaltyInvoiceLabel: "penalty pending — billing not yet wired",
        coSigns,
        review: r.boardReviewAt && r.boardDecisionText ? { label: `Board review · ${fmtDateTime(r.boardReviewAt)}`, motion: r.boardDecisionText } : null,
      };
    });

    // Penalty rows (DISPLAY only) — from records that carry a penalty snapshot. fee_penalty_invoice_id
    // is NULL on every row; the status is the STUB "pending — billing not yet wired".
    const penaltyRows: PenaltyRow[] = [];
    let penaltyTotal = 0;
    scopedRecs
      .filter((r) => r.penaltyDays != null && r.penaltyPerDayAmount != null)
      .forEach((r, i) => {
        const disp = computePenaltyDisplay({
          days: r.penaltyDays,
          perDayAmount: r.penaltyPerDayAmount != null ? Number(r.penaltyPerDayAmount) : null,
          adjustedAmount: r.penaltyAdjustedAmount != null ? Number(r.penaltyAdjustedAmount) : null,
          adjustmentReason: r.penaltyAdjustmentReason,
        });
        if (!disp) return;
        penaltyTotal += disp.finalAmount;
        penaltyRows.push({
          ref: refCode("PEN", yr, i + 1),
          studentName: shortName(r.firstName, r.lastName),
          studentSub: `${r.className ?? "—"} · ex-${r.houseId ? houseNameById.get(r.houseId) ?? "House" : "House"}`,
          calcLine: penaltyCalcLine(disp),
          amountLabel: ghs(disp.finalAmount),
          statusLabel: "Pending — billing not yet wired",
          pending: true,
        });
      });

    // --- Bond artefacts in flight (OPEN bond infractions) ---
    const bondRows = await tx
      .select({
        id: bondArtefacts.id,
        infractionId: bondArtefacts.infractionId,
        bondText: bondArtefacts.bondText,
        studentSignatureAt: bondArtefacts.studentSignatureAt,
        hmWitnessUserId: bondArtefacts.hmWitnessUserId,
        hmWitnessAt: bondArtefacts.hmWitnessAt,
        seniorHmWitnessUserId: bondArtefacts.seniorHmWitnessUserId,
        seniorHmWitnessAt: bondArtefacts.seniorHmWitnessAt,
        createdAt: bondArtefacts.createdAt,
        firstName: students.firstName,
        lastName: students.lastName,
        className: classes.name,
        houseId: boardingInfractions.houseId,
        infStatus: boardingInfractions.status,
      })
      .from(bondArtefacts)
      .innerJoin(boardingInfractions, and(eq(boardingInfractions.schoolId, bondArtefacts.schoolId), eq(boardingInfractions.id, bondArtefacts.infractionId)))
      .innerJoin(students, and(eq(students.schoolId, boardingInfractions.schoolId), eq(students.id, boardingInfractions.studentId)))
      .leftJoin(classes, and(eq(classes.schoolId, students.schoolId), eq(classes.id, students.classId)))
      .where(eq(bondArtefacts.schoolId, schoolId))
      .orderBy(desc(bondArtefacts.createdAt));

    const witnessIds = new Set<string>();
    for (const b of bondRows) for (const uid of [b.hmWitnessUserId, b.seniorHmWitnessUserId]) if (uid) witnessIds.add(uid);
    const witnessRows = witnessIds.size
      ? await tx.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, [...witnessIds]))
      : [];
    const witnessById = new Map(witnessRows.map((u) => [u.id, u.fullName ?? "—"]));

    const bonds: BondCard[] = bondRows
      .filter((b) => (schoolScoped || (b.houseId != null && houseIds.includes(b.houseId))) && b.infStatus === "OPEN")
      .map((b, i) => ({
        bondId: b.id,
        ref: refCode("BOND", yr, i + 1),
        studentName: shortName(b.firstName, b.lastName),
        studentSub: `${b.className ?? "—"} · ${b.houseId ? houseNameById.get(b.houseId) ?? "House" : "House"}`,
        house: b.houseId ? houseNameById.get(b.houseId) ?? "House" : "House",
        bondText: b.bondText,
        statusLabel: bondStatusLabel({ studentAt: b.studentSignatureAt, hmAt: b.hmWitnessAt, seniorHmAt: b.seniorHmWitnessAt }),
        slots: [
          { roleLabel: "Student", name: shortName(b.firstName, b.lastName), signed: b.studentSignatureAt != null, whenLabel: b.studentSignatureAt ? fmtDateTime(b.studentSignatureAt) : null },
          { roleLabel: "Housemaster · witness", name: b.hmWitnessUserId ? witnessById.get(b.hmWitnessUserId) ?? "—" : "HM", signed: b.hmWitnessAt != null, whenLabel: b.hmWitnessAt ? fmtDateTime(b.hmWitnessAt) : null },
          { roleLabel: "Senior HM · witness", name: b.seniorHmWitnessUserId ? witnessById.get(b.seniorHmWitnessUserId) ?? "—" : "Senior HM", signed: b.seniorHmWitnessAt != null, whenLabel: b.seniorHmWitnessAt ? fmtDateTime(b.seniorHmWitnessAt) : null },
        ],
      }));

    // --- Pastoral cross-reference card (rendered only when an accessible boarder is flagged) ---
    const boarderRows = await tx
      .select({ id: students.id, firstName: students.firstName, lastName: students.lastName, studentCode: students.studentCode, className: classes.name, houseId: students.houseId })
      .from(students)
      .leftJoin(classes, and(eq(classes.schoolId, students.schoolId), eq(classes.id, students.classId)))
      .where(and(eq(students.schoolId, schoolId), eq(students.status, "ACTIVE"), eq(students.residency, "BOARDER")));
    const scopedBoarders = boarderRows.filter((b) => schoolScoped || (b.houseId != null && houseIds.includes(b.houseId)));
    const flagged = scopedBoarders.find((b) => isPastorallyFlagged(b.studentCode));
    const pastoral: PastoralCard | null = flagged
      ? {
          studentName: shortName(flagged.firstName, flagged.lastName),
          studentSub: flagged.className ?? "—",
          house: flagged.houseId ? houseNameById.get(flagged.houseId) ?? "House" : "House",
        }
      : null;

    const boarderOptions = scopedBoarders
      .filter((b) => !isPastorallyFlagged(b.studentCode)) // a flagged student is Dean-routed, not laddered
      .map((b) => ({ id: b.id, label: `${shortName(b.firstName, b.lastName)} · ${b.className ?? "—"} · ${b.houseId ? houseNameById.get(b.houseId) ?? "House" : "House"}` }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const activeBonds = ladderCounts.BOND; // open BOND-rung infractions = bonds signed / in force
    const deboardinizedCount = liveRecs.filter((r) => r.effectiveAt != null).length;
    const coSignsPending =
      liveRecs.filter((r) => r.effectiveAt == null && signedCount({ hmAt: r.hmSignAt, seniorHmAt: r.seniorHmSignAt, headmasterAt: r.headmasterSignAt }) > 0).length +
      bonds.filter((b) => b.statusLabel.startsWith("Awaiting")).length;

    return {
      schoolName: sch?.name ?? "School",
      periodLabel: period?.periodLabel ?? "—",
      academicYear: period?.academicYear ?? "—",
      todayLabel: fmtDate(now),
      ladder: getDeboardinizationLadder(schoolId),
      ladderCounts,
      summary: {
        openThisSemester: activeCount,
        bondsActive: activeBonds,
        deboardinized: deboardinizedCount,
        coSignsPending,
        penaltyTotal: ghs(penaltyTotal),
        penaltyCount: penaltyRows.length,
      },
      groups,
      activeCount,
      deboardCards,
      bonds,
      penaltyRows,
      pastoral,
      escalation: deriveEscalation(ladderCounts.NOTE, ladderCounts.WARNING),
      boarderOptions,
      canManageBoard,
      hasScope,
    };
  });
}
