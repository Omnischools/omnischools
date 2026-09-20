import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";

/**
 * INCR-24b SOURCE-SHAPE guards (Quinn's 24b AC suite) — the structural invariants the PURE
 * med-admin.test.ts cannot reach, pinned the ADV-3 way: assert the EXPRESSION, never the name, so a
 * mutation reds. Companions to the DB-CHECK probes (run live as omnischools_app) and the behavioural
 * medAdminWitnessError tripwire. Three sources are read:
 *   · the WRITE  — lib/actions/sickbay-med-admin.ts  (append-only + server-resolved is_controlled)
 *   · the READS  — lib/sickbay/med-admin-reads.ts     (derived rounds gate + PRN + fixed 3 statements)
 *   · the §3 reader switch — lib/sickbay/stock-reads.ts (getControlledRegister keyed on stock_item_id)
 */
const ACTION = "lib/actions/sickbay-med-admin.ts";
const READS = "lib/sickbay/med-admin-reads.ts";
const STOCK_READS = "lib/sickbay/stock-reads.ts";

/** Slice a named function's body out of comment-stripped source, up to the next top-level marker. */
function fnBody(src: string, startNeedle: string, endNeedle: string): string {
  const from = src.indexOf(startNeedle);
  if (from === -1) throw new Error(`not found: ${startNeedle}`);
  const to = src.indexOf(endNeedle, from + startNeedle.length);
  return src.slice(from, to === -1 ? src.length : to);
}

// ============================================================================
// AC1 — APPEND-ONLY IS STRUCTURAL (R142/R146). The module's ONLY MAR verb is `.insert`.
// ADV-3: assert the EXPRESSION — a mutant flipping the correction path to `.update(sickbayMedAdmin)`
// (or a `.delete`) must red HERE, not just fail a name grep.
// ============================================================================
describe("AC1 · the MAR write is append-only — exactly one INSERT, no UPDATE/DELETE of the MAR", () => {
  const src = () => readCode(ACTION);

  it("issues EXACTLY ONE `.insert(sickbayMedAdmin)` — the one verb (mutation to .update reds this)", () => {
    const inserts = [...src().matchAll(/\.insert\(\s*sickbayMedAdmin\s*\)/g)];
    expect(inserts.length).toBe(1);
  });

  it("never `.update(sickbayMedAdmin)` and never `.delete(sickbayMedAdmin)` — no edit/void/delete of the record", () => {
    const s = src();
    expect(s, "a MAR row is byte-unchanged forever").not.toMatch(/\.update\(\s*sickbayMedAdmin/);
    expect(s, "a MAR row is never deleted").not.toMatch(/\.delete\(\s*sickbayMedAdmin/);
  });

  it("a correction is a NEW row citing correctsAdminId + amendmentNote (not an edit of the original)", () => {
    const s = src();
    // Both land in the INSERT ...values(...) block — the append-only amendment shape.
    expect(s).toMatch(/correctsAdminId,/);
    expect(s).toMatch(/amendmentNote:\s*correctsAdminId\s*\?/);
    // …and it is refused without a note (R146).
    expect(s).toMatch(/correctsAdminId && !d\.amendmentNote\?\.trim\(\)/);
  });
});

// ============================================================================
// AC9 — the falsifiability crux. is_controlled is SERVER-RESOLVED, never client-trusted: a forged
// `is_controlled=false` on a controlled drug must be inexpressible AND the resolved-true path must
// still demand the witness.
// ============================================================================
describe("AC9 · is_controlled is server-resolved from the stock item, never a client field", () => {
  const src = () => readCode(ACTION);

  it("the client RecordSchema has NO isControlled key — a forged flag cannot even be expressed", () => {
    const schema = fnBody(src(), "const RecordSchema = z.object({", "\n});");
    expect(schema).not.toMatch(/isControlled/);
    // dispensedQty / stockItemId ARE client fields (re-resolved), so this is is_controlled-specific.
    expect(schema).toMatch(/stockItemId:/);
  });

  it("is_controlled is COPIED from the re-resolved sickbay_stock_item.is_controlled", () => {
    expect(src()).toMatch(/isControlled\s*=\s*si\.isControlled/);
  });

  it("the INSERT pins the RESOLVED is_controlled — never the client's word (no d.isControlled)", () => {
    const s = src();
    expect(s).toMatch(/isControlled:\s*resolved\.isControlled/);
    expect(s, "the client's flag must never reach the row").not.toMatch(/isControlled:\s*d\.isControlled/);
  });

  it("the witness gate keys on the RESOLVED is_controlled (a resolved-true controlled drug still gates)", () => {
    const s = src();
    expect(s).toMatch(/medAdminWitnessError\(\{[\s\S]*?isControlled:\s*resolved\.isControlled/);
    expect(s).toMatch(/const controlledGiven = resolved\.isControlled && d\.status === "GIVEN"/);
  });
});

// ============================================================================
// AC13/14 — the §3 reader SWITCH (R168). getControlledRegister's MAR arm joins by stock_item_id, not
// the mutable drug_name snapshot: tablet+syrup keep separate balances, a rename can't orphan, and a
// non-controlled own-bottle dose never appears (filtered is_controlled=true).
// ============================================================================
describe("AC13/14 · getControlledRegister derives the MAR contribution by stock_item_id, not drug_name", () => {
  const arm = () => {
    const src = readCode(STOCK_READS);
    // The administrations (MAR) sub-query + its per-item aggregation, inside getControlledRegister.
    return fnBody(src, "const administrations = await tx", "function sum(");
  };

  it("the MAR administrations query FILTERS by sickbayMedAdmin.stockItemId (the 0061 switch)", () => {
    expect(arm()).toMatch(/inArray\(sickbayMedAdmin\.stockItemId,\s*itemIds\)/);
  });

  it("the MAR arm NEVER matches on drug_name (the old cross-contaminating join is gone)", () => {
    expect(arm(), "a drug_name match would re-cross tablet+syrup and orphan on rename").not.toMatch(
      /sickbayMedAdmin\.drugName|drug_name/,
    );
  });

  it("only controlled GIVEN rows contribute — a non-controlled own-bottle dose never appears (AC14)", () => {
    const a = arm();
    expect(a).toMatch(/eq\(sickbayMedAdmin\.isControlled,\s*true\)/);
    expect(a).toMatch(/eq\(sickbayMedAdmin\.status,\s*"GIVEN"\)/);
  });

  it("per-item balance partitions by a.stockItemId === item.id (not drugName)", () => {
    expect(arm()).toMatch(/a\.stockItemId === item\.id/);
  });
});

// ============================================================================
// AC17/18 — derived rounds. PRN never appears; OVERDUE derived at read (no scheduler); EXACTLY 3 DB
// round-trips, no per-student N+1.
// ============================================================================
describe("AC17/18 · getMedicationRounds excludes PRN and issues a fixed 3 statements (no N+1)", () => {
  const body = () => fnBody(readCode(READS), "export async function getMedicationRounds", "export async function getVisitMar");

  it("PRN is EXCLUDED — the due query filters chronic_med.is_prn = false (R179)", () => {
    expect(body()).toMatch(/eq\(sickbayChronicMed\.isPrn,\s*false\)/);
  });

  it("EXACTLY 3 DB round-trips: getRoundSchedule (1) + two `await tx` reads (due, done)", () => {
    const b = body();
    expect([...b.matchAll(/getRoundSchedule\(/g)].length).toBe(1);
    expect([...b.matchAll(/await tx\b/g)].length, "due + done — no third query, no per-student read").toBe(2);
  });

  it("NO per-student N+1 — nothing is awaited in the in-memory building phase (after the done partition)", () => {
    const b = body();
    const building = b.slice(b.indexOf("const built = rounds.map"));
    expect(building, "an await in the round/dose mapping would be a per-student query").not.toMatch(/\bawait\b/);
  });

  it("OVERDUE is DERIVED, nothing auto-writes OMITTED — the reader has no insert/update of the MAR", () => {
    const b = body();
    expect(b).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
  });
});

// ============================================================================
// AC19/21 — the read gate. Both readers refuse a non-clinical reader (ADMIN / grantee) with null and
// ZERO SQL: the SICKBAY_CLINICAL_READ_ROLES check is the FIRST statement, before any withSchool.
// ============================================================================
describe("AC19/21 · the MAR readers gate on SICKBAY_CLINICAL_READ_ROLES before any query", () => {
  it("getMedicationRounds returns null for a non-clinical reader BEFORE withSchool", () => {
    const b = fnBody(readCode(READS), "export async function getMedicationRounds", "export async function getVisitMar");
    const gate = b.search(/if \(!hasAnyRole\(actor\.roles, SICKBAY_CLINICAL_READ_ROLES\)\) return null/);
    const firstDb = b.search(/withSchool\(/);
    expect(gate, "the clinical-read gate must exist").toBeGreaterThan(-1);
    expect(gate, "the gate must precede any DB access").toBeLessThan(firstDb);
  });

  it("getVisitMar returns null for a non-clinical reader BEFORE withSchool", () => {
    const b = fnBody(readCode(READS), "export async function getVisitMar", "export interface MarFormOptions");
    const gate = b.search(/if \(!hasAnyRole\(actor\.roles, SICKBAY_CLINICAL_READ_ROLES\)\) return null/);
    const firstDb = b.search(/withSchool\(/);
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(firstDb);
  });

  it("the MAR read set is the clinical pair [HEADMASTER, MATRON] — NOT ADMIN, NOT a grant scope (O2)", () => {
    // The reads file gates on the role set, never on withStaffScope (the chronic grant boundary).
    expect(readCode(READS)).not.toMatch(/withStaffScope/);
  });
});
