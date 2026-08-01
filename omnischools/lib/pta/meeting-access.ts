/**
 * PTA meeting write-access decision (SHS module 4.7 / INCR-52 · R439) — PURE, DB-free, unit-tested
 * (meeting-access.test.ts). The pure core of the module's IDOR fence, extracted (off the server-only
 * reader) so it is testable without a database — the officers.ts / points.ts discipline.
 *
 * The register writer is the PTA's SECRETARY, held BY IDENTITY: a stored `pta_officer` Secretary row, or —
 * for FORM/HOUSE — the ex-officio class-teacher / housemaster who OCCUPIES the Secretary slot. `heldOffices`
 * and the class-teacher / housemaster ids are SERVER-loaded by the caller (resolvePtaWriteAccess), NEVER
 * request-supplied. NO bare KnownAppRole satisfies the officer arm — `canActAsPtaOfficer` takes no `roles`
 * argument, so it is structurally un-satisfiable by a role ([[builds-widen-ratified-authz-and-self-bless]]);
 * only ADMIN / HEADMASTER reach it, through the SEPARATE break-glass arm. A Secretary of PTA-A cannot write
 * PTA-B: the caller passes only the offices held in the TARGET pta (empty for a foreign PTA's Secretary).
 */
import { canActAsPtaOfficer, hasAnyRole, PTA_MEETING_BREAKGLASS_ROLES } from "@/lib/access";
import { coalesceExOfficio } from "./officers";
import type { PtaTierType } from "./defaults";

export function computePtaWriteAccess(args: {
  tierType: PtaTierType;
  classTeacherUserId: string | null;
  hmUserId: string | null;
  tierSettings: Record<string, string>;
  heldOffices: readonly string[];
  viewer: { userId: string | null; roles: readonly string[] };
}): { canWrite: boolean; secretaryOffice: string } {
  const secretaryOffice = coalesceExOfficio(args.tierSettings).exOfficioOffice;
  if (hasAnyRole(args.viewer.roles, PTA_MEETING_BREAKGLASS_ROLES)) return { canWrite: true, secretaryOffice };
  if (!args.viewer.userId) return { canWrite: false, secretaryOffice };
  const exOfficioOffices: string[] = [];
  if (args.tierType === "FORM" && args.classTeacherUserId === args.viewer.userId) exOfficioOffices.push(secretaryOffice);
  if (args.tierType === "HOUSE" && args.hmUserId === args.viewer.userId) exOfficioOffices.push(secretaryOffice);
  const canWrite = canActAsPtaOfficer({
    userId: args.viewer.userId,
    heldOffices: args.heldOffices,
    exOfficioOffices,
    office: secretaryOffice,
  });
  return { canWrite, secretaryOffice };
}
