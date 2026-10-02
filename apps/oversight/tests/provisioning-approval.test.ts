import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * THE TWO-PERSON APPROVAL CODE (Kofi R7 · Lucy G8.d).
 *
 * The code is the mechanism that makes "a second administrator approved this" a verifiable fact
 * rather than a checkbox. So every way it could fail to mean that is a test: wrong signature, wrong
 * officer, wrong node, expired, and — the one that matters most — approved by the proposer.
 *
 * The secret is stubbed per test because `lib/env.ts` parses `process.env` at import; each case
 * re-imports the module so the signing key is the one the test intends.
 */

const SECRET = "a-test-approval-secret-at-least-32-chars-long";
const APPROVER = "90000000-0000-4000-8000-000000000002";
const PROPOSER = "90000000-0000-4000-8000-000000000001";
const OFFICER = "60000000-0000-4000-8000-000000000004";
const NODE = "10000000-0000-4000-8000-000000000002";

/** `null` means "no secret configured". NOT `undefined` — that hits the default parameter. */
async function approvalModule(secret: string | null = SECRET) {
  vi.resetModules();
  vi.stubEnv("PROVISIONING_APPROVAL_SECRET", secret ?? "");
  return import("@/lib/provisioning/approval");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("a valid code authorises exactly one grant", () => {
  it("verifies for the pair it was minted for", async () => {
    const { mintApprovalCode, verifyApprovalCode } = await approvalModule();
    const code = mintApprovalCode({
      approverId: APPROVER,
      targetOfficerId: OFFICER,
      targetJurisdictionId: NODE,
    });
    const payload = verifyApprovalCode(code, {
      targetOfficerId: OFFICER,
      targetJurisdictionId: NODE,
      proposerId: PROPOSER,
    });
    expect(payload.approverId).toBe(APPROVER);
  });

  it("is REFUSED for a different officer", async () => {
    const { mintApprovalCode, verifyApprovalCode } = await approvalModule();
    const code = mintApprovalCode({
      approverId: APPROVER,
      targetOfficerId: OFFICER,
      targetJurisdictionId: NODE,
    });
    expect(() =>
      verifyApprovalCode(code, {
        targetOfficerId: "60000000-0000-4000-8000-000000000003",
        targetJurisdictionId: NODE,
        proposerId: PROPOSER,
      }),
    ).toThrowError(/DIFFERENT officer/);
  });

  it("is REFUSED for a different jurisdiction", async () => {
    const { mintApprovalCode, verifyApprovalCode } = await approvalModule();
    const code = mintApprovalCode({
      approverId: APPROVER,
      targetOfficerId: OFFICER,
      targetJurisdictionId: NODE,
    });
    expect(() =>
      verifyApprovalCode(code, {
        targetOfficerId: OFFICER,
        targetJurisdictionId: "10000000-0000-4000-8000-000000000001",
        proposerId: PROPOSER,
      }),
    ).toThrowError(/DIFFERENT jurisdiction/);
  });
});

describe("the rule it exists to enforce: two PEOPLE", () => {
  it("REFUSES a code whose approver is the proposer", async () => {
    // The whole point. An approver who is the actor is a rubber stamp with extra steps, and the
    // database's `ck_officer_provisioning_distinct_approver` would also refuse the row — this check
    // is what produces a message an administrator can act on instead of a constraint violation.
    const { mintApprovalCode, verifyApprovalCode } = await approvalModule();
    const code = mintApprovalCode({
      approverId: PROPOSER,
      targetOfficerId: OFFICER,
      targetJurisdictionId: NODE,
    });
    expect(() =>
      verifyApprovalCode(code, {
        targetOfficerId: OFFICER,
        targetJurisdictionId: NODE,
        proposerId: PROPOSER,
      }),
    ).toThrowError(/cannot approve your own proposal/);
  });
});

describe("the code is not forgeable and not durable", () => {
  it("REFUSES a tampered payload (the signature covers every field)", async () => {
    const { mintApprovalCode, verifyApprovalCode } = await approvalModule();
    const code = mintApprovalCode({
      approverId: APPROVER,
      targetOfficerId: OFFICER,
      targetJurisdictionId: NODE,
    });
    const [body, sig] = code.split(".");
    // Re-point the code at the national node, keeping the original signature.
    const decoded = Buffer.from(body!, "base64url").toString("utf8");
    const swapped = decoded.replace(NODE, "10000000-0000-4000-8000-000000000001");
    const forged = `${Buffer.from(swapped, "utf8").toString("base64url")}.${sig}`;

    expect(() =>
      verifyApprovalCode(forged, {
        targetOfficerId: OFFICER,
        targetJurisdictionId: "10000000-0000-4000-8000-000000000001",
        proposerId: PROPOSER,
      }),
    ).toThrowError(/failed verification/);
  });

  it("REFUSES a code signed with a different secret", async () => {
    const other = await approvalModule("a-DIFFERENT-secret-also-at-least-32-characters");
    const code = other.mintApprovalCode({
      approverId: APPROVER,
      targetOfficerId: OFFICER,
      targetJurisdictionId: NODE,
    });

    const ours = await approvalModule(SECRET);
    expect(() =>
      ours.verifyApprovalCode(code, {
        targetOfficerId: OFFICER,
        targetJurisdictionId: NODE,
        proposerId: PROPOSER,
      }),
    ).toThrowError(/failed verification/);
  });

  it("EXPIRES — an approval is a decision taken now, not a standing permission", async () => {
    const { mintApprovalCode, verifyApprovalCode, APPROVAL_CODE_TTL_MS } =
      await approvalModule();
    const mintedAt = 1_800_000_000_000;
    const code = mintApprovalCode(
      { approverId: APPROVER, targetOfficerId: OFFICER, targetJurisdictionId: NODE },
      mintedAt,
    );
    // One millisecond inside the window: fine.
    expect(() =>
      verifyApprovalCode(
        code,
        { targetOfficerId: OFFICER, targetJurisdictionId: NODE, proposerId: PROPOSER },
        mintedAt + APPROVAL_CODE_TTL_MS - 1,
      ),
    ).not.toThrow();
    // One millisecond past it: refused.
    expect(() =>
      verifyApprovalCode(
        code,
        { targetOfficerId: OFFICER, targetJurisdictionId: NODE, proposerId: PROPOSER },
        mintedAt + APPROVAL_CODE_TTL_MS + 1,
      ),
    ).toThrowError(/expired/);
  });

  it("REFUSES malformed input rather than throwing something unhelpful", async () => {
    const { verifyApprovalCode } = await approvalModule();
    for (const bad of ["", "no-dot", "a.b.c", "....", "x."]) {
      expect(() =>
        verifyApprovalCode(bad, {
          targetOfficerId: OFFICER,
          targetJurisdictionId: NODE,
          proposerId: PROPOSER,
        }),
      ).toThrowError(/approval code/);
    }
  });
});

describe("with no secret configured, nothing can be approved", () => {
  it("minting and verifying both refuse — fail closed", async () => {
    const { mintApprovalCode, verifyApprovalCode } = await approvalModule(null);
    expect(() =>
      mintApprovalCode({
        approverId: APPROVER,
        targetOfficerId: OFFICER,
        targetJurisdictionId: NODE,
      }),
    ).toThrowError(/PROVISIONING_APPROVAL_SECRET/);
    expect(() =>
      verifyApprovalCode("a.b", {
        targetOfficerId: OFFICER,
        targetJurisdictionId: NODE,
        proposerId: PROPOSER,
      }),
    ).toThrowError(/PROVISIONING_APPROVAL_SECRET/);
  });

  it("…and a SHORT secret is treated as no secret", async () => {
    const { mintApprovalCode } = await approvalModule("too-short");
    expect(() =>
      mintApprovalCode({
        approverId: APPROVER,
        targetOfficerId: OFFICER,
        targetJurisdictionId: NODE,
      }),
    ).toThrowError(/32 characters/);
  });
});
