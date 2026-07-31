import { describe, it, expect } from "vitest";
import {
  coalescePtaTiers,
  reconcilePtas,
  PTA_TIER_TYPES,
  type ExistingPta,
  type PtaOp,
  type PtaScope,
  type PtaTierActive,
} from "./defaults";
import { PTA_CONFIG_WRITE_ROLES } from "@/lib/access";

// ---------------------------------------------------------------------------
// coalescePtaTiers (R417) — an unconfigured school never nulls/throws.
// ---------------------------------------------------------------------------

describe("coalescePtaTiers (R417 defaults)", () => {
  it("a MISSING config → the four frozen tiers, configured:false, never null/throw", () => {
    const tiers = coalescePtaTiers(null);
    expect(tiers.map((t) => t.tierType)).toEqual([...PTA_TIER_TYPES]);
    for (const t of tiers) expect(t.configured).toBe(false);

    const form = tiers.find((t) => t.tierType === "FORM")!;
    expect(form).toMatchObject({ active: true, duesEnabled: true, duesBasis: "PER_STUDENT", duesCadence: "PER_TERM" });

    const house = tiers.find((t) => t.tierType === "HOUSE")!;
    expect(house).toMatchObject({ active: true, duesEnabled: false });

    const general = tiers.find((t) => t.tierType === "GENERAL")!;
    expect(general).toMatchObject({ active: true, duesEnabled: true, duesBasis: "PER_FAMILY", duesCadence: "PER_YEAR" });

    const emergency = tiers.find((t) => t.tierType === "EMERGENCY")!;
    expect(emergency.duesEnabled).toBe(false);
    expect(emergency.officerRoles).toEqual([]); // R414 — no standing officers
  });

  it("reads a stored row, coercing numeric() dues + jsonb officer list, and honours configured_at", () => {
    const [form] = coalescePtaTiers([
      {
        tierType: "FORM",
        active: false,
        frequencyNorm: "Monthly",
        officerRoles: ["Chair", "Secretary"],
        quorumRule: "Half + one",
        duesEnabled: true,
        duesAmount: "75.00",
        duesBasis: "PER_STUDENT",
        duesCadence: "PER_TERM",
        tierSettings: { membershipBasis: "one-parent" },
        configuredAt: new Date(),
      },
    ]);
    expect(form.active).toBe(false);
    expect(form.configured).toBe(true);
    expect(form.duesAmount).toBe(75);
    expect(form.officerRoles).toEqual(["Chair", "Secretary"]);
    expect(form.tierSettings).toEqual({ membershipBasis: "one-parent" });
  });
});

// ---------------------------------------------------------------------------
// reconcilePtas (R411/R412) — the idempotency crux.
// ---------------------------------------------------------------------------

/** Apply an op set to an existing-state list, mirroring what lib/actions/pta.ts writes to the DB. */
function apply(existing: ExistingPta[], ops: PtaOp[]): ExistingPta[] {
  const byKey = new Map(existing.map((e) => [`${e.tierType}|${e.classId ?? ""}|${e.houseId ?? ""}`, { ...e }]));
  for (const op of ops) {
    const k = `${op.tierType}|${op.classId ?? ""}|${op.houseId ?? ""}`;
    if (op.action === "insert") {
      byKey.set(k, { tierType: op.tierType, classId: op.classId, houseId: op.houseId, status: "ACTIVE" });
    } else if (op.action === "reopen") {
      const row = byKey.get(k);
      if (row) row.status = "ACTIVE";
    } else {
      const row = byKey.get(k);
      if (row) row.status = "CLOSED";
    }
  }
  return [...byKey.values()];
}

const ALL_ON: PtaTierActive[] = PTA_TIER_TYPES.map((tierType) => ({ tierType, active: true }));
const classes: PtaScope[] = [{ id: "c1" }, { id: "c2" }, { id: "c3" }];
const houses: PtaScope[] = [{ id: "h1" }, { id: "h2" }];

describe("reconcilePtas (R411/R412)", () => {
  it("fresh school: N Form + M House + 1 General + 0 Emergency", () => {
    const ops = reconcilePtas(ALL_ON, classes, houses, []);
    const inserts = ops.filter((o) => o.action === "insert");
    expect(inserts.filter((o) => o.tierType === "FORM")).toHaveLength(3);
    expect(inserts.filter((o) => o.tierType === "HOUSE")).toHaveLength(2);
    expect(inserts.filter((o) => o.tierType === "GENERAL")).toHaveLength(1);
    expect(inserts.filter((o) => o.tierType === "EMERGENCY")).toHaveLength(0);
    expect(ops).toHaveLength(6);
  });

  it("is IDEMPOTENT — re-running against the resulting state yields ZERO ops", () => {
    const first = reconcilePtas(ALL_ON, classes, houses, []);
    const state = apply([], first);
    const second = reconcilePtas(ALL_ON, classes, houses, state);
    expect(second).toEqual([]);
  });

  it("adding one class yields EXACTLY +1 Form (no other change)", () => {
    const state = apply([], reconcilePtas(ALL_ON, classes, houses, []));
    const ops = reconcilePtas(ALL_ON, [...classes, { id: "c4" }], houses, state);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ tierType: "FORM", classId: "c4", action: "insert" });
  });

  it("the General singleton is NEVER duplicated (one row for any number of runs)", () => {
    let state = apply([], reconcilePtas(ALL_ON, classes, houses, []));
    state = apply(state, reconcilePtas(ALL_ON, classes, houses, state));
    expect(state.filter((e) => e.tierType === "GENERAL")).toHaveLength(1);
  });

  it("an inactive class → its Form PTA CLOSED; reactivating → the SAME row REOPENED", () => {
    const state = apply([], reconcilePtas(ALL_ON, classes, houses, []));
    // c3 goes inactive
    const closeOps = reconcilePtas(ALL_ON, [{ id: "c1" }, { id: "c2" }], houses, state);
    expect(closeOps).toEqual([{ tierType: "FORM", classId: "c3", houseId: null, action: "close" }]);
    const closed = apply(state, closeOps);
    expect(closed.find((e) => e.classId === "c3")!.status).toBe("CLOSED");

    // c3 comes back — reopen the same row, no new insert.
    const reopenOps = reconcilePtas(ALL_ON, classes, houses, closed);
    expect(reopenOps).toEqual([{ tierType: "FORM", classId: "c3", houseId: null, action: "reopen" }]);
    const reopened = apply(closed, reopenOps);
    expect(reopened.filter((e) => e.tierType === "FORM")).toHaveLength(3); // still 3, not 4
  });

  it("a tier toggled OFF closes its instances; toggled back ON reopens them", () => {
    const state = apply([], reconcilePtas(ALL_ON, classes, houses, []));
    const houseOff: PtaTierActive[] = ALL_ON.map((t) =>
      t.tierType === "HOUSE" ? { ...t, active: false } : t,
    );
    const offOps = reconcilePtas(houseOff, classes, houses, state);
    expect(offOps.every((o) => o.action === "close" && o.tierType === "HOUSE")).toBe(true);
    expect(offOps).toHaveLength(2);
    const closed = apply(state, offOps);
    const onOps = reconcilePtas(ALL_ON, classes, houses, closed);
    expect(onOps.every((o) => o.action === "reopen" && o.tierType === "HOUSE")).toBe(true);
  });
});

describe("PTA_CONFIG_WRITE_ROLES (R415)", () => {
  it("is exactly [ADMIN, HEADMASTER] — no PROPRIETOR, no new officer role", () => {
    expect([...PTA_CONFIG_WRITE_ROLES]).toEqual(["ADMIN", "HEADMASTER"]);
  });
});
