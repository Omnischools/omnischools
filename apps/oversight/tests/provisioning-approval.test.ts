import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * THE TWO-PERSON APPROVAL CODE (Kofi R7 · Lucy G8.d).
 *
 * The code is the mechanism that makes "a second administrator approved THIS" a verifiable fact
 * rather than a checkbox. So every way it could fail to mean that is a test: wrong signature, wrong
 * ACTION, wrong officer, wrong node, expired, and — the one that matters most — approved by the
 * proposer.
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

describe("a valid code authorises exactly one (action, officer, node)", () => {
  it("verifies for the action and the pair it was minted for", async () => {
    const { mintApprovalCode, verifyApprovalCode } = await approvalModule();
    const code = mintApprovalCode({
      action: "PROVISION",
      approverId: APPROVER,
      targetOfficerId: OFFICER,
      targetJurisdictionId: NODE,
    });
    const payload = verifyApprovalCode(code, {
      action: "PROVISION",
      targetOfficerId: OFFICER,
      targetJurisdictionId: NODE,
      proposerId: PROPOSER,
    });
    expect(payload.approverId).toBe(APPROVER);
    expect(payload.action).toBe("PROVISION");
  });

  it("is REFUSED for a different officer", async () => {
    const { mintApprovalCode, verifyApprovalCode } = await approvalModule();
    const code = mintApprovalCode({
      action: "PROVISION",
      approverId: APPROVER,
      targetOfficerId: OFFICER,
      targetJurisdictionId: NODE,
    });
    expect(() =>
      verifyApprovalCode(code, {
        action: "PROVISION",
        targetOfficerId: "60000000-0000-4000-8000-000000000003",
        targetJurisdictionId: NODE,
        proposerId: PROPOSER,
      }),
    ).toThrowError(/DIFFERENT officer/);
  });

  it("is REFUSED for a different jurisdiction", async () => {
    const { mintApprovalCode, verifyApprovalCode } = await approvalModule();
    const code = mintApprovalCode({
      action: "PROVISION",
      approverId: APPROVER,
      targetOfficerId: OFFICER,
      targetJurisdictionId: NODE,
    });
    expect(() =>
      verifyApprovalCode(code, {
        action: "PROVISION",
        targetOfficerId: OFFICER,
        targetJurisdictionId: "10000000-0000-4000-8000-000000000001",
        proposerId: PROPOSER,
      }),
    ).toThrowError(/DIFFERENT jurisdiction/);
  });
});

describe("the code is bound to the ACTION it approves (S2a)", () => {
  /*
   * The finding: the payload signed (approver, officer, node, expiry) and nothing else, and BOTH
   * server actions verified against that same shape. So one approver's signature on a PROVISION also
   * satisfied a DEACTIVATE of the same officer at the same node, and the reverse — the two opposite
   * decisions were interchangeable. These are the tests that make them distinct.
   */

  it("a PROVISION code is REFUSED on the DEACTIVATE path", async () => {
    const { mintApprovalCode, verifyApprovalCode } = await approvalModule();
    const code = mintApprovalCode({
      action: "PROVISION",
      approverId: APPROVER,
      targetOfficerId: OFFICER,
      targetJurisdictionId: NODE,
    });
    expect(() =>
      verifyApprovalCode(code, {
        action: "DEACTIVATE",
        targetOfficerId: OFFICER,
        targetJurisdictionId: NODE,
        proposerId: PROPOSER,
      }),
    ).toThrowError(/approves a PROVISION .*not a DEACTIVATE/);
  });

  it("a DEACTIVATE code is REFUSED on the PROVISION path", async () => {
    const { mintApprovalCode, verifyApprovalCode } = await approvalModule();
    const code = mintApprovalCode({
      action: "DEACTIVATE",
      approverId: APPROVER,
      targetOfficerId: OFFICER,
      targetJurisdictionId: NODE,
    });
    expect(() =>
      verifyApprovalCode(code, {
        action: "PROVISION",
        targetOfficerId: OFFICER,
        targetJurisdictionId: NODE,
        proposerId: PROPOSER,
      }),
    ).toThrowError(/approves a DEACTIVATE .*not a PROVISION/);
    // …and it still works for the action it WAS minted for, so this is binding, not breakage.
    expect(
      verifyApprovalCode(code, {
        action: "DEACTIVATE",
        targetOfficerId: OFFICER,
        targetJurisdictionId: NODE,
        proposerId: PROPOSER,
      }).action,
    ).toBe("DEACTIVATE");
  });

  it("the action is COVERED BY THE SIGNATURE — swapping the verb forges nothing", async () => {
    const { mintApprovalCode, verifyApprovalCode } = await approvalModule();
    const code = mintApprovalCode({
      action: "PROVISION",
      approverId: APPROVER,
      targetOfficerId: OFFICER,
      targetJurisdictionId: NODE,
    });
    const [body, sig] = code.split(".");
    const decoded = Buffer.from(body!, "base64url").toString("utf8");
    expect(decoded.startsWith("PROVISION|")).toBe(true);
    const swapped = decoded.replace("PROVISION|", "DEACTIVATE|");
    const forged = `${Buffer.from(swapped, "utf8").toString("base64url")}.${sig}`;

    expect(() =>
      verifyApprovalCode(forged, {
        action: "DEACTIVATE",
        targetOfficerId: OFFICER,
        targetJurisdictionId: NODE,
        proposerId: PROPOSER,
      }),
    ).toThrowError(/failed verification/);
  });

  it("MINTING with a missing or unrecognised action FAILS CLOSED", async () => {
    const { mintApprovalCode } = await approvalModule();
    for (const bad of [
      "",
      "provision",
      "PROVISION ",
      "DEACTIVATE_ALL",
      "*",
      null,
      undefined,
    ]) {
      expect(() =>
        mintApprovalCode({
          // The console reads this field off a FormData, so the compiler is not the control here.
          action: bad as never,
          approverId: APPROVER,
          targetOfficerId: OFFICER,
          targetJurisdictionId: NODE,
        }),
      ).toThrowError(/PROVISION or DEACTIVATE/);
    }
  });

  it("VERIFYING against a missing or unrecognised action FAILS CLOSED", async () => {
    const { mintApprovalCode, verifyApprovalCode } = await approvalModule();
    const code = mintApprovalCode({
      action: "PROVISION",
      approverId: APPROVER,
      targetOfficerId: OFFICER,
      targetJurisdictionId: NODE,
    });
    for (const bad of ["", "provision", undefined]) {
      expect(() =>
        verifyApprovalCode(code, {
          action: bad as never,
          targetOfficerId: OFFICER,
          targetJurisdictionId: NODE,
          proposerId: PROPOSER,
        }),
      ).toThrowError(/PROVISION or DEACTIVATE/);
    }
  });

  it("a code from BEFORE the action was signed (four fields) is refused, not read short", async () => {
    // Forward-compatibility stated as a test: an old code's four fields are re-signed with the
    // current secret so the signature passes, and it must still be refused — an approval that did
    // not say which action it approved is not an approval of either.
    const { verifyApprovalCode } = await approvalModule();
    const { createHmac } = await import("node:crypto");
    const legacyBody = [APPROVER, OFFICER, NODE, String(Date.now() + 60_000)].join("|");
    const sig = createHmac("sha256", SECRET).update(legacyBody).digest("base64url");
    const legacy = `${Buffer.from(legacyBody, "utf8").toString("base64url")}.${sig}`;

    expect(() =>
      verifyApprovalCode(legacy, {
        action: "PROVISION",
        targetOfficerId: OFFICER,
        targetJurisdictionId: NODE,
        proposerId: PROPOSER,
      }),
    ).toThrowError(/malformed/);
  });
});

describe("the rule it exists to enforce: two PEOPLE", () => {
  it("REFUSES a code whose approver is the proposer", async () => {
    // The whole point. An approver who is the actor is a rubber stamp with extra steps, and the
    // database's `ck_officer_provisioning_distinct_approver` would also refuse the row — this check
    // is what produces a message an administrator can act on instead of a constraint violation.
    const { mintApprovalCode, verifyApprovalCode } = await approvalModule();
    const code = mintApprovalCode({
      action: "PROVISION",
      approverId: PROPOSER,
      targetOfficerId: OFFICER,
      targetJurisdictionId: NODE,
    });
    expect(() =>
      verifyApprovalCode(code, {
        action: "PROVISION",
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
      action: "PROVISION",
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
        action: "PROVISION",
        targetOfficerId: OFFICER,
        targetJurisdictionId: "10000000-0000-4000-8000-000000000001",
        proposerId: PROPOSER,
      }),
    ).toThrowError(/failed verification/);
  });

  it("REFUSES a code signed with a different secret", async () => {
    const other = await approvalModule("a-DIFFERENT-secret-also-at-least-32-characters");
    const code = other.mintApprovalCode({
      action: "PROVISION",
      approverId: APPROVER,
      targetOfficerId: OFFICER,
      targetJurisdictionId: NODE,
    });

    const ours = await approvalModule(SECRET);
    expect(() =>
      ours.verifyApprovalCode(code, {
        action: "PROVISION",
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
      {
        action: "PROVISION",
        approverId: APPROVER,
        targetOfficerId: OFFICER,
        targetJurisdictionId: NODE,
      },
      mintedAt,
    );
    // One millisecond inside the window: fine.
    expect(() =>
      verifyApprovalCode(
        code,
        {
          action: "PROVISION",
          targetOfficerId: OFFICER,
          targetJurisdictionId: NODE,
          proposerId: PROPOSER,
        },
        mintedAt + APPROVAL_CODE_TTL_MS - 1,
      ),
    ).not.toThrow();
    // One millisecond past it: refused.
    expect(() =>
      verifyApprovalCode(
        code,
        {
          action: "PROVISION",
          targetOfficerId: OFFICER,
          targetJurisdictionId: NODE,
          proposerId: PROPOSER,
        },
        mintedAt + APPROVAL_CODE_TTL_MS + 1,
      ),
    ).toThrowError(/expired/);
  });

  it("REFUSES malformed input rather than throwing something unhelpful", async () => {
    const { verifyApprovalCode } = await approvalModule();
    for (const bad of ["", "no-dot", "a.b.c", "....", "x."]) {
      expect(() =>
        verifyApprovalCode(bad, {
          action: "PROVISION",
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
        action: "PROVISION",
        approverId: APPROVER,
        targetOfficerId: OFFICER,
        targetJurisdictionId: NODE,
      }),
    ).toThrowError(/PROVISIONING_APPROVAL_SECRET/);
    expect(() =>
      verifyApprovalCode("a.b", {
        action: "PROVISION",
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
        action: "PROVISION",
        approverId: APPROVER,
        targetOfficerId: OFFICER,
        targetJurisdictionId: NODE,
      }),
    ).toThrowError(/32 characters/);
  });
});
