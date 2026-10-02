"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession, AdminAccessDeniedError } from "@/lib/provisioning/admin-auth";
import { getProvisionerClient, ProvisionerUnavailableError } from "@/lib/provisioning/db";
import {
  ApprovalCodeError,
  mintApprovalCode,
  verifyApprovalCode,
} from "@/lib/provisioning/approval";
import {
  ProvisioningError,
  deactivateOfficer,
  provisionOfficer,
  requiresTwoPerson,
  resolveNodeTier,
} from "@/lib/provisioning/officers";

/**
 * The admin console's server actions (Lucy G8.b/G8.c/G8.d).
 *
 * EVERY action starts with `requireAdminSession()`. Not "the page checked already": a server action
 * is an HTTP endpoint, reachable without ever rendering the page that normally calls it, so the
 * layout's gate protects the VIEW and this protects the CAPABILITY. The two are separate because
 * they are separately reachable.
 *
 * And every action writes its `audit_officer_provisioning` row in the SAME TRANSACTION as the
 * directory write — `lib/provisioning/officers.ts` holds that, and it is the same code the CLI
 * loader uses, so there is exactly one implementation of "a grant and its record are one thing".
 */

export type AdminActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string }
  | {
      status: "approval_required";
      message: string;
      tier: string;
      /** Echoed so the form can be resubmitted with a code rather than retyped. */
      fields: { officerId: string; jurisdictionId: string; fullName: string; workEmail: string; reason: string };
    }
  | { status: "code"; code: string; expiresInMinutes: number };

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function toMessage(err: unknown): string {
  if (
    err instanceof ProvisioningError ||
    err instanceof ApprovalCodeError ||
    err instanceof ProvisionerUnavailableError ||
    err instanceof AdminAccessDeniedError
  ) {
    return err.message;
  }
  // Anything else is unexpected. Say so plainly rather than leaking a Postgres string into the UI —
  // but do not pretend it succeeded.
  return "That provisioning action failed. Nothing was written. Check the server logs.";
}

/**
 * PROVISION (Lucy G8.b).
 *
 * The tier and the role are derived from the chosen node (there is no tier input), and a
 * REGION/NATIONAL grant needs a second administrator's approval code before anything is written.
 * The order is: resolve the tier → demand the approval → write. So a grant that lacks its second
 * signature never reaches the database, and the CHECK constraint behind it is a backstop rather than
 * the thing the UI relies on.
 */
export async function provisionOfficerAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    const admin = await requireAdminSession();
    const sql = getProvisionerClient();

    const officerId = field(formData, "officerId");
    const jurisdictionId = field(formData, "jurisdictionId");
    const fullName = field(formData, "fullName");
    const workEmail = field(formData, "workEmail");
    const reason = field(formData, "reason");
    const approvalCode = field(formData, "approvalCode");

    const tier = await resolveNodeTier(sql, jurisdictionId);

    let approverId: string | null = null;
    if (requiresTwoPerson(tier)) {
      if (!approvalCode) {
        return {
          status: "approval_required",
          tier,
          message: `This provision affects a ${tier} tier — the broadest access. It needs a second administrator to approve before it takes effect.`,
          fields: { officerId, jurisdictionId, fullName, workEmail, reason },
        };
      }
      // Verified BEFORE the write, and bound to this exact (officer, node) pair.
      const payload = verifyApprovalCode(approvalCode, {
        targetOfficerId: officerId,
        targetJurisdictionId: jurisdictionId,
        proposerId: admin.adminId,
      });
      approverId = payload.approverId;
    }

    const result = await provisionOfficer(sql, {
      officerId,
      jurisdictionId,
      actorId: admin.adminId,
      approverId,
      fullName: fullName || null,
      workEmail: workEmail || null,
      reason,
    });

    revalidatePath("/admin/officers");
    return {
      status: "success",
      message: `${result.action === "PROVISION" ? "Provisioned" : result.action === "REACTIVATE" ? "Re-provisioned" : "Updated"} ${result.officerId} as ${result.officerRole} at ${result.tier} tier. Logged as ${result.provisioningId}.`,
    };
  } catch (err) {
    return { status: "error", message: toMessage(err) };
  }
}

/**
 * WITHDRAW (Lucy G8.c). `is_active = false`, never a delete — the audit history of every access that
 * officer made has to keep resolving to a name.
 *
 * Two-person applies to REGION/NATIONAL withdrawals too (Lucy R11 — see the note on
 * `deactivateOfficer`), so the same approval code mechanism is used.
 */
export async function deactivateOfficerAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    const admin = await requireAdminSession();
    const sql = getProvisionerClient();

    const officerId = field(formData, "officerId");
    const jurisdictionId = field(formData, "jurisdictionId");
    const reason = field(formData, "reason");
    const approvalCode = field(formData, "approvalCode");

    const tier = await resolveNodeTier(sql, jurisdictionId);
    let approverId: string | null = null;
    if (requiresTwoPerson(tier)) {
      if (!approvalCode) {
        return {
          status: "approval_required",
          tier,
          message: `Withdrawing a ${tier}-tier officer needs a second administrator to approve it, symmetrically with granting one.`,
          fields: { officerId, jurisdictionId, fullName: "", workEmail: "", reason },
        };
      }
      const payload = verifyApprovalCode(approvalCode, {
        targetOfficerId: officerId,
        targetJurisdictionId: jurisdictionId,
        proposerId: admin.adminId,
      });
      approverId = payload.approverId;
    }

    const result = await deactivateOfficer(sql, {
      officerId,
      actorId: admin.adminId,
      approverId,
      reason,
    });

    revalidatePath("/admin/officers");
    return {
      status: "success",
      message: `Access withdrawn for ${officerId}. Their audit history is preserved and is never deleted. Logged as ${result.provisioningId}.`,
    };
  } catch (err) {
    return { status: "error", message: toMessage(err) };
  }
}

/**
 * MINT AN APPROVAL CODE (Lucy G8.d, the synchronous half).
 *
 * Called by the APPROVER from their own authenticated admin session, for one specific (officer,
 * node) pair. They hand the code to the proposer, who pastes it into the provision form. The code is
 * signed, short-lived and bound to that pair, and verification refuses it if the approver and the
 * proposer are the same person.
 *
 * ⚠ WHAT THIS IS NOT: the asynchronous "Awaiting approval" QUEUE Lucy's G8.d describes. A pending
 * proposal cannot be persisted — Wells's schema has no proposal table, and neither of the two tables
 * that exist can hold one without overloading a meaning (see the long note at the top of
 * lib/provisioning/approval.ts). Two distinct administrators are genuinely required; what is missing
 * is the ability to leave a proposal waiting for one. Reported, not papered over.
 */
export async function mintApprovalCodeAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    const admin = await requireAdminSession();
    const sql = getProvisionerClient();

    const officerId = field(formData, "officerId");
    const jurisdictionId = field(formData, "jurisdictionId");

    // Resolve the tier so a code cannot be minted for a SCHOOL node or a node that does not exist —
    // the approval would be meaningless, and the error belongs here rather than at the far end.
    const tier = await resolveNodeTier(sql, jurisdictionId);
    if (!requiresTwoPerson(tier)) {
      return {
        status: "error",
        message: `A ${tier}-tier grant is single-signature and needs no approval code.`,
      };
    }

    const code = mintApprovalCode({
      approverId: admin.adminId,
      targetOfficerId: officerId,
      targetJurisdictionId: jurisdictionId,
    });
    return { status: "code", code, expiresInMinutes: 15 };
  } catch (err) {
    return { status: "error", message: toMessage(err) };
  }
}
