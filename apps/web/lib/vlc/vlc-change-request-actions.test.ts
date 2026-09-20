import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import {
  planReorder,
  validateReorderOrder,
  previewChange,
  AddValuePayloadSchema,
  ReorderPayloadSchema,
  RemovePayloadSchema,
} from "./change-request";
import { VLC_CONFIG_APPROVE_ROLES, VLC_CONFIG_WRITE_ROLES } from "@/lib/access";
import { SHOWN_AUDIT_ENTITIES, isRedactedAuditEntity } from "@/lib/audit/redaction";

/**
 * Issue #296 · VLC curriculum-library change request — actions/reader/UI slice. PURE tests for the
 * atomic renumber + payload validation + preview, plus static source-shape guards (the vlc-sessions.test
 * idiom) for the two gates, inert-until-approved, soft-archive-not-delete, idempotency and tenant scope.
 * Behavioral live-DB RLS/tenant isolation is Quinn/Sarah's gate; here we prove the invariants a static
 * read + a pure simulation can.
 */
const src = (rel: string) => readFileSync(resolve(cwd(), rel), "utf8");
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const actions = src("lib/actions/vlc-change-request.ts");
const actionsCode = stripComments(actions);
const setupData = stripComments(src("lib/vlc/setup-data.ts"));
const pendingData = stripComments(src("lib/vlc/change-request-data.ts"));
const defaults = stripComments(src("lib/vlc/defaults.ts"));

// ── #296-A · the two gates: propose = Dean/Admin, decide = HEADMASTER only (no self-approve) ─────────
describe("#296-A · gates — propose is WRITE, decide is HEADMASTER-only", () => {
  it("VLC_CONFIG_APPROVE_ROLES is exactly [HEADMASTER] — no ADMIN, no DEAN (no self-approve)", () => {
    expect([...VLC_CONFIG_APPROVE_ROLES]).toEqual(["HEADMASTER"]);
    expect(VLC_CONFIG_APPROVE_ROLES).not.toContain("ADMIN");
    expect(VLC_CONFIG_APPROVE_ROLES).not.toContain("DEAN_OF_STUDENTS");
  });
  it("the approver set is DISJOINT from the proposer set (an Admin/Dean who proposes cannot approve)", () => {
    for (const r of VLC_CONFIG_WRITE_ROLES) {
      expect(VLC_CONFIG_APPROVE_ROLES as readonly string[]).not.toContain(r);
    }
  });
  it("propose actions assert the WRITE gate; decide actions assert the APPROVE gate", () => {
    expect(actions).toMatch(/authorizePropose[\s\S]*assertAnyRole\(VLC_CONFIG_WRITE_ROLES\)/);
    expect(actions).toMatch(/authorizeDecide[\s\S]*assertAnyRole\(VLC_CONFIG_APPROVE_ROLES\)/);
    for (const fn of ["proposeAddValue", "proposeReorderValues", "proposeRemoveValue"]) {
      const body = actionsCode.slice(actionsCode.indexOf(`function ${fn}`));
      expect(body, `${fn} must gate on authorizePropose`).toMatch(/authorizePropose\(\)/);
    }
    for (const fn of ["approveChangeRequest", "rejectChangeRequest"]) {
      const body = actionsCode.slice(actionsCode.indexOf(`function ${fn}`));
      expect(body, `${fn} must gate on authorizeDecide`).toMatch(/authorizeDecide\(\)/);
    }
  });
});

// ── #296-B · propose creates a PROPOSED request and does NOT touch vlc_value ─────────────────────────
describe("#296-B · propose inserts a PROPOSED request, no immediate effect on vlc_value", () => {
  it("each propose inserts into vlc_value_change_request with state PROPOSED", () => {
    expect(actionsCode).toMatch(/insert\(vlcValueChangeRequest\)/);
    expect(actionsCode).toMatch(/state:\s*"PROPOSED"/);
  });
  it("no propose function inserts/updates vlc_value or vlc_session_template", () => {
    // Everything that writes the curriculum lives in the apply* helpers (approve path). Each propose
    // FUNCTION body must not: a proposed change is inert until approved.
    for (const fn of ["proposeAddValue", "proposeReorderValues", "proposeRemoveValue"]) {
      const start = actionsCode.indexOf(`function ${fn}`);
      const rest = actionsCode.slice(start + 1);
      const nextRel = rest.indexOf("export async function");
      const body = nextRel === -1 ? rest : rest.slice(0, nextRel);
      expect(body, `${fn} must not insert vlc_value`).not.toMatch(/insert\(vlcValue\)/);
      expect(body, `${fn} must not update vlc_value`).not.toMatch(/update\(vlcValue\)/);
      expect(body, `${fn} must not insert vlc_session_template`).not.toMatch(/insert\(vlcSessionTemplate\)/);
    }
  });
});

// ── #296-C · approve applies each op — the ATOMIC REORDER renumber (pure, collision-proven) ──────────
/** Simulate the two-step renumber against a non-deferrable UNIQUE(ordinal): assert no two ids ever share
 * an ordinal at ANY step (which a naive in-place swap WOULD hit). */
function simulateRenumber(current: Map<string, number>, order: string[], archived: string[]) {
  const maxOrdinal = Math.max(...current.values());
  const { shift, placements } = planReorder(order, archived, maxOrdinal);
  const live = new Map(current);
  // step 1 — blanket constant shift (bijection; must stay collision-free)
  for (const [id, o] of live) live.set(id, o + shift);
  assertNoDup(live, "after evacuate");
  // step 2 — place each row at its final ordinal, one at a time
  for (const p of placements) {
    live.set(p.id, p.ordinal);
    assertNoDup(live, `after placing ${p.id}`);
  }
  return live;
}
function assertNoDup(m: Map<string, number>, where: string) {
  const vals = [...m.values()];
  expect(new Set(vals).size, `duplicate ordinal ${where}`).toBe(vals.length);
}

describe("#296-C · REORDER renumbers atomically with no UNIQUE(ordinal) collision", () => {
  it("swapping two adjacent ordinals never collides mid-renumber (the naive-swap hazard)", () => {
    const final = simulateRenumber(new Map([["A", 1], ["B", 2]]), ["B", "A"], []);
    expect(final.get("B")).toBe(1);
    expect(final.get("A")).toBe(2);
  });
  it("a full reversal renumbers to a clean 1..n with no collision", () => {
    const cur = new Map([["A", 1], ["B", 2], ["C", 3], ["D", 4]]);
    const final = simulateRenumber(cur, ["D", "C", "B", "A"], []);
    expect(final.get("D")).toBe(1);
    expect(final.get("A")).toBe(4);
    expect([...final.values()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });
  it("archived rows are compacted at the tail and never collide with the active finals", () => {
    // C archived at ordinal 2 (a hole among active A@1,B@3). Reorder active to [B,A].
    const cur = new Map([["A", 1], ["C", 2], ["B", 3]]);
    const final = simulateRenumber(cur, ["B", "A"], ["C"]);
    expect(final.get("B")).toBe(1);
    expect(final.get("A")).toBe(2);
    expect(final.get("C")).toBe(3); // archived, pushed past the active finals
  });
  it("the plan's placements are exactly the permutation 1..(n+a)", () => {
    const { placements } = planReorder(["x", "y", "z"], ["g1", "g2"], 9);
    expect(placements.map((p) => p.ordinal).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(placements.find((p) => p.id === "x")?.ordinal).toBe(1);
  });
  it("the evacuate shift lifts the temp range strictly above every final target", () => {
    const { shift, placements } = planReorder(["a", "b"], ["c"], 3);
    const maxFinal = Math.max(...placements.map((p) => p.ordinal));
    expect(1 + shift).toBeGreaterThan(maxFinal); // min possible temp ordinal > max final
  });
});

// ── #296-C2 · REMOVE is a soft-archive — NEVER a delete (mutation: a hard delete must red) ────────────
describe("#296-C2 · REMOVE soft-archives (active=false); it never deletes the cascade chain", () => {
  it("applyRemove sets active:false and the actions file issues NO delete on vlc_value", () => {
    expect(actionsCode).toMatch(/applyRemove[\s\S]*set\(\{\s*active:\s*false/);
    // A hard delete would CASCADE value → template → session → attendance and destroy history.
    expect(actionsCode).not.toMatch(/\.delete\(/);
  });
  it("the reader filters active=true, so a soft-archived value drops out of the setup surface", () => {
    expect(setupData).toMatch(/eq\(vlcValue\.active,\s*true\)/);
  });
});

// ── #296-D · inert-until-approved — the operational reader never reads the change-request table ───────
describe("#296-D · a PROPOSED change is invisible to getVlcSetup until approved", () => {
  it("getVlcSetup / setup-data does NOT query vlc_value_change_request", () => {
    expect(setupData).not.toContain("vlcValueChangeRequest");
    expect(setupData).not.toContain("change_request");
  });
  it("the change-request table is read ONLY by the dedicated pending reader (the approval queue)", () => {
    expect(pendingData).toContain("vlcValueChangeRequest");
    expect(pendingData).toMatch(/state,\s*"PROPOSED"|"PROPOSED"/);
  });
});

// ── #296-E · idempotent decide — an already-decided request is not re-applied ─────────────────────────
describe("#296-E · approve/reject are idempotent (locked, state-guarded, no re-apply)", () => {
  it("decide reads the request FOR UPDATE and short-circuits when state !== PROPOSED", () => {
    expect(actionsCode).toMatch(/\.for\("update"\)/);
    expect(actionsCode).toMatch(/state !== "PROPOSED"/);
  });
  it("apply happens only AFTER the PROPOSED guard, and stale/invalid apply leaves state unchanged", () => {
    const approve = actionsCode.slice(actionsCode.indexOf("function approveChangeRequest"));
    const guard = approve.indexOf('state !== "PROPOSED"');
    const apply = approve.indexOf("applyChange(");
    const setApproved = approve.indexOf('state: "APPROVED"');
    expect(guard).toBeGreaterThan(-1);
    expect(apply).toBeGreaterThan(guard); // apply is gated behind the idempotency guard
    expect(setApproved).toBeGreaterThan(apply); // state flips only after a successful apply
    expect(approve).toMatch(/if \(!applied\.ok\) return applied/); // invalid apply → no state change
  });
});

// ── #296-F · tenant scope — every action write goes through withSchool + eq(schoolId) ────────────────
describe("#296-F · tenant isolation — all writes are withSchool + school-scoped", () => {
  it("every action runs inside withSchool and filters by schoolId", () => {
    for (const fn of [
      "proposeAddValue",
      "proposeReorderValues",
      "proposeRemoveValue",
      "approveChangeRequest",
      "rejectChangeRequest",
    ]) {
      const body = actionsCode.slice(actionsCode.indexOf(`function ${fn}`), actionsCode.indexOf(`function ${fn}`) + 1600);
      expect(body, `${fn} must be tenant-scoped`).toMatch(/withSchool\(|insertRequest\(gate/);
    }
    // The change-request table is only ever queried with a school_id equality.
    expect(actionsCode).toMatch(/vlcValueChangeRequest\.schoolId/);
  });
  it("the new audit entity is classified SHOWN (operational — no pastoral PII)", () => {
    expect(SHOWN_AUDIT_ENTITIES.has("vlc_value_change_request")).toBe(true);
    expect(isRedactedAuditEntity("vlc_value_change_request")).toBe(false);
  });
});

// ── #296-G · reader-switch — stored columns, not the deleted ordinal map ──────────────────────────────
describe("#296-G · the reader reads STORED descriptor/is_capstone, not VLC_VALUE_BY_ORDINAL", () => {
  it("setup-data selects vlcValue.descriptor + vlcValue.isCapstone and no longer keys by ordinal", () => {
    expect(setupData).toMatch(/descriptor:\s*vlcValue\.descriptor/);
    expect(setupData).toMatch(/isCapstone:\s*vlcValue\.isCapstone/);
    expect(setupData).not.toContain("VLC_VALUE_BY_ORDINAL");
  });
  it("VLC_VALUE_BY_ORDINAL is deleted from defaults (the ordinal-key trap is gone)", () => {
    expect(defaults).not.toContain("export const VLC_VALUE_BY_ORDINAL");
  });
});

// ── #296-H · payload validation caps + reorder set-equality + preview strings ─────────────────────────
describe("#296-H · payload schemas + validators + preview", () => {
  it("ADD caps mirror the rename/prompt actions (nameEn≤80, descriptor≤120, session title≤120/prompt≤240)", () => {
    expect(AddValuePayloadSchema.safeParse({
      nameEn: "x".repeat(81), termGroup: 1, capstone: false,
      sessionA: { title: "a" }, sessionB: { title: "b" },
    }).success).toBe(false);
    const ok = AddValuePayloadSchema.safeParse({
      nameEn: "Gratitude", nameTwi: "Aseda", descriptor: "thankfulness", termGroup: 2, capstone: false,
      sessionA: { title: "What we are given", prompt: "noticing" },
      sessionB: { title: "Saying thank you", prompt: "in practice" },
    });
    expect(ok.success).toBe(true);
    expect(AddValuePayloadSchema.safeParse({
      nameEn: "V", termGroup: 4, capstone: false, sessionA: { title: "a" }, sessionB: { title: "b" },
    }).success).toBe(false); // termGroup out of 1..3
  });
  it("REORDER/REMOVE payloads require uuids", () => {
    expect(ReorderPayloadSchema.safeParse({ order: ["not-a-uuid"] }).success).toBe(false);
    expect(RemovePayloadSchema.safeParse({ valueId: "nope" }).success).toBe(false);
  });
  it("validateReorderOrder demands a permutation of the active set", () => {
    const a = "11111111-1111-1111-1111-111111111111";
    const b = "22222222-2222-2222-2222-222222222222";
    const c = "33333333-3333-3333-3333-333333333333";
    expect(validateReorderOrder([b, a], [a, b])).toBeNull();
    expect(validateReorderOrder([a], [a, b])).not.toBeNull(); // wrong length
    expect(validateReorderOrder([a, c], [a, b])).not.toBeNull(); // unknown id
    expect(validateReorderOrder([a, a], [a, b])).not.toBeNull(); // duplicate
  });
  it("previewChange renders neutral titles per op", () => {
    const names = new Map([["v1", "Respect"]]);
    expect(previewChange("ADD", { nameEn: "Gratitude", capstone: true }, names).title).toBe("Add value: Gratitude");
    expect(previewChange("REORDER", { order: ["v1"] }, names).title).toBe("Reorder 1 values");
    expect(previewChange("REMOVE", { valueId: "v1" }, names).title).toBe("Remove value: Respect");
  });
});
