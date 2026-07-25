import { describe, it, expect } from "vitest";
import { hasAnyRole, SICKBAY_CLINICAL_READ_ROLES, SICKBAY_CLINICAL_WRITE_ROLES } from "@/lib/access";
import { readCode } from "@/lib/test-utils/source-shape";

/**
 * INCR-25b · Quinn — the PROJECTION-MATRIX + write-gate guards the shipped suite did not yet pin.
 *
 * The referral readers reach the DB driver, so they cannot run in this Node suite; the runtime
 * field-set proof (the REAL reader as a superuser) lives in scripts/verify-sickbay-referral.ts. These
 * are the source-shape counterparts that RED in `pnpm test` the day a clinical field is smuggled into
 * the BURSAR or HOUSEMASTER projection, the HM co-sign role check is dropped, a notification is
 * written, the billing FK is set, or a PII field reaches the ADMIN-readable audit feed. Mutation-
 * proven (Quinn): each `expect` below reds under the leak it names.
 */
const READS = "lib/sickbay/referral-reads.ts";
const ACTION = "lib/actions/sickbay-referral.ts";
const HOLD = "lib/sickbay/medical-hold.ts";

// The clinical vocabulary that must NEVER surface in a non-clinical projection or the audit feed.
const CLINICAL_TOKENS = [
  "workingImpression",
  "mensesNote",
  "reasonReferredOut",
  "preReferralCare",
  "handoffLabs",
  "lastMeal",
  "travelNote",
  "presentingComplaint",
];

// ============================================================================
// RF10 · the read/write role matrix (R195)
// ============================================================================
describe("🔴 RF10 · role matrix — clinical read is HEADMASTER/MATRON, write is MATRON only", () => {
  it("clinical READ admits only HEADMASTER + MATRON", () => {
    expect(hasAnyRole(["HEADMASTER"], SICKBAY_CLINICAL_READ_ROLES)).toBe(true);
    expect(hasAnyRole(["MATRON"], SICKBAY_CLINICAL_READ_ROLES)).toBe(true);
    // The three the projection matrix carves out: ADMIN (module, no clinical), HOUSEMASTER
    // (off-campus existence only), BURSAR (cost lines only) — none reach the clinical reader.
    for (const r of ["ADMIN", "HOUSEMASTER", "BURSAR", "TEACHER", "PARENT", "STUDENT", "DEAN_OF_BOARDING"]) {
      expect(hasAnyRole([r], SICKBAY_CLINICAL_READ_ROLES), `${r} must NOT read clinical`).toBe(false);
    }
    expect([...SICKBAY_CLINICAL_READ_ROLES]).toEqual(["HEADMASTER", "MATRON"]);
  });

  it("clinical WRITE is exactly [MATRON] — not ADMIN, not HEADMASTER", () => {
    expect(hasAnyRole(["MATRON"], SICKBAY_CLINICAL_WRITE_ROLES)).toBe(true);
    for (const r of ["ADMIN", "HEADMASTER", "HOUSEMASTER", "BURSAR", "TEACHER"]) {
      expect(hasAnyRole([r], SICKBAY_CLINICAL_WRITE_ROLES), `${r} must NOT write`).toBe(false);
    }
    expect([...SICKBAY_CLINICAL_WRITE_ROLES]).toEqual(["MATRON"]);
  });

  it("both referral pages gate the clinical fetch behind SICKBAY_CLINICAL_READ_ROLES → ClinicalRestricted", () => {
    for (const p of [
      "app/(app)/senior/sickbay/referrals/page.tsx",
      "app/(app)/senior/sickbay/referrals/[ref]/page.tsx",
    ]) {
      const s = readCode(p);
      expect(s, `${p} must gate on the clinical read set`).toMatch(
        /hasAnyRole\(roles,\s*SICKBAY_CLINICAL_READ_ROLES\)/,
      );
      expect(s, `${p} must refuse a non-clinical reader with ClinicalRestricted`).toContain(
        "ClinicalRestricted",
      );
      // The gate must sit BEFORE the reader fetch — no clinical SQL for an ADMIN/HOUSEMASTER.
      const gate = s.search(/SICKBAY_CLINICAL_READ_ROLES\)\)\s*return\s*<ClinicalRestricted/);
      const fetch = s.search(/getActiveReferrals\(|getReferralDetail\(/);
      expect(gate, `${p}: gate must precede the fetch`).toBeGreaterThan(-1);
      expect(gate).toBeLessThan(fetch);
    }
  });
});

// ============================================================================
// RF3 / R195 · the BURSAR projection is diagnosis-free BY CONSTRUCTION
// ============================================================================
describe("🔴 R195 · BURSAR cost-line projection carries no clinical field", () => {
  const src = () => readCode(READS);

  it("the cost-line readers touch only sickbay_referral_cost_line — no visit join, no clinical column", () => {
    const s = src();
    const region = s.slice(s.indexOf("async function costLinesFor"));
    expect(region, "cost reader region must exist").not.toBe("");
    expect(region, "cost lines must not join the visit").not.toContain("sickbayVisit");
    for (const t of CLINICAL_TOKENS) {
      expect(region.includes(t), `BURSAR cost region leaks clinical token "${t}"`).toBe(false);
    }
  });

  it("the ReferralCostLine shape is exactly the diagnosis-free five", () => {
    const s = src();
    const block = s.slice(s.indexOf("export interface ReferralCostLine"), s.indexOf("export interface ReferralDetail"));
    for (const t of CLINICAL_TOKENS) {
      expect(block.includes(t), `ReferralCostLine leaks "${t}"`).toBe(false);
    }
    for (const k of ["itemLabel", "provider", "nhisCovered", "outOfPocketAmount"]) {
      expect(block, `ReferralCostLine must keep the cost field ${k}`).toContain(k);
    }
  });
});

// ============================================================================
// R195 · the HOUSEMASTER projection is off-campus EXISTENCE only
// ============================================================================
describe("🔴 R195 · HOUSEMASTER projection is a Set<studentId> — no clinical field", () => {
  it("referredOutStudentIds selects ONLY studentId and returns a Set", () => {
    const s = readCode(HOLD);
    const fn = s.slice(s.indexOf("export async function referredOutStudentIds"));
    expect(fn).toContain("studentId: sickbayReferral.studentId");
    expect(fn).toMatch(/return new Set/);
    for (const t of [...CLINICAL_TOKENS, "hospitalWard", "hospitalBed", "nhisCardNumber"]) {
      expect(fn.includes(t), `HOUSEMASTER existence projection leaks "${t}"`).toBe(false);
    }
  });
});

// ============================================================================
// A POSITIVE control — the MATRON/HEADMASTER projection DOES keep full clinical detail
// ============================================================================
describe("R195 · the clinical reader keeps full detail (a stripped clinical read is also a bug)", () => {
  it("ReferralDetail carries the working_impression, the frozen handoff and the menses note", () => {
    const s = readCode(READS);
    const block = s.slice(s.indexOf("export interface ReferralDetail"), s.indexOf("export async function getReferralDetail"));
    for (const k of ["workingImpression", "reasonReferredOut", "mensesNote", "handoffLabs", "updates", "costLines"]) {
      expect(block, `the clinical detail projection dropped ${k}`).toContain(k);
    }
  });
});

// ============================================================================
// RF8 · the HM co-sign is role-checked in-school BEFORE the write
// ============================================================================
describe("🔴 RF8 · recordReferral verifies the HM co-signer holds HEADMASTER before writing", () => {
  it("calls holdsSchoolRole(schoolId, hmAuthorisedByUserId, HEADMASTER) and refuses on failure", () => {
    const s = readCode(ACTION);
    expect(s).toMatch(/holdsSchoolRole\(auth\.schoolId,\s*d\.hmAuthorisedByUserId,\s*"HEADMASTER"\)/);
    // The check must precede the insert — a non-HM co-signer is refused before any row is written.
    const check = s.indexOf("holdsSchoolRole");
    const insert = s.indexOf(".insert(sickbayReferral)");
    expect(check).toBeGreaterThan(-1);
    expect(check, "the HM role check must run before the referral insert").toBeLessThan(insert);
  });
});

// ============================================================================
// RF11 · the notification table is authored-not-written; D6 · the billing FK stays NULL
// ============================================================================
describe("🔴 RF11 / D6 · no notification write, no private_note, no billing_line_item_id set", () => {
  it("no 25b write-path or reader references sickbay_notification or private_note", () => {
    for (const p of [ACTION, READS, HOLD]) {
      const s = readCode(p);
      expect(s.includes("sickbayNotification"), `${p} writes/reads the notification table`).toBe(false);
      expect(s.includes("privateNote"), `${p} touches private_note`).toBe(false);
    }
  });

  it("the cost-line insert never sets billing_line_item_id (D6 — stays NULL in 4.4)", () => {
    const s = readCode(ACTION);
    expect(s.includes("billingLineItemId"), "billing_line_item_id must never be set in 25b").toBe(false);
  });
});

// ============================================================================
// The ADMIN-readable audit feed masks/omits PII (the 25a maskNhisCard lesson)
// ============================================================================
describe("🔴 audit before/after carries no diagnosis, no menses, no handoff, no full NHIS", () => {
  it("every audit payload omits the clinical/PII tokens and the raw NHIS number", () => {
    const s = readCode(ACTION);
    // Each audit payload is a single-level object literal — extract them all.
    const blocks = [...s.matchAll(/(?:before|after):\s*\{[^{}]*\}/g)].map((m) => m[0]);
    expect(blocks.length, "audit payloads must be extractable").toBeGreaterThan(3);
    const joined = blocks.join("\n");
    for (const t of [...CLINICAL_TOKENS, "itemLabel", "body:"]) {
      expect(joined.includes(t), `an audit payload leaks "${t}"`).toBe(false);
    }
    // The NHIS number reaches the feed only through maskNhisCard — never as a raw key.
    expect(joined, "a raw nhis_card_number key must not reach the audit feed").not.toMatch(/nhisCardNumber\s*:/);
    expect(s, "the create audit must mask the NHIS card").toContain("maskNhisCard(nhis.nhisCardNumber)");
  });
});

// ============================================================================
// 🔴 R205 · void frees the visit for re-referral; a voided referral is read-only and takes NO write.
// The DB-behaviour proof (picker inclusion/exclusion, hold/off-campus dedup) is the phaseRV block in
// scripts/verify-sickbay-referral.ts; these are the source-shape counterparts that RED in `pnpm test`.
// ============================================================================
describe("🔴 R205 · void frees the visit + a voided referral takes no write", () => {
  it("RV2 · both one-per-visit guards block only a NON-VOIDED referral (voided_at IS NULL)", () => {
    const reads = readCode(READS);
    // The picker's leftJoin predicate excludes voided rows IN THE JOIN (so a voided-only visit re-offers).
    const picker = reads.slice(reads.indexOf("getReferableVisits"), reads.indexOf("export interface StaffOption"));
    expect(picker, "the picker join must exclude voided referrals").toContain("isNull(sickbayReferral.voidedAt)");

    const action = readCode(ACTION);
    // The create-guard's existing-referral select excludes voided rows too — the same free-the-slot rule.
    const create = action.slice(action.indexOf("export async function recordReferral("), action.indexOf(".insert(sickbayReferral)"));
    expect(create, "the create-guard must ignore voided referrals").toContain("isNull(sickbayReferral.voidedAt)");
  });

  it("RV4 · the case page derives voided from voidedAt, names the reason, and the panel is read-only", () => {
    const page = readCode("app/(app)/senior/sickbay/referrals/[ref]/page.tsx");
    // Mirrors the visit page's `record.voidedAt !== null`.
    expect(page, "page must derive voided from the voidedAt timestamp").toContain("d.voidedAt !== null");
    expect(page, "page must pass the void reason to the panel").toMatch(/voidReason=\{d\.voidReason\}/);
    expect(page, "page must render a voided banner").toContain("This referral was voided");

    const actions = readCode("components/sickbay/referral-actions.tsx");
    // The read-only branch short-circuits BEFORE any advance/return/void control and names the reason.
    const early = actions.indexOf("if (voided)");
    const controls = actions.indexOf("Void this referral");
    expect(early, "the read-only branch must exist").toBeGreaterThan(-1);
    expect(early, "the read-only branch must precede the write controls").toBeLessThan(controls);
    expect(actions, "the read-only banner names the void reason").toContain("voidReason");
  });

  it("RV5 · recordReferralUpdate + addReferralCostLine refuse a write to a voided referral (ADV-3: the voidedAt check itself)", () => {
    const action = readCode(ACTION);
    for (const [fn, stop] of [
      ["export async function recordReferralUpdate", ".insert(sickbayReferralUpdate)"],
      ["export async function addReferralCostLine", ".insert(sickbayReferralCostLine)"],
    ] as const) {
      const start = action.indexOf(fn);
      const region = action.slice(start, action.indexOf(stop, start));
      // Pin the guard EXPRESSION (the re-resolved row's voidedAt), not a copy of the error string.
      expect(region, `${fn} must re-check voidedAt before inserting`).toMatch(/if\s*\(\s*r\.voidedAt\s*\)/);
    }
  });
});
