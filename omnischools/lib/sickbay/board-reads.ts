/**
 * SERVER-ONLY read API for the sickbay TODAY BOARD (SHS module 4.4 / INCR-22c) — ONE entry point.
 * Imports the DB driver via withSchool, so it must NEVER be imported by a client component: the
 * page fetches through `getSickbayBoard`, pre-formats everything into plain strings, and passes
 * serialisable props down.
 *
 * 🔴 R81 — THE GATE IS THE FIRST STATEMENT, BEFORE ANY QUERY IS ISSUED. `null` means "not a clinical
 * reader", and the page's whole job then is `<ClinicalRestricted label="Today" />`. That ordering is
 * the property that makes the ADMIN test strong: no SQL is issued at all, so there is nothing
 * clinical to trim out of a flight payload (AC G2). Sarah's INCR-22a advisory 1 landing early —
 * INCR-23's per-row rule (`role ∈ READ || hasGrant`) is added INSIDE here, where roles are in scope.
 *
 * 🔴 R68 — O(1) ROUND TRIPS IS PART OF THE CONTRACT. Four selects plus the two the frozen
 * `getSickbayConfig()` makes, flat as the queue grows. Any per-row query fails the AC whatever it
 * returns — and `getVisitRecord` in particular must never be called from here: it returns complaint,
 * impression, hydration, plan, every vital and every consult, so a per-row call would be an N×9
 * round-trip AND the A6/A12 adjacency leak in payload form (the 22c obligation at board L2497).
 *
 * 🔴 R69/R87 — THE FIELD CEILING, IN ONE SENTENCE: the only clinical string anywhere in this file is
 * `presenting_complaint`, on the queue projection only. `working_impression`, `red_flags_screened`,
 * `hydration_status`, `plan` and `escalation_triggers` are NOT SELECTED — not filtered afterwards,
 * never fetched. Every type but the queue is structurally incapable of carrying a clinical
 * assertion, which is what retires A1 as a vigilance item.
 *
 * 🔴 R68 — `now` IS A PARAMETER. Nothing here (and nothing the page renders) reads the clock: it is
 * pinned once in `page.tsx` and threaded. Grounded in the 22a R2 blocker — a clock read at module
 * load versus at call time went red 1-in-14 and cost a day; three components each calling
 * `new Date()` can render a queue whose "oldest wait" predates its own oldest row.
 *
 * ⚠️ R88 — `SickbayBedTile` is now very close to what INCR-28's housemaster reader needs. That is a
 * TRAP, not a convenience: 28 authors its own narrower `{studentId, studentName, admittedAt}` reader
 * (R41) and must not import from this file.
 */
import "server-only";
import { and, asc, eq, gte, inArray, isNull } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import {
  classes,
  houses,
  sickbayAdmission,
  sickbayBed,
  sickbayVisit,
  sickbayVitalReading,
  students,
  users,
} from "@/db/schema";
import { hasAnyRole, SICKBAY_CLINICAL_READ_ROLES } from "@/lib/access";
import { getSickbayConfig, type SickbayMode } from "./config";
import { formLabel } from "./defaults";
import { civilDate, isQueued, type SickbayDisposition } from "./visits";

// ============================================================================
// The four DISJOINT row types. These field lists are EXHAUSTIVE — the runtime key-set pin in
// scripts/verify-sickbay-board.ts asserts `Object.keys(row).sort()` against the frozen lists in
// ./board-copy, because a TS interface erases at runtime and the returned object does not.
// ============================================================================

/** The live queue. `complaint` is the ONE named adjacency exception (A6 — triage necessity). */
export interface SickbayQueueRow {
  visitId: string;
  studentName: string;
  formLabel: string;
  houseName: string | null;
  studentCode: string;
  presentedAt: Date;
  complaint: string;
}

/** The latest reading only — the glance-check instrument (A14), never the timeline. */
export interface SickbayLatestVital {
  takenAt: Date;
  tempC: number | null;
  systolic: number | null;
  diastolic: number | null;
  pulseBpm: number | null;
  spo2Pct: number | null;
  painScore: number | null;
}

/**
 * One open admission. 🔴 R87 — NO `workingImpression`, NO `hydrationStatus`, NO `plan`: not
 * selected, not returned, not rendered. The `.ab-line` prints location and time, and the record is
 * one click away.
 */
export interface SickbayWardPatient {
  admissionId: string;
  visitId: string;
  bedNumber: number;
  isIsolation: boolean;
  studentName: string;
  formLabel: string;
  houseName: string | null;
  studentCode: string;
  admittedAt: Date;
  admittedByName: string | null;
  expectedDischargeAt: Date | null;
  latestVital: SickbayLatestVital | null;
  /** The arrival pain score, for the Pain tile's `down from {n}` sub-line — arithmetic, not alerting. */
  firstPainScore: number | null;
}

/** A bed. `bedNumber` is the identity (R8); there is deliberately no bed id on the board at all. */
export interface SickbayBedTile {
  bedNumber: number;
  isIsolation: boolean;
  occupant: {
    studentName: string;
    formLabel: string;
    houseName: string | null;
    admittedAt: Date;
  } | null;
}

/** §03. No field to put a complaint in, so the A12 leak cannot return without a type error (R76). */
export interface SickbayRecentVisitRow {
  visitId: string;
  presentedAt: Date;
  studentName: string;
  formLabel: string;
  houseName: string | null;
  disposition: SickbayDisposition | null;
  dispositionAt: Date | null;
}

/** R74 — the terms of `today` SUM to `today.total`. The surface's own tally does not (R90). */
export interface SickbayBoardCounts {
  /** Open admissions right now. */
  admitted: number;
  /** ACTIVE beds — zero is a real answer and the caller renders no `/ M` denominator for it. */
  bedsTotal: number;
  queued: number;
  today: {
    total: number;
    discharged: number;
    admitted: number;
    referred: number;
    awaiting: number;
  };
}

export interface SickbayBoard {
  mode: SickbayMode;
  /** R25/R89 — a coalesced REFERRAL_ONLY is NOT a declared Mode C; the notice says so once. */
  configured: boolean;
  /** Derived from the mode by the frozen pure function — never stored, never hand-set (R4). */
  beds: boolean;
  counts: SickbayBoardCounts;
  queue: SickbayQueueRow[];
  ward: SickbayWardPatient[];
  bedTiles: SickbayBedTile[];
  recent: SickbayRecentVisitRow[];
}

/** `A. Bediako` — the render form; the FK is what is stored. */
const shortName = (full: string | null): string | null => {
  if (!full) return null;
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  return parts.length > 1
    ? `${parts[0].charAt(0)}. ${parts[parts.length - 1]}`
    : parts[0];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The whole board, or `null` for a reader who is not clinical.
 *
 * Round trips: config (2) + visits (1) + admissions (1) + vitals (1, skipped when the ward is
 * empty) = at most 5, and the count does not move when the queue grows.
 */
export async function getSickbayBoard(
  schoolId: string,
  roles: readonly string[],
  now: Date,
): Promise<SickbayBoard | null> {
  // R81/R88 — FIRST STATEMENT. ADMIN keeps module access and reaches the route; it gets no query.
  if (!hasAnyRole(roles, SICKBAY_CLINICAL_READ_ROLES)) return null;

  const since = new Date(now.getTime() - DAY_MS);

  // The mode is read FIRST so that a Mode-C school never issues the admission query at all: R55
  // means it can have no admission, and "no bed reference anywhere in the payload" is a property of
  // the DATA, not of the JSX (the shipped visit page models this — `availableBeds` is not even
  // computed when `capabilities.admissions` is false). Same round-trip count either way.
  const config = await getSickbayConfig(schoolId);

  const [visitRows, wardRows] = await Promise.all([
    // Q1 — the rolling 24h window on `presented_at`, riding `sickbay_visit_presented_idx
    // (school_id, presented_at)` which 0057 authored for exactly this read. NOT the civil date:
    // a civil-date window is empty at 06:00, which is precisely when the incoming matron needs last
    // night's 19:40 referral (R75). It feeds the queue, §03 and both counters — one predicate.
    // R78: voided visits are excluded here, so they are excluded from every consumer at once.
    withSchool(schoolId, async (tx) =>
      tx
        .select({
          visitId: sickbayVisit.id,
          presentedAt: sickbayVisit.presentedAt,
          startedAt: sickbayVisit.startedAt,
          disposition: sickbayVisit.disposition,
          dispositionAt: sickbayVisit.dispositionAt,
          complaint: sickbayVisit.presentingComplaint,
          firstName: students.firstName,
          lastName: students.lastName,
          studentCode: students.studentCode,
          programme: students.programme,
          className: classes.name,
          classLevel: classes.level,
          houseName: houses.name,
        })
        .from(sickbayVisit)
        .innerJoin(
          students,
          and(eq(students.schoolId, schoolId), eq(students.id, sickbayVisit.studentId)),
        )
        .leftJoin(
          classes,
          and(eq(classes.schoolId, schoolId), eq(classes.id, students.classId)),
        )
        .leftJoin(
          houses,
          and(eq(houses.schoolId, schoolId), eq(houses.id, students.houseId)),
        )
        .where(
          and(
            eq(sickbayVisit.schoolId, schoolId),
            gte(sickbayVisit.presentedAt, since),
            isNull(sickbayVisit.voidedAt),
          ),
        ),
    ),
    // Q2 — every OPEN admission. No time window: a multi-day stay's visit fell out of Q1's 24h
    // hours ago, and she is still in the bed. NOT ISSUED AT ALL in Mode C (R55).
    !config.capabilities.beds
      ? []
      : withSchool(schoolId, async (tx) =>
          tx
            .select({
              admissionId: sickbayAdmission.id,
              visitId: sickbayAdmission.visitId,
              admittedAt: sickbayAdmission.admittedAt,
              isIsolation: sickbayAdmission.isIsolation,
              expectedDischargeAt: sickbayAdmission.expectedDischargeAt,
              bedNumber: sickbayBed.bedNumber,
              admittedByName: users.fullName,
              firstName: students.firstName,
              lastName: students.lastName,
              studentCode: students.studentCode,
              programme: students.programme,
              className: classes.name,
              classLevel: classes.level,
              houseName: houses.name,
            })
            .from(sickbayAdmission)
            .innerJoin(
              sickbayBed,
              and(
                eq(sickbayBed.schoolId, schoolId),
                eq(sickbayBed.id, sickbayAdmission.bedId),
              ),
            )
            .innerJoin(
              students,
              and(
                eq(students.schoolId, schoolId),
                eq(students.id, sickbayAdmission.studentId),
              ),
            )
            .leftJoin(
              classes,
              and(eq(classes.schoolId, schoolId), eq(classes.id, students.classId)),
            )
            .leftJoin(
              houses,
              and(eq(houses.schoolId, schoolId), eq(houses.id, students.houseId)),
            )
            .leftJoin(users, eq(users.id, sickbayAdmission.admittedByUserId))
            .where(
              and(
                eq(sickbayAdmission.schoolId, schoolId),
                isNull(sickbayAdmission.dischargedAt),
              ),
            ),
        ),
  ]);

  // Q3 — ONE query for every reading of every admitted patient, ordered, then grouped in memory.
  // Skipped entirely when nobody is on a bed. A per-patient query here would be the N+1 the
  // contract forbids.
  const wardVisitIds = wardRows.map((w) => w.visitId);
  const vitalRows = wardVisitIds.length
    ? await withSchool(schoolId, async (tx) =>
        tx
          .select({
            visitId: sickbayVitalReading.visitId,
            takenAt: sickbayVitalReading.takenAt,
            tempC: sickbayVitalReading.tempC,
            systolic: sickbayVitalReading.systolic,
            diastolic: sickbayVitalReading.diastolic,
            pulseBpm: sickbayVitalReading.pulseBpm,
            spo2Pct: sickbayVitalReading.spo2Pct,
            painScore: sickbayVitalReading.painScore,
          })
          .from(sickbayVitalReading)
          .where(
            and(
              eq(sickbayVitalReading.schoolId, schoolId),
              inArray(sickbayVitalReading.visitId, wardVisitIds),
            ),
          )
          .orderBy(asc(sickbayVitalReading.takenAt)),
      )
    : [];

  const ward: SickbayWardPatient[] = wardRows
    .map((w) => {
      const readings = vitalRows.filter((v) => v.visitId === w.visitId);
      const last = readings[readings.length - 1];
      const firstPain = readings.find((v) => v.painScore !== null)?.painScore ?? null;
      return {
        admissionId: w.admissionId,
        visitId: w.visitId,
        bedNumber: w.bedNumber,
        isIsolation: w.isIsolation,
        studentName: `${w.firstName} ${w.lastName}`,
        formLabel: formLabel(w.classLevel, w.className, w.programme),
        houseName: w.houseName,
        studentCode: w.studentCode,
        admittedAt: w.admittedAt,
        admittedByName: shortName(w.admittedByName),
        expectedDischargeAt: w.expectedDischargeAt,
        latestVital: last
          ? {
              takenAt: last.takenAt,
              // numeric(3,1) round-trips as a string in pg.
              tempC: last.tempC === null ? null : Number(last.tempC),
              systolic: last.systolic,
              diastolic: last.diastolic,
              pulseBpm: last.pulseBpm,
              spo2Pct: last.spo2Pct,
              painScore: last.painScore,
            }
          : null,
        firstPainScore: firstPain,
      };
    })
    .sort((a, b) => a.bedNumber - b.bedNumber);

  // R70 guard 2 — ONE SELECT PER TYPE. The bed tiles are built from `config.beds` (Q4) joined to the
  // admission rows by BED NUMBER, never by mapping over `ward`: `bedTiles = ward.map(...)` is exactly
  // how a clinical field arrives on a second type as a "harmless" spread.
  // R55/R5 — Mode C has no beds, so there is no markup, no `0 / 0`, and no bed reference in the
  // flight payload at all (the shipped visit page models this with `availableBeds`).
  const occupantOf = (bedNumber: number) => {
    const w = wardRows.find((r) => r.bedNumber === bedNumber);
    return w
      ? {
          studentName: `${w.firstName} ${w.lastName}`,
          formLabel: formLabel(w.classLevel, w.className, w.programme),
          houseName: w.houseName,
          admittedAt: w.admittedAt,
        }
      : null;
  };
  const bedTiles: SickbayBedTile[] = config.capabilities.beds
    ? config.beds
        .filter((b) => b.active)
        .map((b) => ({
          bedNumber: b.bedNumber,
          isIsolation: b.isIsolation,
          occupant: occupantOf(b.bedNumber),
        }))
    : [];

  // R33 — the shipped queue predicate: not voided, not started, no disposition, presented TODAY.
  // Ordered by `presented_at` ascending, longest wait first.
  const queue: SickbayQueueRow[] = visitRows
    .filter((v) => isQueued({ ...v, voidedAt: null }, now))
    .sort((a, b) => a.presentedAt.getTime() - b.presentedAt.getTime())
    .map((v) => ({
      visitId: v.visitId,
      studentName: `${v.firstName.charAt(0)}. ${v.lastName}`,
      formLabel: formLabel(v.classLevel, v.className, v.programme),
      houseName: v.houseName,
      studentCode: v.studentCode,
      presentedAt: v.presentedAt,
      complaint: v.complaint,
    }));

  // §03 — every non-voided visit in the window, most recent first. Open visits are INCLUDED (R77):
  // an IN_PROGRESS visit is in neither the queue nor the ward, so it would otherwise be invisible.
  const recent: SickbayRecentVisitRow[] = [...visitRows]
    .sort((a, b) => b.presentedAt.getTime() - a.presentedAt.getTime())
    .map((v) => ({
      visitId: v.visitId,
      presentedAt: v.presentedAt,
      studentName: `${v.firstName.charAt(0)}. ${v.lastName}`,
      formLabel: formLabel(v.classLevel, v.className, v.programme),
      houseName: v.houseName,
      disposition: v.disposition,
      dispositionAt: v.dispositionAt,
    }));

  // `Visits today` = every non-voided visit presented on the current civil day, INCLUDING the ones
  // still standing in the queue (R90/§6.3 — the surface's `5` excludes its own three queued
  // students). The 24h window is a superset of the civil day at every hour, so one query serves both.
  const today = visitRows.filter((v) => civilDate(v.presentedAt) === civilDate(now));
  const countBy = (d: SickbayDisposition) =>
    today.filter((v) => v.disposition === d).length;

  return {
    mode: config.mode,
    configured: config.configured,
    beds: config.capabilities.beds,
    counts: {
      admitted: ward.length,
      bedsTotal: config.bedCounts.total,
      queued: queue.length,
      today: {
        total: today.length,
        discharged: countBy("DISCHARGE"),
        admitted: countBy("ADMIT"),
        referred: countBy("REFER"),
        awaiting: today.filter((v) => v.disposition === null).length,
      },
    },
    queue,
    ward,
    bedTiles,
    recent,
  };
}
