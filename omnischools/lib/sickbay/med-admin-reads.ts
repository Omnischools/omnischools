/**
 * SERVER-ONLY read API for the sickbay MAR clinical surfaces (SHS module 4.4 / INCR-24b) — the derived
 * medication rounds (R175) and the per-visit administration log (R176). Imports the DB driver via
 * `withSchool`, so it must NEVER be imported by a client component: the pages fetch through these
 * readers, pre-format everything into plain strings/scalars, and pass the PINNED view types (from
 * ./med-admin) down. The pure shaping (witness decision, round status, amendment arrangement) lives in
 * ./med-admin and is unit-tested without the DB.
 *
 * 🔴 GATE (R177) — the MAR is clinical-read (HEADMASTER + MATRON, NOT ADMIN, NOT staff_grant_scope).
 * Each reader's FIRST statement refuses a non-clinical reader with `null` and ZERO SQL (the today-board
 * property): no drug, no dose, no name enters the flight payload for an ADMIN or a grantee (O2).
 *
 * 🔴 `withSchool`, NOT `withStaffScope` (R164) — the MAR is the acute/round clinical graph, gated like
 * the VISIT by the app-layer clinical pair, not the chronic register's per-entry grant boundary.
 */
import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import {
  roleAssignments,
  roles,
  sickbayChronicEntry,
  sickbayChronicMed,
  sickbayMedAdmin,
  sickbayStandingOrder,
  sickbayStockItem,
  staffProfiles,
  students,
  users,
} from "@/db/schema";
import { hasAnyRole, SICKBAY_CLINICAL_READ_ROLES } from "@/lib/access";
import { getRoundSchedule } from "./config";
import { civilDate } from "./visits";
import {
  arrangeAmendments,
  hhmmToMinutes,
  roundStatusOf,
  type MarRowView,
  type MedRoundView,
  type MedSource,
  type MedStatus,
  type RoundDoseView,
  type RoundStatus,
} from "./med-admin";

/** The actor shape — clinical role membership drives the gate; the id is unused by these READS. */
export interface MedActor {
  userId: string | null;
  roles: readonly string[];
}

/** `A. Bediako` — the render form; the FK is what is stored. */
function shortName(full: string | null): string | null {
  if (!full) return null;
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1];
  return parts.length > 1 ? `${parts[0].charAt(0)}. ${last}` : last;
}

const hhmm = (d: Date) =>
  `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

// ============================================================================
// R175 — the DERIVED medication rounds. slots × due − done, OVERDUE derived at read.
// ============================================================================

/**
 * `getMedicationRounds` → `/senior/sickbay/rounds`. Returns `null` for a non-clinical reader (ADMIN /
 * grantee), `[]` when the school has no MEDICATION_ROUND slots (the honest "not configured" state), else
 * one `MedRoundView` per active round (anchor first).
 *
 * 🔴 FIXED STATEMENT COUNT — exactly THREE DB round-trips regardless of #students or #rounds (Dex A3, no
 * per-student N+1): (1) the round schedule, (2) the due doses (chronic_med JOIN entry JOIN student),
 * (3) today's terminal MAR rows for those doses. Everything else is partitioned in memory.
 *
 * A dose is DUE when its live chronic_med is scheduled for the round (`slot_id`), NOT PRN (`is_prn=false`
 * — PRN never appears in a round, R179), its entry is active + on_site_treatable, and today's Accra civil
 * weekday ∈ the slot's `days_of_week`. It is DONE once a terminal MAR row exists for (chronic_med,
 * civil-day) — any of the 4 statuses. OVERDUE is derived at read (past `starts_at`, ≥1 open); NOTHING
 * auto-writes OMITTED, there is no scheduler.
 *
 * ponytail: the `runs_on_holidays` suppression is DEFERRED — the weekday filter (the operationally
 * load-bearing "which days") ships; the holiday-calendar arm needs the academic-calendar holiday source
 * and would be a 4th bounded query (breaking the exactly-3 guard). Add it with `lib/school-calendar`'s
 * `isHoliday` when a school reports a holiday-day false due-dose. Flagged for the gate.
 */
export async function getMedicationRounds(
  schoolId: string,
  actor: MedActor,
  now: Date,
): Promise<MedRoundView[] | null> {
  if (!hasAnyRole(actor.roles, SICKBAY_CLINICAL_READ_ROLES)) return null; // R177 — zero SQL for ADMIN/grantee

  // (1) the round schedule — active MEDICATION_ROUND slots, anchor first (getRoundSchedule → one query).
  const rounds = await getRoundSchedule(schoolId);
  if (rounds.length === 0) return [];
  const slotIds = rounds.map((r) => r.id);

  const isoDay = now.getUTCDay() === 0 ? 7 : now.getUTCDay(); // 1=Mon..7=Sun; Ghana civil = UTC
  const today = civilDate(now);
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  return withSchool(schoolId, async (tx) => {
    // (2) the due doses — one bounded query, JOINed, never per-student. is_prn=false EXCLUDES PRN (R179).
    const due = await tx
      .select({
        chronicMedId: sickbayChronicMed.id,
        slotId: sickbayChronicMed.slotId,
        drugName: sickbayChronicMed.drugName,
        doseLabel: sickbayChronicMed.doseLabel,
        note: sickbayChronicMed.note,
        studentId: sickbayChronicEntry.studentId,
        firstName: students.firstName,
        lastName: students.lastName,
      })
      .from(sickbayChronicMed)
      .innerJoin(
        sickbayChronicEntry,
        and(
          eq(sickbayChronicEntry.schoolId, schoolId),
          eq(sickbayChronicEntry.id, sickbayChronicMed.entryId),
        ),
      )
      .innerJoin(
        students,
        and(eq(students.schoolId, schoolId), eq(students.id, sickbayChronicEntry.studentId)),
      )
      .where(
        and(
          eq(sickbayChronicMed.schoolId, schoolId),
          inArray(sickbayChronicMed.slotId, slotIds),
          eq(sickbayChronicMed.isPrn, false),
          eq(sickbayChronicEntry.active, true),
          eq(sickbayChronicEntry.onSiteTreatable, true),
        ),
      );

    // (3) today's terminal MAR rows for those doses — half-open range on the indexed timestamp (never a
    // `::date` cast on the column; the medical-hold.ts sargability pattern). Empty when nothing recorded.
    const dueMedIds = [...new Set(due.map((d) => d.chronicMedId))];
    const done = dueMedIds.length
      ? await tx
          .select({
            chronicMedId: sickbayMedAdmin.chronicMedId,
            status: sickbayMedAdmin.status,
            administeredAt: sickbayMedAdmin.administeredAt,
          })
          .from(sickbayMedAdmin)
          .where(
            and(
              eq(sickbayMedAdmin.schoolId, schoolId),
              inArray(sickbayMedAdmin.chronicMedId, dueMedIds),
              sql`${sickbayMedAdmin.administeredAt} >= ${today}::date`,
              sql`${sickbayMedAdmin.administeredAt} < ${today}::date + interval '1 day'`,
            ),
          )
          .orderBy(asc(sickbayMedAdmin.administeredAt))
      : [];

    // Partition the done rows by chronic_med (latest wins for the status/time).
    const doneByMed = new Map<string, { status: MedStatus; administeredAt: Date }>();
    for (const d of done) {
      if (d.chronicMedId) doneByMed.set(d.chronicMedId, { status: d.status as MedStatus, administeredAt: d.administeredAt });
    }

    // Compute each round's status, tracking which future rounds are still open (for DUE-vs-PENDING).
    const built = rounds.map((slot) => {
      const runsToday = (slot.daysOfWeek as number[]).includes(isoDay);
      const slotDoses: RoundDoseView[] = runsToday
        ? due
            .filter((d) => d.slotId === slot.id)
            .map((d) => {
              const t = doneByMed.get(d.chronicMedId);
              return {
                chronicMedId: d.chronicMedId,
                studentId: d.studentId,
                studentName: `${d.firstName} ${d.lastName}`, // Q4 — FULL name (clinical-gated)
                drugName: d.drugName,
                doseLabel: d.doseLabel,
                note: d.note,
                done: !!t,
                status: t?.status ?? null,
              };
            })
            .sort((a, b) => a.studentName.localeCompare(b.studentName))
        : [];
      const openCount = slotDoses.filter((x) => !x.done).length;
      const givenCount = slotDoses.filter((x) => x.done && x.status === "GIVEN").length;
      const doneTimes = slotDoses
        .filter((x) => x.done)
        .map((x) => doneByMed.get(x.chronicMedId)!.administeredAt.getTime());
      const lastGivenAtHHMM = doneTimes.length ? hhmm(new Date(Math.max(...doneTimes))) : null;
      const base = roundStatusOf({
        hasAnyDue: slotDoses.length > 0,
        openCount,
        nowPastStart: nowMinutes >= hhmmToMinutes(slot.startsAt),
      });
      return {
        slot,
        base,
        view: {
          slotId: slot.id,
          startsAt: slot.startsAt,
          label: slot.label,
          isAnchor: slot.isAnchor,
          doses: slotDoses,
          openCount,
          givenCount,
          lastGivenAtHHMM,
        },
      };
    });

    // DUE = the FIRST future round with open doses (the "due next"); the rest of OPEN_FUTURE is PENDING.
    let markedDue = false;
    return built.map((b): MedRoundView => {
      let status: RoundStatus;
      if (b.base === "OPEN_FUTURE") {
        if (!markedDue) {
          status = "DUE";
          markedDue = true;
        } else {
          status = "PENDING";
        }
      } else {
        status = b.base; // DONE | OVERDUE | NONE_DUE
      }
      return { ...b.view, status };
    });
  });
}

// ============================================================================
// R176 — the per-visit MAR (the visit-record §3), append-only, amendment-footnoted.
// ============================================================================

/**
 * `getVisitMar` → the visit record §3 medications section. `null` for a non-clinical reader (ADMIN /
 * grantee — R177). Returns the visit's MAR rows arranged so each correction renders after its
 * byte-unchanged original (R176), pre-formatted for the client.
 */
export async function getVisitMar(
  schoolId: string,
  visitId: string,
  actor: MedActor,
): Promise<MarRowView[] | null> {
  if (!hasAnyRole(actor.roles, SICKBAY_CLINICAL_READ_ROLES)) return null;

  return withSchool(schoolId, async (tx) => {
    const rows = await tx
      .select({
        id: sickbayMedAdmin.id,
        administeredAt: sickbayMedAdmin.administeredAt,
        drugName: sickbayMedAdmin.drugName,
        doseLabel: sickbayMedAdmin.doseLabel,
        route: sickbayMedAdmin.route,
        source: sickbayMedAdmin.source,
        standingOrderId: sickbayMedAdmin.standingOrderId,
        consultId: sickbayMedAdmin.consultId,
        status: sickbayMedAdmin.status,
        isControlled: sickbayMedAdmin.isControlled,
        administeredByUserId: sickbayMedAdmin.administeredByUserId,
        witnessUserId: sickbayMedAdmin.witnessUserId,
        witnessOverrideReason: sickbayMedAdmin.witnessOverrideReason,
        notes: sickbayMedAdmin.notes,
        correctsAdminId: sickbayMedAdmin.correctsAdminId,
        amendmentNote: sickbayMedAdmin.amendmentNote,
      })
      .from(sickbayMedAdmin)
      .where(and(eq(sickbayMedAdmin.schoolId, schoolId), eq(sickbayMedAdmin.visitId, visitId)))
      .orderBy(asc(sickbayMedAdmin.administeredAt));
    if (rows.length === 0) return [];

    // Actor names (administered_by / witness), abbreviated. One bounded lookup.
    const userIds = [
      ...new Set(
        rows
          .flatMap((r) => [r.administeredByUserId, r.witnessUserId])
          .filter((x): x is string => x !== null),
      ),
    ];
    const userRows = userIds.length
      ? await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, userIds))
      : [];
    const nameOf = (id: string | null) =>
      id === null ? null : shortName(userRows.find((u) => u.id === id)?.name ?? null);

    // Standing-order complaints for the `Standing · {complaint}` tag. Bounded lookup, STANDING_ORDER only.
    const orderIds = [...new Set(rows.map((r) => r.standingOrderId).filter((x): x is string => x !== null))];
    const orderRows = orderIds.length
      ? await tx
          .select({ id: sickbayStandingOrder.id, complaint: sickbayStandingOrder.complaint })
          .from(sickbayStandingOrder)
          .where(and(eq(sickbayStandingOrder.schoolId, schoolId), inArray(sickbayStandingOrder.id, orderIds)))
      : [];
    const complaintOf = (id: string | null) =>
      id === null ? null : orderRows.find((o) => o.id === id)?.complaint ?? null;

    const views: MarRowView[] = rows.map((r) => ({
      id: r.id,
      administeredAtISO: r.administeredAt.toISOString(),
      administeredAtHHMM: hhmm(r.administeredAt),
      drugName: r.drugName,
      doseLabel: r.doseLabel,
      route: r.route,
      source: r.source as MedSource,
      standingComplaint: complaintOf(r.standingOrderId),
      consultId: r.consultId,
      status: r.status as MedStatus,
      isControlled: r.isControlled,
      administeredByName: nameOf(r.administeredByUserId),
      witnessName: nameOf(r.witnessUserId),
      witnessOverrideReason: r.witnessOverrideReason,
      notes: r.notes,
      correctsAdminId: r.correctsAdminId,
      amendmentNote: r.amendmentNote,
      amended: false, // set by arrangeAmendments
    }));

    return arrangeAmendments(views);
  });
}

/**
 * The witness/stock pickers the Add-dose / Record forms need — N&MC clinicians (≠ actor, Dex polish) and
 * the controlled stock items. MATRON-only (the sole MAR writer); returns null otherwise. NO patient here.
 */
export interface MarFormOptions {
  witnesses: { id: string; name: string }[];
  stockItems: { id: string; drugName: string; isControlled: boolean }[];
  standingOrders: { id: string; complaint: string }[];
}

export async function getMarFormOptions(
  schoolId: string,
  actor: MedActor,
): Promise<MarFormOptions | null> {
  if (!actor.roles.includes("MATRON")) return null;
  return withSchool(schoolId, async (tx) => {
    // N&MC clinicians in this school (the witness set) — MATRON with a licence, minus the acting user.
    const clinicians = await tx
      .selectDistinct({ id: users.id, name: users.fullName })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .innerJoin(users, eq(users.id, roleAssignments.userId))
      .innerJoin(
        staffProfiles,
        and(eq(staffProfiles.schoolId, roleAssignments.schoolId), eq(staffProfiles.userId, roleAssignments.userId)),
      )
      .where(
        and(
          eq(roleAssignments.schoolId, schoolId),
          eq(roles.code, "MATRON"),
          sql`${staffProfiles.nmcLicenceNumber} is not null`,
        ),
      );
    const stock = await tx
      .select({
        id: sickbayStockItem.id,
        drugName: sickbayStockItem.drugName,
        isControlled: sickbayStockItem.isControlled,
      })
      .from(sickbayStockItem)
      .where(and(eq(sickbayStockItem.schoolId, schoolId), eq(sickbayStockItem.active, true)));
    const orders = await tx
      .select({ id: sickbayStandingOrder.id, complaint: sickbayStandingOrder.complaint })
      .from(sickbayStandingOrder)
      .where(and(eq(sickbayStandingOrder.schoolId, schoolId), eq(sickbayStandingOrder.active, true)));
    return {
      witnesses: clinicians
        .filter((c) => c.id !== actor.userId)
        .map((c) => ({ id: c.id, name: c.name ?? "Unnamed clinician" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      stockItems: stock
        .map((s) => ({ id: s.id, drugName: s.drugName, isControlled: s.isControlled }))
        .sort((a, b) => a.drugName.localeCompare(b.drugName)),
      standingOrders: orders
        .map((o) => ({ id: o.id, complaint: o.complaint }))
        .sort((a, b) => a.complaint.localeCompare(b.complaint)),
    };
  });
}
