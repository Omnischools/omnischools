import "server-only";
import { sql } from "drizzle-orm";
import { withParentScope } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import type { ExeatStatus, ExeatType } from "@/lib/boarding/exeat-decision";

/**
 * 🔴 EXEAT PHASE 2 · the PARENT-facing exeat READER (own-child status). SERVER-ONLY — imports the db
 * driver, so a client component must never import it (only `pnpm build` catches the leak; the parent-*-data
 * precedent). boarding_exeat + house STAY fully parent_deny — the parent reads them ONLY through the
 * SECURITY DEFINER `parent_exeat_list` fn (Wells, prod-paste-0098), whose own-child fence + column
 * projection are the authority. This module runs the fn inside `withParentScope` and pre-formats every
 * timestamp into a display string (the client takes strings, never Date — server-only leak rule).
 *
 * The fn ALREADY drops fee_owing_snapshot / decline_reason / *_by_user_id AND redacts a non-portal
 * (staff-authored) `reason` to NULL — via_parent_portal is the provenance authority, NOT the broadly-true
 * parent_initiated flag (Sarah leak-fix). So a `reason` that reaches us is the parent's OWN words; our only
 * copy guard is the friendly status label (Kofi C2) and the DETAIL rule — echo a present reason, else a
 * friendly TYPE label; a FEE_COLLECTION row is relabelled to a bare "Fee collection".
 */

/** Friendly status label — Kofi C2. Parent-facing; never the operational REQUESTED/HM_APPROVED vocabulary. */
const STATUS_LABEL: Record<ExeatStatus, string> = {
  REQUESTED: "Submitted — awaiting the school's approval",
  HM_APPROVED: "Approved by the House — awaiting final sign-off",
  SR_HM_SIGNED: "Approved and signed off",
  DEPARTED: "Signed out — currently at home",
  RETURNED: "Returned to school",
  DECLINED: "Not approved — please contact the House",
  WITHDRAWN: "Withdrawn — you cancelled this request.",
};

/** Friendly TYPE label for a row the parent did NOT author (never echo staff-entered reason text). */
const TYPE_LABEL: Record<ExeatType, string> = {
  SCHEDULED: "Scheduled leave",
  SPECIAL: "Special leave",
  FEE_COLLECTION: "Fee collection",
};

/** Stages that count as an OPEN (live) exeat — mirrors the fn's B9 open-guard. Terminal = RETURNED/DECLINED. */
const OPEN_STATUSES: readonly ExeatStatus[] = ["REQUESTED", "HM_APPROVED", "SR_HM_SIGNED", "DEPARTED"];

/** PURE — the friendly status label (falls back to a neutral phrase for an unknown status). */
export function exeatStatusLabel(status: string): string {
  return STATUS_LABEL[status as ExeatStatus] ?? "In progress";
}

/**
 * PURE (Exeat Phase 3-A) — is the exeat CARD PDF downloadable for this (status, type)? MIRRORS the
 * eligibility gate embedded in `parent_exeat_card` (Wells, prod-paste-0099) so the UI only offers the link
 * for a card-ready row. ADVISORY ONLY — the fn + the /api/parent/exeat-card route are the authority (an
 * ineligible id gets 0 rows → a neutral 404). A SPECIAL needs the Senior-HM signature; a SCHEDULED/
 * FEE_COLLECTION needs only the House approval. REQUESTED / DECLINED / RETURNED → false (RETURNED is
 * excluded per owner — the card is a live-window artefact, not a returned-trip receipt).
 */
export function isCardReady(status: string, type: string): boolean {
  if (type === "SPECIAL") return status === "SR_HM_SIGNED" || status === "DEPARTED";
  if (type === "SCHEDULED" || type === "FEE_COLLECTION")
    return status === "HM_APPROVED" || status === "DEPARTED";
  return false;
}

/**
 * PURE (Exeat Phase 3-B) — may the parent CANCEL this request from the portal? True only for a still-
 * REQUESTED row whose `reason` is present. Reason-presence is the PORTAL-ORIGIN proxy: `parent_exeat_list`
 * redacts a staff-authored reason to NULL, so a present reason ⟺ via_parent_portal=true (the SAME signal
 * `exeatDetail` already trusts) — we never put via_parent_portal on the parent wire. ADVISORY ONLY: the
 * SECURITY DEFINER `parent_withdraw_exeat` fn is the authority (own-child + via_parent_portal + REQUESTED);
 * a mis-shown button just yields a neutral "contact the House". WITHDRAWN → false (no reason echoed; not REQUESTED).
 */
export function canWithdraw(row: { status: string; reason: string | null }): boolean {
  return row.status === "REQUESTED" && !!row.reason?.trim();
}

/**
 * PURE — what to show as the row's "reason/detail" (Kofi C2 detail rule):
 *  • FEE_COLLECTION → a bare "Fee collection" — NEVER its amount-bearing reason.
 *  • a present reason → the parent's OWN words. `parent_exeat_list` REDACTS a staff-authored reason to
 *    NULL (via_parent_portal is the authority), so any reason that reaches here was parent-typed.
 *  • no reason → a friendly TYPE label (a staff-recorded exeat's reason never reaches the parent).
 */
export function exeatDetail(row: { exeatType: string; reason: string | null }): string {
  if (row.exeatType === "FEE_COLLECTION") return "Fee collection";
  const reason = row.reason?.trim();
  if (reason) return reason;
  return TYPE_LABEL[row.exeatType as ExeatType] ?? "Leave";
}

export type ParentExeatMilestone = { label: string; value: string };
export type ParentExeatRow = {
  id: string;
  refCode: string;
  statusLabel: string;
  detail: string;
  houseName: string | null;
  isOpen: boolean; // any live stage → the request form disables submit (advisory; the fn is authoritative)
  canWithdraw: boolean; // still-REQUESTED portal request → show "Withdraw request" (advisory; parent_withdraw_exeat is authoritative)
  cardReady: boolean; // download-eligible → show the "Download exeat card" link (advisory; the route is authoritative)
  milestones: ParentExeatMilestone[]; // pre-formatted display strings, only the ones that exist
};

/** The raw fn row (timestamptz → Date via the pg driver). */
type RawParentExeat = {
  exeat_id: string;
  ref_code: string;
  exeat_type: string;
  status: string;
  parent_initiated: boolean;
  reason: string | null;
  depart_at: Date | null;
  return_by: Date | null;
  departed_at: Date | null;
  returned_at: Date | null;
  hm_approved_at: Date | null;
  sr_hm_signed_at: Date | null;
  house_name: string | null;
};

// UTC formatting (the DB session is UTC; a leave date must not drift with the server zone — the exam-time
// precedent in lib/wassce/parent-copy.ts). Date-only for the planning dates; date+time for actual events.
const D = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
});
const DT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
});

/** MUST run on a `tx` already scoped by `withParentScope`. */
export async function loadParentExeatsTx(
  tx: Tx,
  schoolId: string,
  userId: string,
): Promise<ParentExeatRow[]> {
  const rows = (await tx.execute(
    sql`select * from parent_exeat_list(${schoolId}::uuid, ${userId}::uuid)`,
  )) as unknown as RawParentExeat[];

  return rows.map((r) => {
    const milestones: ParentExeatMilestone[] = [];
    if (r.depart_at) milestones.push({ label: "Leaves", value: D.format(r.depart_at) });
    if (r.return_by) milestones.push({ label: "Back by", value: DT.format(r.return_by) });
    if (r.departed_at) milestones.push({ label: "Signed out", value: DT.format(r.departed_at) });
    if (r.returned_at) milestones.push({ label: "Returned", value: DT.format(r.returned_at) });
    return {
      id: r.exeat_id,
      refCode: r.ref_code,
      statusLabel: exeatStatusLabel(r.status),
      detail: exeatDetail({ exeatType: r.exeat_type, reason: r.reason }),
      houseName: r.house_name,
      isOpen: OPEN_STATUSES.includes(r.status as ExeatStatus),
      canWithdraw: canWithdraw({ status: r.status, reason: r.reason }),
      cardReady: isCardReady(r.status, r.exeat_type),
      milestones,
    };
  });
}

/** Entry point — the parent's own-child exeats under `withParentScope` (never `withSchool`). */
export async function loadParentExeats(schoolId: string, userId: string): Promise<ParentExeatRow[]> {
  return withParentScope(schoolId, userId, (tx) => loadParentExeatsTx(tx, schoolId, userId));
}
