/**
 * SERVER-ONLY reader for the VLC curriculum-library change queue (SHS module 4.5 / issue #296). Lists the
 * PROPOSED requests the Headmaster approves/rejects, pre-formatted: op preview title + detail + proposer
 * name + a friendly date. Imports the DB driver via withSchool — NEVER import from a client component; the
 * page passes plain serializable strings to the pending panel (the lib/reports/*-data server-only
 * discipline — a client table never receives a live row). All reads are tenant-scoped; RLS is the boundary.
 *
 * INERT-UNTIL-APPROVED is enforced HERE by omission: a PROPOSED request is only ever surfaced by THIS
 * reader (the approval queue). The OPERATIONAL readers (getVlcSetup + every session/arc read) query
 * vlc_value directly and never touch vlc_value_change_request, so a proposed add/reorder/remove is
 * invisible to them until approveChangeRequest writes the change onto vlc_value.
 */
import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { users, vlcValue, vlcValueChangeRequest } from "@/db/schema";
import { previewChange, type VlcChangeOp } from "./change-request";

export interface VlcPendingChange {
  id: string;
  op: VlcChangeOp;
  title: string;
  detail: string | null;
  proposedBy: string | null;
  proposedAt: string;
}

const fmtDate = (d: Date): string =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);

/** The Headmaster's approval queue — every PROPOSED request, oldest first, pre-formatted. */
export async function getVlcPendingChanges(schoolId: string): Promise<VlcPendingChange[]> {
  return withSchool(schoolId, async (tx) => {
    const nameRows = await tx
      .select({ id: vlcValue.id, nameEn: vlcValue.nameEn })
      .from(vlcValue)
      .where(eq(vlcValue.schoolId, schoolId));
    const nameById = new Map(nameRows.map((r) => [r.id, r.nameEn]));

    const rows = await tx
      .select({
        id: vlcValueChangeRequest.id,
        op: vlcValueChangeRequest.op,
        payload: vlcValueChangeRequest.payload,
        proposedAt: vlcValueChangeRequest.proposedAt,
        proposedBy: users.fullName,
      })
      .from(vlcValueChangeRequest)
      .leftJoin(users, eq(users.id, vlcValueChangeRequest.proposedByUserId))
      .where(and(eq(vlcValueChangeRequest.schoolId, schoolId), eq(vlcValueChangeRequest.state, "PROPOSED")))
      .orderBy(asc(vlcValueChangeRequest.proposedAt));

    return rows.map((r) => {
      const preview = previewChange(r.op, r.payload, nameById);
      return {
        id: r.id,
        op: preview.op,
        title: preview.title,
        detail: preview.detail,
        proposedBy: r.proposedBy,
        proposedAt: fmtDate(r.proposedAt),
      };
    });
  });
}
