import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";
import { exeatStatusLabel, exeatDetail, isCardReady } from "./parent-exeat-data";

/**
 * EXEAT PHASE 2 · parent-initiated SPECIAL exeat + own-child status. The reader is mostly an IO projection
 * over the SECURITY DEFINER fns, so the guards are (1) the PURE parent-facing copy — friendly status labels
 * (Kofi C2) + the DETAIL rule (echo the parent's OWN words only, relabel FEE_COLLECTION so no amount leaks),
 * and (2) source-shape: reader/action stay inside withParentScope, the write is a thin fn caller that
 * server-forces nothing itself and sends no SMS. RLS/fn behaviour lives in db:rls-test.
 */

describe("exeatStatusLabel · friendly status copy (Kofi C2)", () => {
  it("maps every lifecycle status to its parent-facing sentence", () => {
    expect(exeatStatusLabel("REQUESTED")).toBe("Submitted — awaiting the school's approval");
    expect(exeatStatusLabel("HM_APPROVED")).toBe("Approved by the House — awaiting final sign-off");
    expect(exeatStatusLabel("SR_HM_SIGNED")).toBe("Approved and signed off");
    expect(exeatStatusLabel("DEPARTED")).toBe("Signed out — currently at home");
    expect(exeatStatusLabel("RETURNED")).toBe("Returned to school");
    expect(exeatStatusLabel("DECLINED")).toBe("Not approved — please contact the House");
  });

  it("never leaks the raw operational vocabulary and falls back neutrally", () => {
    for (const s of ["REQUESTED", "HM_APPROVED", "SR_HM_SIGNED", "DEPARTED", "RETURNED", "DECLINED"]) {
      expect(exeatStatusLabel(s)).not.toBe(s);
    }
    expect(exeatStatusLabel("WEIRD_UNKNOWN")).toBe("In progress");
  });
});

describe("exeatDetail · reason-echo gate + FEE_COLLECTION relabel", () => {
  // parent_exeat_list REDACTS a staff-authored reason to NULL (via_parent_portal is the provenance
  // authority, NOT the broadly-true parent_initiated flag — Sarah leak-fix), so at THIS reader boundary a
  // PRESENT reason is always the parent's own words. That fn-level redaction is proven BEHAVIOURALLY by
  // db:rls-test (a staff SPECIAL's reason comes back NULL); it is not reachable from a pure unit test.
  it("echoes a present reason (the parent's OWN words, trimmed) verbatim", () => {
    expect(exeatDetail({ exeatType: "SPECIAL", reason: "  Grandmother's funeral  " })).toBe(
      "Grandmother's funeral",
    );
  });

  it("shows a friendly TYPE label when the reason is NULL — a staff reason is redacted upstream, never echoed", () => {
    // A staff-authored exeat reaches the reader with reason=NULL (redacted by the fn) → type label only.
    expect(exeatDetail({ exeatType: "SPECIAL", reason: null })).toBe("Special leave");
    expect(exeatDetail({ exeatType: "SCHEDULED", reason: null })).toBe("Scheduled leave");
    // empty/whitespace reason → still the friendly type label (no blank detail)
    expect(exeatDetail({ exeatType: "SPECIAL", reason: "   " })).toBe("Special leave");
  });

  it("relabels FEE_COLLECTION to a bare 'Fee collection' — the amount-bearing reason is NEVER echoed", () => {
    expect(exeatDetail({ exeatType: "FEE_COLLECTION", reason: "Collect GHS 340.00 outstanding" })).toBe(
      "Fee collection",
    );
    expect(exeatDetail({ exeatType: "FEE_COLLECTION", reason: "GHS 215.00 owed" })).toBe("Fee collection");
  });
});

describe("isCardReady · card-download eligibility mirrors parent_exeat_card (Phase 3-A)", () => {
  it("a SPECIAL is card-ready only once Senior-HM-signed or departed", () => {
    expect(isCardReady("SR_HM_SIGNED", "SPECIAL")).toBe(true);
    expect(isCardReady("DEPARTED", "SPECIAL")).toBe(true);
    // a SPECIAL only HM-approved has NOT cleared the Senior-HM sign-off → not yet downloadable
    expect(isCardReady("HM_APPROVED", "SPECIAL")).toBe(false);
    expect(isCardReady("REQUESTED", "SPECIAL")).toBe(false);
  });

  it("a SCHEDULED / FEE_COLLECTION is card-ready once HM-approved or departed", () => {
    for (const t of ["SCHEDULED", "FEE_COLLECTION"]) {
      expect(isCardReady("HM_APPROVED", t)).toBe(true);
      expect(isCardReady("DEPARTED", t)).toBe(true);
      expect(isCardReady("REQUESTED", t)).toBe(false);
    }
  });

  it("REQUESTED / DECLINED / RETURNED are never card-ready (RETURNED excluded per owner — live-window only)", () => {
    for (const t of ["SCHEDULED", "SPECIAL", "FEE_COLLECTION"]) {
      expect(isCardReady("REQUESTED", t)).toBe(false);
      expect(isCardReady("DECLINED", t)).toBe(false);
      expect(isCardReady("RETURNED", t)).toBe(false);
    }
  });

  it("an unknown status or type is never card-ready (fail-closed)", () => {
    expect(isCardReady("WEIRD", "SPECIAL")).toBe(false);
    expect(isCardReady("DEPARTED", "WEIRD_TYPE")).toBe(false);
  });
});

describe("parent-exeat-data · reader stays inside the parent boundary (source-shape)", () => {
  const reader = () => readCode("lib/parent/parent-exeat-data.ts");

  it("runs under withParentScope only — never withSchool / withoutTenantScope", () => {
    const s = reader();
    expect(s).toMatch(/withParentScope/);
    expect(s).not.toMatch(/withSchool|withoutTenantScope/);
  });

  it("reads boarding_exeat ONLY through the SECURITY DEFINER projection (the table stays parent_deny)", () => {
    const s = reader();
    expect(s).toMatch(/parent_exeat_list/);
    expect(s).not.toMatch(/boardingExeat/); // never a direct Drizzle read of the denied table
    expect(s).not.toMatch(/fee_owing_snapshot|feeOwingSnapshot/); // amount never reaches the parent wire
  });
});

describe("parent-exeat action · the write trust boundary", () => {
  const action = () => readCode("lib/actions/parent-exeat.ts");

  it("is a parent-gated server action under withParentScope (not requireSchool)", () => {
    const s = action();
    expect(s).toMatch(/^"use server"/m);
    expect(s).toMatch(/requireParent\(\)/);
    expect(s).not.toMatch(/requireSchool/);
    expect(s).toMatch(/withParentScope/);
    expect(s).not.toMatch(/\bwithSchool\b/);
  });

  it("delegates to the SECURITY DEFINER write fn and never forges lifecycle fields itself", () => {
    const s = action();
    expect(s).toMatch(/parent_request_exeat/);
    // the fn server-forces type/status/parent_initiated — the action must not set them (no direct insert).
    expect(s).not.toMatch(/insert\(boardingExeat\)|\.values\(/);
    expect(s).not.toMatch(/"SPECIAL"|"REQUESTED"/); // no type/status literal written from app code
  });

  it("validates the inputs and sends NO SMS", () => {
    const s = action();
    expect(s).toMatch(/z\.object\(/);
    expect(s).toMatch(/\.min\(4/);
    expect(s).toMatch(/\.max\(500/);
    expect(s).toMatch(/departDate < today/); // not-in-the-past belt
    expect(s).toMatch(/returnDate < departDate/); // ordering belt
    expect(s).not.toMatch(/sendSms|sendSMS/);
  });
});

describe("boarding page · the exeat form is a client component; no server-only leak", () => {
  const form = () => readCode("app/(parent)/boarding/exeat-request.tsx");
  const page = () => readCode("app/(parent)/boarding/page.tsx");

  it("the request form is a client component calling the action only (never a server-only reader)", () => {
    const s = form();
    expect(s).toMatch(/^"use client"/m);
    expect(s).toMatch(/requestParentExeat/);
    expect(s).not.toMatch(/parent-exeat-data|loadParentExeats/); // the client never imports the db reader
    expect(s).toMatch(/type="date"/); // native date input (no picker lib)
  });

  it("the page loads exeats server-side and passes pre-formatted rows to the client list", () => {
    const s = page();
    expect(s).toMatch(/loadParentExeats/);
    expect(s).toMatch(/No leave requests yet\./); // empty state
    expect(s).toMatch(/ParentNav active="Boarding"/); // still one tab, unchanged
  });
});

/**
 * The SECURITY DEFINER fns are the authority for the C non-leak projection and the B/A5/D write guards.
 * db:rls-test (scripts/rls-test.ts) proves them BEHAVIOURALLY as the non-superuser owner — but that probe
 * needs a live DB and is NOT in `pnpm test`. These source-shape guards run in CI: they bite the moment a
 * future edit WIDENS the read projection (a fee/decline/actor-id leak) or DROPS a write guard in the SQL
 * that db:policies applies. We test db/sql/policies.sql (the dev source of truth) and cross-check that the
 * prod-paste projection has NOT drifted from it (a widened prod-paste is where a real prod leak would land).
 */
const POLICIES = readFileSync(resolve(cwd(), "db/sql/policies.sql"), "utf8");
const PROD_PASTE = readFileSync(
  resolve(cwd(), "db/sql/prod-paste-0098-parent-exeat.sql"),
  "utf8",
);
const PROD_PASTE_CARD = readFileSync(
  resolve(cwd(), "db/sql/prod-paste-0099-parent-exeat-card.sql"),
  "utf8",
);
/** Slice a `CREATE OR REPLACE FUNCTION <name>( ... $$;` block out of a SQL file. */
function fnBlock(sqlText: string, name: string): string {
  const start = sqlText.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  expect(start, `fn ${name} present`).toBeGreaterThan(-1);
  const end = sqlText.indexOf("$$;", start);
  return sqlText.slice(start, end);
}
/** Drop `-- …` line comments so a token in prose can't create a false match (or a false clear). */
const stripSql = (s: string): string => s.replace(/--.*$/gm, "");
/** The declared column names of a fn's `RETURNS TABLE( … )` — the authoritative read projection. */
function returnsTableCols(block: string): string[] {
  const m = block.match(/RETURNS TABLE\(([\s\S]*?)\)\s*\n\s*LANGUAGE/);
  expect(m, "RETURNS TABLE parsed").not.toBeNull();
  // `name TYPE[,]` per line — match ANY type word (not a fixed allow-list) so a leaked column of an
  // unexpected type (numeric, jsonb, …) still lands in the set and trips the exact-match assertion.
  return [...m![1].matchAll(/^\s*(\w+)\s+\w/gm)].map((x) => x[1]);
}

// The C3-IN set — the ONLY columns a parent may ever read of an exeat (Kofi C3).
const C3_IN = [
  "exeat_id", "ref_code", "exeat_type", "status", "parent_initiated", "reason",
  "depart_at", "return_by", "departed_at", "returned_at", "hm_approved_at", "sr_hm_signed_at",
  "house_name",
].sort();

describe("C non-leak · parent_exeat_list projection is exactly the C3-IN set (SQL guard)", () => {
  it("returns EXACTLY the C3-IN columns — no extras, none missing", () => {
    const cols = returnsTableCols(fnBlock(POLICIES, "parent_exeat_list")).sort();
    expect(cols).toEqual(C3_IN);
  });

  it("the read projection carries NONE of the OUT columns (fee/decline/actor-id/late/placement-ids)", () => {
    // Scope the denylist to the RETURNS TABLE only — fee_owing_snapshot legitimately appears in the WRITE
    // fn's INSERT (the snapshot is captured, just never READ back to the parent).
    const rt = fnBlock(POLICIES, "parent_exeat_list").match(/RETURNS TABLE\(([\s\S]*?)\)\s*\n\s*LANGUAGE/)![1];
    for (const banned of [
      "fee_owing_snapshot", "decline_reason", "_by_user_id", "returned_late",
      "house_id", "dorm", "bunk",
    ]) {
      expect(rt, `projection must not expose ${banned}`).not.toContain(banned);
    }
  });

  it("the prod-paste read projection has NOT drifted from policies.sql (a prod-only leak surface)", () => {
    const dev = returnsTableCols(fnBlock(POLICIES, "parent_exeat_list")).sort();
    const prod = returnsTableCols(fnBlock(PROD_PASTE, "parent_exeat_list")).sort();
    expect(prod).toEqual(dev);
  });
});

describe("B/A5/D · parent_request_exeat server-forces the row and re-checks eligibility (SQL guard)", () => {
  const write = () => stripSql(fnBlock(POLICIES, "parent_request_exeat"));

  it("SERVER-FORCES exeat_type=SPECIAL / status=REQUESTED / parent_initiated=true on the INSERT (B/D)", () => {
    const s = write();
    // the security-critical fields are literals in the fn, never derived from parent input
    expect(s).toMatch(/INSERT INTO boarding_exeat/);
    expect(s).toMatch(/'SPECIAL',\s*'REQUESTED'/);
    expect(s).toMatch(/parent_initiated/);
    expect(s).toMatch(/NULLIF\(btrim\(p_reason\), ''\), true/); // parent_initiated forced true
  });

  it("re-checks OWN-CHILD via the captured pu ARG before any traverse (D)", () => {
    expect(write()).toMatch(/parent_student_ids\(school, pu\)[\s\S]*?WHERE sid = p_student/);
  });

  it("re-checks ACTIVE BOARDER server-side (A5) and a House assignment (E5)", () => {
    const s = write();
    expect(s).toMatch(/v_house IS NULL/); // E5 no-House block
    expect(s).toMatch(/v_status IS DISTINCT FROM 'ACTIVE'/); // A5 active
    expect(s).toMatch(/v_res IS DISTINCT FROM 'BOARDER'/); // A5 boarder
  });

  it("carries the B9 open-guard over the four live statuses", () => {
    expect(write()).toMatch(
      /status::text IN \('REQUESTED','HM_APPROVED','SR_HM_SIGNED','DEPARTED'\)/,
    );
  });
});

/**
 * A1 (non-leak) + A3 (eligibility) for the CARD fn — Exeat Phase 3-A (prod-paste-0099). The behavioural
 * proof lives in db:rls-test (own-child card returns EXACTLY the A1 set; RETURNED → 0 rows; cross-tenant /
 * another-family / staff-pu=NULL → 0), but that needs a live DB and is NOT in `pnpm test`. These SQL-shape
 * guards run in CI and bite the moment a future edit WIDENS the card projection (a fee/signer/bunk leak),
 * ADMITS an ineligible status into the gate (e.g. RETURNED, the owner's live-window exclusion), or DRIFTS
 * the prod-paste away from policies.sql (where a prod-only leak would land — the fn is absent in CI).
 */
// The A1 set — the ONLY columns of an own-child card a parent may ever read (Kofi A1). NO fee/amount,
// signer staff name, bunk or dorm.
const A1_CARD = [
  "school_name", "school_code", "ref_code", "student_name", "form_label", "house_name",
  "exeat_type", "date_out", "date_in", "academic_year", "status",
].sort();

describe("A1/A3 · parent_exeat_card projection + eligibility gate (SQL guard)", () => {
  const cardBlock = (sqlText: string) => fnBlock(sqlText, "parent_exeat_card");

  it("A1 — the RETURNS TABLE is EXACTLY the A1 set (no extras, none missing)", () => {
    expect(returnsTableCols(cardBlock(POLICIES)).sort()).toEqual(A1_CARD);
  });

  it("A1 — the projection carries NONE of the OUT fields (fee/amount/signer/bunk/dorm/*_by/decline)", () => {
    const rt = cardBlock(POLICIES).match(/RETURNS TABLE\(([\s\S]*?)\)\s*\n\s*LANGUAGE/)![1];
    for (const banned of [
      "fee", "owing", "amount", "signer", "bunk", "dorm", "_by_user_id", "decline",
    ]) {
      expect(rt, `projection must not expose ${banned}`).not.toContain(banned);
    }
  });

  it("A3 — the eligibility gate admits ONLY the two download-eligible (type × status) pairs", () => {
    const s = stripSql(cardBlock(POLICIES));
    expect(s).toMatch(/'SPECIAL'\s+AND\s+be\.status::text\s+IN\s*\('SR_HM_SIGNED',\s*'DEPARTED'\)/);
    expect(s).toMatch(
      /IN\s*\('SCHEDULED',\s*'FEE_COLLECTION'\)\s+AND\s+be\.status::text\s+IN\s*\('HM_APPROVED',\s*'DEPARTED'\)/,
    );
  });

  it("A3 — REQUESTED / DECLINED / RETURNED are NOT admitted (RETURNED excluded per owner — live-window only)", () => {
    // stripSql drops the `-- RETURNED is deliberately EXCLUDED …` prose so a comment can't false-match.
    const s = stripSql(cardBlock(POLICIES));
    expect(s).not.toMatch(/'RETURNED'/);
    expect(s).not.toMatch(/'REQUESTED'/);
    expect(s).not.toMatch(/'DECLINED'/);
  });

  it("A4/A5 — own-child fence via the captured pu ARG, staff (pu IS NULL) short-circuits, GUC clear+restore", () => {
    const s = stripSql(cardBlock(POLICIES));
    expect(s).toMatch(/be\.student_id IN \(SELECT parent_student_ids\(school, pu\)\)/); // own-child fence
    expect(s).toMatch(/IF pu IS NULL[\s\S]*?THEN RETURN/); // staff no-op
    expect(s).toMatch(/set_config\('app\.current_parent_user', ''/); // clear parent_deny for the read
    expect(s).toMatch(/set_config\('app\.current_parent_user', COALESCE\(prev, ''\)/); // restore VERBATIM
    expect(s).not.toMatch(/pu::text/); // never forge a scope from the arg
  });

  it("the prod-paste-0099 card fn has NOT drifted from policies.sql (cols + normalized body)", () => {
    expect(returnsTableCols(cardBlock(PROD_PASTE_CARD)).sort()).toEqual(
      returnsTableCols(cardBlock(POLICIES)).sort(),
    );
    const norm = (t: string) => stripSql(t).replace(/\s+/g, " ").trim();
    expect(norm(cardBlock(PROD_PASTE_CARD))).toEqual(norm(cardBlock(POLICIES)));
  });
});
