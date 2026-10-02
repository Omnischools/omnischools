import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import {
  listOfficers,
  listProvisioningAudit,
  provisionOfficer,
  resolveOfficerNode,
} from "@/lib/provisioning/officers";
import { JUR } from "./fixtures/ids";
import { testDbConfig } from "./helpers";

/**
 * WHAT AN APPROVAL CODE ACTUALLY AUTHORISES — the two console findings (S2a, S2b).
 *
 * tests/provisioning-approval.test.ts proves the code's own binding in isolation. These tests run
 * the SERVER ACTIONS against the real provisioner connection, because both findings were about the
 * seam between the code and the action rather than about the HMAC:
 *
 *  · S2a — the signed payload did not name the action, and both actions verified the same payload
 *    shape. A code minted to approve a grant therefore also satisfied a withdrawal of the same
 *    officer at the same node, and the reverse.
 *  · S2b — the withdrawal took its node from the SUBMITTED form field to decide whether the
 *    two-person rule applied and to check what the approver signed for, while `deactivateOfficer()`
 *    re-derives the node from the officer's real directory row. The approver could therefore be
 *    signing for a node that had nothing to do with the withdrawal performed.
 *
 * The admin SESSION is mocked (there is no Supabase in the suite) and nothing else is: the SQL is
 * the provisioner role, the writes are real, and the assertions read the append-only log.
 */

const SECRET = "a-test-approval-secret-at-least-32-chars-long";
/** Two Omnischools administrators. The console takes these from the session, never from a form. */
const PROPOSER = "90000000-0000-4000-8000-00000000000d";
const APPROVER = "90000000-0000-4000-8000-00000000000e";

const sql = postgres(testDbConfig.provisionerAnalyticsUrl, { max: 2, prepare: false });

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

let counter = 0;
function newUid(): string {
  counter += 1;
  return `6fffffff-0000-4000-8000-0000000d${String(counter).padStart(4, "0")}`;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/**
 * The console's server actions, running as `adminId`.
 *
 * Only two things are mocked: the admin session (Supabase is not in the suite) and
 * `revalidatePath` (no Next request context). `getProvisionerClient` is pointed at the same
 * provisioner connection the CLI loader uses, so every refusal below is a real refusal.
 */
async function consoleAs(adminId: string) {
  vi.resetModules();
  vi.stubEnv("PROVISIONING_APPROVAL_SECRET", SECRET);
  vi.doMock("next/cache", () => ({ revalidatePath: () => {} }));
  vi.doMock("@/lib/provisioning/admin-auth", () => ({
    requireAdminSession: async () => ({ adminId, displayName: "Test administrator" }),
    AdminAccessDeniedError: class AdminAccessDeniedError extends Error {},
  }));
  vi.doMock("@/lib/provisioning/db", () => ({
    getProvisionerClient: () => sql,
    ProvisionerUnavailableError: class ProvisionerUnavailableError extends Error {},
  }));
  return import("@/app/(admin)/admin/officers/actions");
}

/** A code the APPROVER mints from their own session, for one action and one (officer, node). */
async function mintedCode(
  action: "PROVISION" | "DEACTIVATE",
  officerId: string,
  jurisdictionId: string,
): Promise<string> {
  const approverConsole = await consoleAs(APPROVER);
  const state = await approverConsole.mintApprovalCodeAction(
    { status: "idle" },
    form({ action, officerId, jurisdictionId }),
  );
  if (state.status !== "code") {
    throw new Error(`expected a code, got ${state.status}: ${JSON.stringify(state)}`);
  }
  expect(state.action).toBe(action);
  return state.code;
}

async function isActive(officerId: string): Promise<boolean | undefined> {
  return (await listOfficers(sql)).find((o) => o.officerId === officerId)?.isActive;
}

async function withdrawalRow(officerId: string) {
  return (await listProvisioningAudit(sql, 500)).find(
    (r) => r.targetOfficerId === officerId && r.action === "DEACTIVATE",
  );
}

// ─── S2b: the officer's ACTUAL node decides ─────────────────────────────────────────────────────

describe("a withdrawal is bound to the officer's ACTUAL node, never the submitted one (S2b)", () => {
  it("resolveOfficerNode reads the node and tier off the directory row", async () => {
    const uid = newUid();
    await provisionOfficer(sql, {
      officerId: uid,
      jurisdictionId: JUR.region,
      actorId: PROPOSER,
      approverId: APPROVER,
      reason: "regional director — the node under test",
    });
    // Derived server-side through ov_officer_node_tier(), with no GUC set and no form involved.
    expect(await resolveOfficerNode(sql, uid)).toMatchObject({
      jurisdictionId: JUR.region,
      tier: "REGION",
      officerRole: "REGIONAL_OVERSIGHT",
      isActive: true,
    });
  });

  it("validates the approval code against the ACTUAL node even when the form says another", async () => {
    const uid = newUid();
    await provisionOfficer(sql, {
      officerId: uid,
      jurisdictionId: JUR.region,
      actorId: PROPOSER,
      approverId: APPROVER,
      reason: "regional director",
    });
    // The approver signs a withdrawal at the officer's real node — the only node they could
    // sensibly be shown.
    const code = await mintedCode("DEACTIVATE", uid, JUR.region);

    const proposerConsole = await consoleAs(PROPOSER);
    const state = await proposerConsole.deactivateOfficerAction(
      { status: "idle" },
      form({
        officerId: uid,
        // The lie. Pre-fix this drove both the two-person decision and the code's node check.
        jurisdictionId: JUR.national,
        reason: "post abolished",
        approvalCode: code,
      }),
    );

    expect(state).toMatchObject({ status: "success" });
    expect(await isActive(uid)).toBe(false);
    // And the record names the node that was actually withdrawn — which is the approver's node.
    expect(await withdrawalRow(uid)).toMatchObject({
      targetJurisdictionId: JUR.region,
      targetTier: "REGION",
      actorId: PROPOSER,
      approverId: APPROVER,
    });
  });

  it("REFUSES a code minted for the submitted node — the finding itself", async () => {
    const uid = newUid();
    await provisionOfficer(sql, {
      officerId: uid,
      jurisdictionId: JUR.region,
      actorId: PROPOSER,
      approverId: APPROVER,
      reason: "regional director",
    });
    // The attack: get an approval for a DIFFERENT node, then submit that node. Before the fix the
    // signature was checked against the submitted node and the withdrawal performed against the
    // officer's real one — an approver who approved "at the national node" causing a regional
    // withdrawal.
    const code = await mintedCode("DEACTIVATE", uid, JUR.national);

    const proposerConsole = await consoleAs(PROPOSER);
    const state = await proposerConsole.deactivateOfficerAction(
      { status: "idle" },
      form({
        officerId: uid,
        jurisdictionId: JUR.national,
        reason: "approved somewhere else",
        approvalCode: code,
      }),
    );

    expect(state.status).toBe("error");
    expect(state.status === "error" && state.message).toMatch(/DIFFERENT jurisdiction/);
    expect(await isActive(uid)).toBe(true);
    expect(await withdrawalRow(uid)).toBeUndefined();
  });

  it("the two-person decision comes from the actual tier, so a DISTRICT claim cannot dodge it", async () => {
    const uid = newUid();
    await provisionOfficer(sql, {
      officerId: uid,
      jurisdictionId: JUR.national,
      actorId: PROPOSER,
      approverId: APPROVER,
      reason: "national oversight desk",
    });

    const proposerConsole = await consoleAs(PROPOSER);
    const state = await proposerConsole.deactivateOfficerAction(
      { status: "idle" },
      form({
        officerId: uid,
        // "It's only a district officer." The submitted field decides nothing.
        jurisdictionId: JUR.district,
        reason: "no approval code supplied",
      }),
    );

    expect(state).toMatchObject({ status: "approval_required", tier: "NATIONAL" });
    expect(await isActive(uid)).toBe(true);
  });

  it("refuses a uid with no directory row before any approval is considered", async () => {
    const proposerConsole = await consoleAs(PROPOSER);
    const state = await proposerConsole.deactivateOfficerAction(
      { status: "idle" },
      form({ officerId: newUid(), jurisdictionId: JUR.region, reason: "nobody" }),
    );
    expect(state.status).toBe("error");
    expect(state.status === "error" && state.message).toMatch(/No directory row/);
  });
});

// ─── S2a: one signature, one action ─────────────────────────────────────────────────────────────

describe("a code approves ONE action, and the console names which (S2a)", () => {
  it("a PROVISION code is REFUSED by the withdrawal path", async () => {
    const uid = newUid();
    await provisionOfficer(sql, {
      officerId: uid,
      jurisdictionId: JUR.region,
      actorId: PROPOSER,
      approverId: APPROVER,
      reason: "regional director",
    });
    const code = await mintedCode("PROVISION", uid, JUR.region);

    const proposerConsole = await consoleAs(PROPOSER);
    const state = await proposerConsole.deactivateOfficerAction(
      { status: "idle" },
      form({
        officerId: uid,
        jurisdictionId: JUR.region,
        reason: "reusing an approval for the opposite decision",
        approvalCode: code,
      }),
    );

    expect(state.status).toBe("error");
    expect(state.status === "error" && state.message).toMatch(
      /approves a PROVISION .*not a DEACTIVATE/,
    );
    expect(await isActive(uid)).toBe(true);
    expect(await withdrawalRow(uid)).toBeUndefined();
  });

  it("a DEACTIVATE code is REFUSED by the provision path", async () => {
    const uid = newUid();
    const code = await mintedCode("DEACTIVATE", uid, JUR.region);

    const proposerConsole = await consoleAs(PROPOSER);
    const state = await proposerConsole.provisionOfficerAction(
      { status: "idle" },
      form({
        officerId: uid,
        jurisdictionId: JUR.region,
        reason: "a withdrawal approval used to grant a region",
        approvalCode: code,
      }),
    );

    expect(state.status).toBe("error");
    expect(state.status === "error" && state.message).toMatch(
      /approves a DEACTIVATE .*not a PROVISION/,
    );
    // Nothing was written: no directory row, no audit row.
    expect(await isActive(uid)).toBeUndefined();
    expect(
      (await listProvisioningAudit(sql, 500)).some((r) => r.targetOfficerId === uid),
    ).toBe(false);
  });

  it("…and the matching code still provisions, naming both administrators", async () => {
    const uid = newUid();
    const code = await mintedCode("PROVISION", uid, JUR.region);

    const proposerConsole = await consoleAs(PROPOSER);
    const state = await proposerConsole.provisionOfficerAction(
      { status: "idle" },
      form({
        officerId: uid,
        jurisdictionId: JUR.region,
        reason: "GES posting letter — approved by a second administrator",
        approvalCode: code,
      }),
    );

    expect(state).toMatchObject({ status: "success" });
    expect(await isActive(uid)).toBe(true);
    expect(
      (await listProvisioningAudit(sql, 500)).find((r) => r.targetOfficerId === uid),
    ).toMatchObject({ actorId: PROPOSER, approverId: APPROVER, targetTier: "REGION" });
  });

  it("MINTING with no action, or an unrecognised one, mints NOTHING", async () => {
    const approverConsole = await consoleAs(APPROVER);
    for (const action of [
      "",
      "provision",
      "deactivate",
      "BOTH",
      "PROVISION,DEACTIVATE",
    ]) {
      const state = await approverConsole.mintApprovalCodeAction(
        { status: "idle" },
        form({ action, officerId: newUid(), jurisdictionId: JUR.region }),
      );
      expect(state.status).toBe("error");
      expect(state.status === "error" && state.message).toMatch(
        /PROVISION or DEACTIVATE/,
      );
    }
    // The field absent altogether is the same refusal — there is no default action.
    const missing = await approverConsole.mintApprovalCodeAction(
      { status: "idle" },
      form({ officerId: newUid(), jurisdictionId: JUR.region }),
    );
    expect(missing.status).toBe("error");
    expect(missing.status === "error" && missing.message).toMatch(
      /PROVISION or DEACTIVATE/,
    );
  });

  it("a code minted by the proposer is still refused, for either action", async () => {
    // The two-person rule itself, re-checked through the console now that the action is signed:
    // naming an action does not let one administrator stand in for two.
    const uid = newUid();
    await provisionOfficer(sql, {
      officerId: uid,
      jurisdictionId: JUR.region,
      actorId: PROPOSER,
      approverId: APPROVER,
      reason: "regional director",
    });
    const selfApproved = await (async () => {
      const own = await consoleAs(PROPOSER);
      const state = await own.mintApprovalCodeAction(
        { status: "idle" },
        form({ action: "DEACTIVATE", officerId: uid, jurisdictionId: JUR.region }),
      );
      if (state.status !== "code") throw new Error("expected a code");
      return state.code;
    })();

    const proposerConsole = await consoleAs(PROPOSER);
    const state = await proposerConsole.deactivateOfficerAction(
      { status: "idle" },
      form({
        officerId: uid,
        jurisdictionId: JUR.region,
        reason: "self-approved withdrawal",
        approvalCode: selfApproved,
      }),
    );
    expect(state.status).toBe("error");
    expect(state.status === "error" && state.message).toMatch(
      /cannot approve your own proposal/,
    );
    expect(await isActive(uid)).toBe(true);
  });
});
