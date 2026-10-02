import { describe, expect, it, vi } from "vitest";
import {
  StepUpRequiredError,
  TierCannotOpenNamedRecordError,
  browseStaffListGated,
  openNamedStaffRecord,
} from "@/lib/oversight/gate-step-up";
import { EMIS, OPS_STAFF } from "./fixtures/ids";
import {
  auditRowCount,
  caseRef,
  districtOfficer,
  officerFixture,
  stepUpFixture,
} from "./helpers";

/**
 * THE §6 STEP-UP ORDERING (increment G · Kofi R6 · Lucy G7).
 *
 * The requirement is not "a modal appears" — it is that a REFUSED step-up leaves no trace and reads
 * nothing. Those are two separate claims about two separate databases:
 *
 *   · NOTHING LOGGED. The gate writes its `audit_access_log` row BEFORE it fetches (§6 step 2), so
 *     "no row" is the strongest available evidence that no disclosure happened. It is asserted here
 *     by counting the append-only table either side of the refused call — the one assertion that
 *     cannot be satisfied by a denial row, a rolled-back row, or a row nobody looked at.
 *   · NOTHING FETCHED. The operational read-back is opened INSIDE the gate, so a call that never
 *     enters the gate cannot have opened it. That is why the assertion is "the gate function was
 *     never entered" (the throw happens first) rather than a spy on the read-back: a spy would prove
 *     the current code path, this proves the shape of it.
 *
 * The happy path (fresh assertion ⇒ one row, one record) is already covered end-to-end by
 * tests/gate.test.ts; what is added here is the refusal.
 *
 * ── THE ASSERTION IS BRANDED (Dex B1) ────────────────────────────────────────────────────────────
 * These tests build their assertions with `stepUpFixture()`, the suite's sanctioned mint, because
 * `{ fresh: true }` no longer typechecks: the choke point used to be handed that literal by both
 * server actions, i.e. the guard in front of the product's one irreversible action was reading a
 * value the caller had typed. The compile-time half of that fix lives in
 * tests/auth-boundaries.test.ts (a `@ts-expect-error` proving the literal is rejected, plus the
 * mint's importer allow-list); the RUNTIME half is below, unchanged — a stale assertion is still
 * refused, and refusing still means nothing is written and nothing is read.
 */

describe("a stale step-up writes NO audit row and fetches nothing", () => {
  it("refuses the named-record path with StepUpRequiredError", async () => {
    const before = await auditRowCount();

    await expect(
      openNamedStaffRecord(
        {
          officer: districtOfficer,
          school: { emisSchoolId: EMIS.publicConsented },
          reasonCode: "STATUTORY_AUDIT",
          caseReference: caseRef("stepup-stale"),
          subject: { operationalStaffId: OPS_STAFF.teacherOnRegister },
          rosterBrowsed: false,
          exportFormat: null,
        },
        stepUpFixture(false),
      ),
    ).rejects.toBeInstanceOf(StepUpRequiredError);

    // The append-only table is byte-identical. Not "no GRANTED row" — NO row: a cancelled step-up
    // is not a denial, because nothing was attempted against the operational record (Lucy G7).
    expect(await auditRowCount()).toBe(before);
  });

  it("refuses the ROSTER path too — a list of names is a named-record access", async () => {
    const before = await auditRowCount();

    await expect(
      browseStaffListGated(
        {
          officer: districtOfficer,
          school: { emisSchoolId: EMIS.publicConsented },
          reasonCode: "STATUTORY_AUDIT",
          caseReference: caseRef("stepup-roster"),
        },
        stepUpFixture(false),
      ),
    ).rejects.toBeInstanceOf(StepUpRequiredError);

    expect(await auditRowCount()).toBe(before);
  });

  it("a FRESH assertion lets the gate run and write exactly one row", async () => {
    // The control: without it, every assertion above would also pass against a function that always
    // throws.
    const before = await auditRowCount();
    const result = await openNamedStaffRecord(
      {
        officer: districtOfficer,
        school: { emisSchoolId: EMIS.publicConsented },
        reasonCode: "STATUTORY_AUDIT",
        caseReference: caseRef("stepup-fresh"),
        subject: { operationalStaffId: OPS_STAFF.teacherOnRegister },
        rosterBrowsed: false,
        exportFormat: null,
      },
      stepUpFixture(true),
    );
    expect(result.accessId).toBeTruthy();
    expect(await auditRowCount()).toBe(before + 1);
  });
});

describe("the production mint fails closed", () => {
  it("mints a STALE assertion when there is no verified session to read freshness from", async () => {
    // `resolveStepUpAssertion()` is the only production constructor. With auth unconfigured (the
    // suite's posture: AUTH_DEV_BYPASS=false and no Supabase vars) there is no token to measure, so
    // `getAuthContext().stepUpFresh` is false and the mint yields a stale assertion — which the
    // choke point then refuses. The important property is the DIRECTION: an unresolvable session
    // produces a refusal, never a convenient default.
    vi.resetModules();
    const { resolveStepUpAssertion } = await import("@/lib/auth/step-up");
    const resolution = await resolveStepUpAssertion();
    expect(resolution.fresh).toBe(false);
    expect(resolution.assertion.fresh).toBe(false);
    // …and it is a real assertion object, so the caller cannot mistake "stale" for "absent".
    expect(resolution.factorId).toBeNull();
  });

  it("mints a stale assertion when a code is submitted and cannot be verified", async () => {
    vi.resetModules();
    const { resolveStepUpAssertion } = await import("@/lib/auth/step-up");
    const resolution = await resolveStepUpAssertion({ code: "000000", factorId: null });
    expect(resolution.fresh).toBe(false);
    // The copy the modal shows comes from lib/auth/mfa.ts, not from the gate.
    expect(resolution.error).toBeTruthy();
  });
});

describe("the tier ceiling is checked BEFORE the step-up, not after", () => {
  it("a SCHOOL-tier session is refused even WITH a perfect step-up", async () => {
    // "Proved it's you" is not "allowed to do this". A SCHOOL-tier officer cannot exist through the
    // resolver (Kofi R1 is enforced three times over), so this is the belt behind those braces: if
    // such a session were ever constructed, the gate still refuses — and refuses for the right
    // reason, which is the tier and not the assertion.
    const before = await auditRowCount();
    const schoolTier = officerFixture({
      ...districtOfficer,
      level: "SCHOOL",
    });

    await expect(
      openNamedStaffRecord(
        {
          officer: schoolTier,
          school: { emisSchoolId: EMIS.publicConsented },
          reasonCode: "STATUTORY_AUDIT",
          caseReference: caseRef("stepup-school-tier"),
          subject: { operationalStaffId: OPS_STAFF.teacherOnRegister },
          rosterBrowsed: false,
          exportFormat: null,
        },
        stepUpFixture(true),
      ),
    ).rejects.toBeInstanceOf(TierCannotOpenNamedRecordError);

    expect(await auditRowCount()).toBe(before);
  });

  it("the refusal names the rule, so an operator reading a log knows why", () => {
    const error = new TierCannotOpenNamedRecordError("SCHOOL");
    expect(error.message).toMatch(/no SCHOOL-tier oversight officer/i);
    expect(error.code).toBe("TIER_CANNOT_OPEN_NAMED_RECORD");
  });
});
