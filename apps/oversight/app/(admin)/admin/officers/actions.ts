"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession, AdminAccessDeniedError } from "@/lib/provisioning/admin-auth";
import { getProvisionerClient, ProvisionerUnavailableError } from "@/lib/provisioning/db";
import {
  ApprovalCodeError,
  mintApprovalCode,
  requireApprovalAction,
  verifyApprovalCode,
  type ApprovalAction,
} from "@/lib/provisioning/approval";
import {
  ProvisioningError,
  deactivateOfficer,
  provisionOfficer,
  requiresTwoPerson,
  resolveNodeTier,
  resolveOfficerNode,
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
      /**
       * Echoed so the form can be resubmitted with a code rather than retyped. On the WITHDRAWAL
       * path `jurisdictionId` is not what was submitted — the form posts no node at all — but the
       * node the server proved off the directory row, which `DeactivateForm` shows so the proposer
       * asks the approver to mint for that node and not for one read off the table.
       */
      fields: { officerId: string; jurisdictionId: string; fullName: string; workEmail: string; reason: string };
    }
  | {
      status: "code";
      code: string;
      /** Echoed so the approver's confirmation names the action they just signed for. */
      action: ApprovalAction;
      expiresInMinutes: number;
    };

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
 *
 * HERE the submitted `jurisdictionId` legitimately drives the decision, and that is not an
 * inconsistency with the withdrawal path below: on this path the node IS the grant being created, so
 * the node the approver signed for is the node that gets written, and `ov_officer_node_tier()`
 * refuses on the write any row whose recorded tier disagrees with it. On the withdrawal path the
 * node already exists on the officer's row, and the form is therefore a claim about it rather than
 * the thing itself — see `deactivateOfficerAction`.
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
      // Verified BEFORE the write, and bound to this exact (action, officer, node) triple. The
      // action is named here and not taken from the code: a code minted to approve a WITHDRAWAL
      // must not authorise a grant (S2a).
      const payload = verifyApprovalCode(approvalCode, {
        action: "PROVISION",
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
 *
 * ⚠ THE OFFICER'S ACTUAL NODE DECIDES, NEVER THE SUBMITTED ONE (security finding S2b). The form
 * posts a `jurisdictionId` for the row the administrator clicked, and it is DELIBERATELY NOT READ
 * here. It used to be, for both the two-person decision and the approval code's node — while
 * `deactivateOfficer()` re-derives the node from the officer's real directory row. The two could
 * disagree, so a proposer could have an approval validated against a node they chose and a
 * withdrawal performed against the node the officer actually holds: a national withdrawal approved
 * as a district one. `resolveOfficerNode()` is read FIRST and is the only thing that decides.
 *
 * ⚠ AND THAT READ IS RE-VALIDATED UNDER THE LOCK (Dex's TOCTOU residual). It happens before
 * `deactivateOfficer()` takes its `for update`, so a concurrent re-provisioning could move the
 * officer in between — the approval would have been checked against a node the withdrawal no longer
 * acts on. The node proved here is therefore passed down as `expectedJurisdictionId` and compared to
 * the locked row, which makes this read a convenience for the approval check and the lock the single
 * decision point. A race now ends in a refusal with nothing written, not in a mis-attributed grant.
 */
export async function deactivateOfficerAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    const admin = await requireAdminSession();
    const sql = getProvisionerClient();

    const officerId = field(formData, "officerId");
    const reason = field(formData, "reason");
    const approvalCode = field(formData, "approvalCode");

    // The officer's OWN node and tier, derived server-side. Nothing below reads the form's
    // `jurisdictionId`: on this path it is a claim about state that already exists, and the state
    // itself is available.
    const actual = await resolveOfficerNode(sql, officerId);
    const tier = actual.tier;
    let approverId: string | null = null;
    if (requiresTwoPerson(tier)) {
      if (!approvalCode) {
        return {
          status: "approval_required",
          tier,
          message: `Withdrawing a ${tier}-tier officer needs a second administrator to approve it, symmetrically with granting one.`,
          fields: {
            officerId,
            jurisdictionId: actual.jurisdictionId,
            fullName: "",
            workEmail: "",
            reason,
          },
        };
      }
      const payload = verifyApprovalCode(approvalCode, {
        action: "DEACTIVATE",
        targetOfficerId: officerId,
        targetJurisdictionId: actual.jurisdictionId,
        proposerId: admin.adminId,
      });
      approverId = payload.approverId;
    }

    const result = await deactivateOfficer(sql, {
      officerId,
      actorId: admin.adminId,
      approverId,
      reason,
      // The node this action proved and verified the approval code against. If the locked row
      // disagrees, the write is refused rather than performed at whichever node it moved to.
      expectedJurisdictionId: actual.jurisdictionId,
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
 * Called by the APPROVER from their own authenticated admin session, for one specific ACTION against
 * one specific (officer, node) pair. They hand the code to the proposer, who pastes it into the
 * provision or withdrawal form. The code is signed, short-lived and bound to that action and that
 * pair, and verification refuses it if the approver and the proposer are the same person.
 *
 * The APPROVER names the action — there is no inferring it from the node or defaulting it (S2a). An
 * approval that did not say whether it approves giving someone a region or taking it away would
 * approve both, which is the finding this closes.
 *
 * Note that for a DEACTIVATE the node must be the officer's CURRENT node, because that is what the
 * withdrawal path verifies against (S2b). A code minted against any other node is refused at the
 * proposer's end with "issued for a DIFFERENT jurisdiction" — a wasted code, never a wrong
 * withdrawal.
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
    // Fails closed: a missing or unrecognised verb mints nothing at all.
    const action = requireApprovalAction(
      field(formData, "action"),
      "The action you are approving",
    );

    // Resolve the tier so a code cannot be minted for a SCHOOL node or a node that does not exist —
    // the approval would be meaningless, and the error belongs here rather than at the far end.
    const tier = await resolveNodeTier(sql, jurisdictionId);
    if (!requiresTwoPerson(tier)) {
      return {
        status: "error",
        message: `A ${tier}-tier ${action === "PROVISION" ? "grant" : "withdrawal"} is single-signature and needs no approval code.`,
      };
    }

    const code = mintApprovalCode({
      action,
      approverId: admin.adminId,
      targetOfficerId: officerId,
      targetJurisdictionId: jurisdictionId,
    });
    return { status: "code", code, action, expiresInMinutes: 15 };
  } catch (err) {
    return { status: "error", message: toMessage(err) };
  }
}
