import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import {
  deactivateOfficer,
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
async function consoleAs(adminId: string, extraMocks?: () => void) {
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
  // Registered before the import, so a caller can bend ONE collaborator (see the TOCTOU block,
  // which freezes the pre-lock read to simulate the race window and mocks nothing else).
  extraMocks?.();
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
    expect(await resolveOfficerNode(sql, uid)).toEqual({
      jurisdictionId: JUR.region,
      tier: "REGION",
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

// ─── The TOCTOU residual: the LOCK decides, not the read before it ──────────────────────────────

/**
 * S2b made the officer's ACTUAL node the only input to a withdrawal, but that node was read before
 * `deactivateOfficer()` took its `for update` — so a re-provisioning landing in between left the
 * approval validated against one node and the withdrawal performed at another. Attribution survived
 * (the S1 coupling guard forces the audit row to name the node actually acted on), but the approval
 * did not: a second administrator would have signed for a node nobody withdrew.
 *
 * `expectedJurisdictionId` makes the locked row re-check the node the approval was taken against, so
 * the pre-lock read can only ever cause a REFUSAL. The first four tests pin the guard itself (and
 * that it stays optional for the CLI loader); the last one drives the race through the console by
 * freezing the pre-lock read — the only thing mocked is WHEN that read happened, which is precisely
 * the window.
 */
describe("the withdrawal lock re-validates the approved node (TOCTOU residual)", () => {
  it("REFUSES when the approved node is not the node the lock holds — nothing written", async () => {
    const uid = newUid();
    await provisionOfficer(sql, {
      officerId: uid,
      jurisdictionId: JUR.region,
      actorId: PROPOSER,
      approverId: APPROVER,
      reason: "regional director",
    });

    await expect(
      deactivateOfficer(sql, {
        officerId: uid,
        actorId: PROPOSER,
        approverId: APPROVER,
        reason: "approved against a node this officer does not hold",
        expectedJurisdictionId: JUR.national,
      }),
    ).rejects.toThrow(/node changed between the approval and the withdrawal/);

    // The transaction rolled back: the officer is untouched and the log gained nothing.
    expect(await isActive(uid)).toBe(true);
    expect(await withdrawalRow(uid)).toBeUndefined();
  });

  it("…and refuses BEFORE the two-person rule, so a move to DISTRICT cannot slip through alone", async () => {
    // The ordering that matters: a REGION → DISTRICT re-provisioning in the window would make the
    // withdrawal single-signature, so a two-person check running first would find nothing wrong.
    const uid = newUid();
    await provisionOfficer(sql, {
      officerId: uid,
      jurisdictionId: JUR.district,
      actorId: PROPOSER,
      reason: "district officer — the node the officer now holds",
    });

    await expect(
      deactivateOfficer(sql, {
        officerId: uid,
        actorId: PROPOSER,
        // No approver: a DISTRICT withdrawal needs none, which is exactly why the node check has to
        // be the thing that refuses.
        reason: "approved as a region, held as a district",
        expectedJurisdictionId: JUR.region,
      }),
    ).rejects.toThrow(/node changed between the approval and the withdrawal/);

    expect(await isActive(uid)).toBe(true);
    expect(await withdrawalRow(uid)).toBeUndefined();
  });

  it("commits normally when the approved node IS the locked node", async () => {
    const uid = newUid();
    await provisionOfficer(sql, {
      officerId: uid,
      jurisdictionId: JUR.region,
      actorId: PROPOSER,
      approverId: APPROVER,
      reason: "regional director",
    });

    const result = await deactivateOfficer(sql, {
      officerId: uid,
      actorId: PROPOSER,
      approverId: APPROVER,
      reason: "post abolished — approval and lock agree",
      expectedJurisdictionId: JUR.region,
    });

    expect(result.tier).toBe("REGION");
    expect(await isActive(uid)).toBe(false);
    expect(await withdrawalRow(uid)).toMatchObject({
      targetJurisdictionId: JUR.region,
      targetTier: "REGION",
      approverId: APPROVER,
    });
  });

  it("is OPTIONAL: a caller that supplies no expectation is unaffected (the CLI loader)", async () => {
    // `scripts/load-officers.ts` reads nothing before withdrawing, so it has no earlier read for the
    // lock to contradict. Omitting the field must stay a full withdrawal, not a refusal.
    const uid = newUid();
    await provisionOfficer(sql, {
      officerId: uid,
      jurisdictionId: JUR.district,
      actorId: PROPOSER,
      reason: "district officer",
    });

    await deactivateOfficer(sql, {
      officerId: uid,
      actorId: PROPOSER,
      reason: "CSV offboarding, no console approval involved",
    });

    expect(await isActive(uid)).toBe(false);
    expect(await withdrawalRow(uid)).toMatchObject({
      targetJurisdictionId: JUR.district,
    });
  });

  it("the CONSOLE passes the node it proved, so a re-provisioning in the window is refused", async () => {
    const uid = newUid();
    await provisionOfficer(sql, {
      officerId: uid,
      jurisdictionId: JUR.region,
      actorId: PROPOSER,
      approverId: APPROVER,
      reason: "regional director",
    });
    // The approver signs a withdrawal at the officer's node AS IT STOOD when the proposer asked.
    const code = await mintedCode("DEACTIVATE", uid, JUR.region);

    // THE RACE: the officer is re-provisioned to the national node after the console's pre-lock read
    // and before its transaction. The stub below freezes that read at the pre-move value, which is
    // what a real interleaving produces; everything after it is the real code against the real row.
    await provisionOfficer(sql, {
      officerId: uid,
      jurisdictionId: JUR.national,
      actorId: APPROVER,
      approverId: PROPOSER,
      reason: "promoted to the national desk, concurrently",
    });

    try {
      const proposerConsole = await consoleAs(PROPOSER, () => {
        vi.doMock("@/lib/provisioning/officers", async (importOriginal) => {
          const real =
            await importOriginal<typeof import("@/lib/provisioning/officers")>();
          return {
            ...real,
            resolveOfficerNode: async () => ({
              jurisdictionId: JUR.region,
              tier: "REGION" as const,
            }),
          };
        });
      });
      const state = await proposerConsole.deactivateOfficerAction(
        { status: "idle" },
        form({ officerId: uid, reason: "post abolished", approvalCode: code }),
      );

      // The approval check passes (the stale read and the code agree on the region) and the LOCK is
      // what refuses — which is the whole point of the change.
      expect(state.status).toBe("error");
      expect(state.status === "error" && state.message).toMatch(
        /node changed between the approval and the withdrawal/,
      );
      expect(await isActive(uid)).toBe(true);
      expect(await withdrawalRow(uid)).toBeUndefined();
    } finally {
      // The stub is file-scoped once registered; every other test here needs the real resolver.
      vi.doUnmock("@/lib/provisioning/officers");
      vi.resetModules();
    }
  });
});
