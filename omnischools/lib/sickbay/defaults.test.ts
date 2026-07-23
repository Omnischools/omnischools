import { describe, it, expect } from "vitest";
import {
  CANONICAL_SICKBAY_SLOTS,
  SICKBAY_MODE_CARDS,
  SICKBAY_POLICY_ANCHORS,
  canSaveMode,
  coalesceSickbayConfig,
  countBeds,
  formatDayType,
  formatTimeWindow,
  formLabel,
  initials,
  planBedReconcile,
  planScheduleReset,
  roundSchedule,
  sickbayCapabilities,
  sortSlots,
  splitBold,
  staffDesignation,
  validateRoundOrdering,
  type SickbayBed,
  type SickbaySlot,
} from "./defaults";
import { hasAnyRole, SICKBAY_ROLES, SICKBAY_CONFIG_WRITE_ROLES } from "@/lib/access";

/** The canonical 7 as the DB read would hand them back (row ids attached). */
const slots: SickbaySlot[] = CANONICAL_SICKBAY_SLOTS.map((s, i) => ({ ...s, id: `slot-${i + 1}` }));
/** The seeded inventory — 6 general (1–6) + 2 isolation (7–8). */
const beds: SickbayBed[] = [
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `bed-${i + 1}`,
    bedNumber: i + 1,
    isIsolation: false,
    active: true,
  })),
  { id: "bed-7", bedNumber: 7, isIsolation: true, active: true },
  { id: "bed-8", bedNumber: 8, isIsolation: true, active: true },
];
/** The anchor row id in the fixture (06:30 morning medication round). */
const ANCHOR = "slot-1";
/** The slot set AS IT WOULD BE after one edit — what the ordering rule is asked to judge. */
const patch = (id: string, fields: Partial<SickbaySlot>): SickbaySlot[] =>
  slots.map((s) => (s.id === id ? { ...s, ...fields } : s));

describe("A1–A3 · capabilities are DERIVED from mode, never stored", () => {
  it("A2 · FULL and FIRST_AID are capability-IDENTICAL", () => {
    expect(sickbayCapabilities("FULL")).toEqual(sickbayCapabilities("FIRST_AID"));
    // …and identical by reference: there is exactly one clinical capability object.
    expect(sickbayCapabilities("FULL")).toBe(sickbayCapabilities("FIRST_AID"));
    expect(Object.values(sickbayCapabilities("FULL")).every(Boolean)).toBe(true);
  });

  it("A3 · REFERRAL_ONLY disables on-site capacity and KEEPS the rest", () => {
    const c = sickbayCapabilities("REFERRAL_ONLY");
    for (const off of [
      "beds",
      "isolationBeds",
      "admissions",
      "scheduleSlots",
      "medicationRounds",
      "visitingDoctor",
      "standingOrders",
      "drugStock",
    ] as const) {
      expect(c[off], off).toBe(false);
    }
    for (const on of [
      "referrals",
      "chronicRegister",
      "parentNotifications",
      "healthPrefects",
    ] as const) {
      expect(c[on], on).toBe(true);
    }
  });

  it("A1 · capabilities are a pure function of mode — a config cannot carry a hand-set set", () => {
    const cfg = coalesceSickbayConfig("s1", {
      mode: "FIRST_AID",
      matronUserId: null,
      assistantMatronUserId: null,
      visitingDoctorName: null,
      visitingDoctorAffiliation: null,
      configuredAt: new Date(),
    });
    expect(cfg.capabilities).toBe(sickbayCapabilities("FIRST_AID"));
    // The frozen object cannot be mutated into a lie.
    expect(() => {
      "use strict";
      (cfg.capabilities as { beds: boolean }).beds = false;
    }).toThrow();
  });

  it("A4 · the mode percentages ship verbatim and do NOT sum to 100", () => {
    expect(SICKBAY_MODE_CARDS.map((m) => m.stat)).toEqual([
      "Typical for **Cat. A** schools · ~16% of public SHS",
      "Typical for **Cat. B–C** schools · ~30% of public SHS",
      "~59% of public SHS without sickbays use this",
    ]);
    expect(SICKBAY_MODE_CARDS.map((m) => m.mode)).toEqual(["FULL", "FIRST_AID", "REFERRAL_ONLY"]);
  });
});

describe("A5 · a missing settings row coalesces, never throws, never fabricates", () => {
  it("null → REFERRAL_ONLY · configured:false · no beds · zero counts", () => {
    const cfg = coalesceSickbayConfig("school-1", null);
    expect(cfg.mode).toBe("REFERRAL_ONLY");
    expect(cfg.configured).toBe(false);
    expect(cfg.beds).toEqual([]);
    expect(cfg.bedCounts).toEqual({ general: 0, isolation: 0, total: 0 });
    expect(cfg.matronUserId).toBeNull();
    expect(cfg.visitingDoctorName).toBeNull();
    expect(cfg.capabilities.beds).toBe(false);
  });

  it("undefined behaves identically; no field is ever undefined", () => {
    const cfg = coalesceSickbayConfig("school-1", undefined);
    expect(cfg).toEqual(coalesceSickbayConfig("school-1", null));
    expect(Object.values(cfg).every((v) => v !== undefined)).toBe(true);
  });

  // R25's whole point: "coalesced to REFERRAL_ONLY" ≠ "declared REFERRAL_ONLY". A save rule keyed on
  // dirtiness alone locks the ~49% of schools that really ARE Mode C out of ever declaring it —
  // `configured` would stay false forever and every increment gating on it reads the majority wrong.
  it("A5 · an UNCONFIGURED school can save the mode it already coalesces to", () => {
    expect(canSaveMode("REFERRAL_ONLY", "REFERRAL_ONLY", false)).toBe(true);
    expect(canSaveMode("FULL", "REFERRAL_ONLY", false)).toBe(true);
    // …and nothing is pre-selected for it, so it never renders as having chosen Mode C.
    expect(canSaveMode(null, "REFERRAL_ONLY", false)).toBe(false);
  });

  it("A5 · a CONFIGURED school saves only a real change", () => {
    expect(canSaveMode("REFERRAL_ONLY", "REFERRAL_ONLY", true)).toBe(false);
    expect(canSaveMode("FIRST_AID", "REFERRAL_ONLY", true)).toBe(true);
    expect(canSaveMode(null, "FULL", true)).toBe(false);
  });

  it("a row with mode but no configured_at is declared-but-unconfigured, not null", () => {
    const cfg = coalesceSickbayConfig("s", {
      mode: "FULL",
      matronUserId: null,
      assistantMatronUserId: null,
      visitingDoctorName: null,
      visitingDoctorAffiliation: null,
      configuredAt: null,
    });
    expect(cfg.mode).toBe("FULL");
    expect(cfg.configured).toBe(false);
  });
});

describe("B1 · bed counts derive from the ACTIVE rows — there is no stored scalar", () => {
  it("6 general + 2 isolation = 8 total", () => {
    expect(countBeds(beds)).toEqual({ general: 6, isolation: 2, total: 8 });
  });
  it("a retired bed leaves the counts but keeps its number", () => {
    const retired = beds.map((b) => (b.bedNumber === 4 ? { ...b, active: false } : b));
    expect(countBeds(retired)).toEqual({ general: 5, isolation: 2, total: 7 });
  });
});

describe("B4/B5 · capacity is a TARGET RECONCILE, never a delete", () => {
  it("B4 · retiring bed 4 then adding one yields bed 9, never a reused 4", () => {
    const retired = beds.map((b) => (b.bedNumber === 4 ? { ...b, active: false } : b));
    const plan = planBedReconcile(retired, { general: 6, isolation: 2 }, []);
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    expect(plan.insert).toEqual([{ bedNumber: 9, isIsolation: false }]);
    expect(plan.deactivate).toEqual([]);
  });

  // The MIDDLE-bed fixture above cannot tell "max over all beds" from "max over ACTIVE beds" — both
  // yield 9. Retiring the GLOBAL MAX is the discriminating case: counting only active beds would
  // hand back 8 and collide with the retired row's own number (uniq_sickbay_bed_number).
  it("B4 · retiring the HIGHEST bed still yields 9 — the number is never reused", () => {
    const retired = beds.map((b) => (b.bedNumber === 8 ? { ...b, active: false } : b));
    const plan = planBedReconcile(retired, { general: 6, isolation: 2 }, []);
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    expect(plan.insert).toEqual([{ bedNumber: 9, isIsolation: true }]);
  });

  it("B4 · retiring the top TWO yields 9 then 10, never 7 and 8 again", () => {
    const retired = beds.map((b) => (b.bedNumber >= 7 ? { ...b, active: false } : b));
    const plan = planBedReconcile(retired, { general: 6, isolation: 2 }, []);
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    expect(plan.insert).toEqual([
      { bedNumber: 9, isIsolation: true },
      { bedNumber: 10, isIsolation: true },
    ]);
  });

  it("an increase inserts max+1 upward, per pool, pools never merging", () => {
    const plan = planBedReconcile(beds, { general: 8, isolation: 3 }, []);
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    expect(plan.insert).toEqual([
      { bedNumber: 9, isIsolation: false },
      { bedNumber: 10, isIsolation: false },
      { bedNumber: 11, isIsolation: true },
    ]);
  });

  it("a decrease deactivates the HIGHEST-numbered unoccupied beds — never a hard delete", () => {
    const plan = planBedReconcile(beds, { general: 4, isolation: 2 }, []);
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    expect(plan.deactivate).toEqual(["bed-5", "bed-6"]);
    expect(plan.insert).toEqual([]);
  });

  it("B5 · an unreachable target rejects the WHOLE save with a named error, nothing applied", () => {
    // 4 of the 6 general beds occupied → reaching 2 would need 4 retirements but only 2 are free.
    const plan = planBedReconcile(beds, { general: 2, isolation: 2 }, [
      "bed-3",
      "bed-4",
      "bed-5",
      "bed-6",
    ]);
    expect("error" in plan).toBe(true);
    if (!("error" in plan)) return;
    expect(plan.error).toContain("Cannot reduce to 2 general beds");
    expect(plan.error).toContain("only 2 of the 6 are unoccupied");
    expect(plan.error).toContain("Nothing was saved");
    // No partial application: the caller gets an error, not a half-plan.
    expect(plan).not.toHaveProperty("insert");
  });

  it("a decrease skips OCCUPIED beds and retires the highest-numbered free ones instead", () => {
    // beds 5 and 6 are occupied → 6→4 retires beds 4 and 3, the highest-numbered UNOCCUPIED pair.
    const plan = planBedReconcile(beds, { general: 4, isolation: 2 }, ["bed-5", "bed-6"]);
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    expect(plan.deactivate).toEqual(["bed-3", "bed-4"]);
  });

  it("zero is a legal target — known-empty, not unknown", () => {
    const plan = planBedReconcile(beds, { general: 0, isolation: 0 }, []);
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    expect(plan.deactivate).toHaveLength(8);
  });
});

describe("C6/C7 · the day-type formatter reproduces all five surface labels", () => {
  it("C6 · the canonical 7 render exactly the surface's five strings", () => {
    expect(sortSlots(slots).map(formatDayType)).toEqual([
      "Every school day", // 06:30 morning round
      "Every school day", // 07:00 morning clinic
      "Mon · Tue · Wed · Thu · Fri", // 10:00 daytime clinic (literal weekdays)
      "Every school day", // 12:30 noon round
      "Thursdays", // 14:00 visiting doctor
      "Every day incl. weekend", // 21:00 evening round
      "Every day · 365", // 22:00 on-call
    ]);
  });

  it("C7 · `Thursdays` — a value boarding_day_type cannot express", () => {
    expect(formatDayType({ daysOfWeek: [4], runsOnHolidays: false, kind: "DOCTOR_VISIT" })).toBe(
      "Thursdays",
    );
    expect(formatDayType({ daysOfWeek: [7], runsOnHolidays: false, kind: "CLINIC" })).toBe("Sundays");
  });

  it("the label is never stored beside the set — the same set always yields the same string", () => {
    expect(formatDayType({ daysOfWeek: [5, 1, 3, 2, 4], runsOnHolidays: false, kind: "CLINIC" })).toBe(
      "Every school day",
    );
    expect(formatDayType({ daysOfWeek: [6, 7], runsOnHolidays: false, kind: "CLINIC" })).toBe(
      "Sat · Sun",
    );
    expect(formatDayType({ daysOfWeek: [], runsOnHolidays: false, kind: "CLINIC" })).toBe("Never");
  });
});

describe("C8 · the overnight slot wraps midnight and is VALID", () => {
  it("22:00 – 06:00 is stored and rendered as written (ends_at < starts_at)", () => {
    const onCall = slots.find((s) => s.kind === "ON_CALL")!;
    expect(onCall.startsAt).toBe("22:00");
    expect(onCall.endsAt).toBe("06:00");
    expect(onCall.endsAt < onCall.startsAt).toBe(true);
    expect(formatTimeWindow(onCall)).toBe("22:00 – 06:00");
  });
});

describe("C1–C5 · the canonical slot set and the anchor rules", () => {
  it("C1 · exactly the 7 rows of setup §02, verbatim, in surface order", () => {
    expect(sortSlots(slots).map((s) => `${s.startsAt} ${s.label}`)).toEqual([
      "06:30 Morning medication round",
      "07:00 Morning clinic",
      "10:00 Daytime clinic",
      "12:30 Noon medication round",
      "14:00 Visiting doctor",
      "21:00 Evening medication round",
      "22:00 On-call overnight",
    ]);
    expect(sortSlots(slots).map(formatTimeWindow)).toEqual([
      "06:30 – 07:00",
      "07:00 – 08:00",
      "10:00 – 17:00",
      "12:30 – 13:00",
      "14:00 – 17:00",
      "21:00 – 21:30",
      "22:00 – 06:00",
    ]);
  });

  it("C2 · the canonical medication rounds are THREE — 06:30 / 12:30 / 21:00, anchor first", () => {
    const rounds = roundSchedule(slots);
    expect(rounds.map((r) => r.startsAt)).toEqual(["06:30", "12:30", "21:00"]);
    expect(rounds[0].isAnchor).toBe(true);
  });

  it("C3 · exactly one anchor, and it is a MEDICATION_ROUND", () => {
    const anchors = slots.filter((s) => s.isAnchor);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].kind).toBe("MEDICATION_ROUND");
  });

  it("R24 · a round switched OFF is not in the round schedule — INCR-24 must not fire it", () => {
    const noonOff = patch("slot-4", { active: false });
    expect(roundSchedule(noonOff).map((r) => r.startsAt)).toEqual(["06:30", "21:00"]);
    // …and it is still in the stored set: deactivation is a render/fire gate, never a delete.
    expect(noonOff.filter((s) => s.kind === "MEDICATION_ROUND")).toHaveLength(3);
  });

  it("C4/C5 · the anchor's time is editable, but never later than another round", () => {
    expect(validateRoundOrdering(patch(ANCHOR, { startsAt: "05:45" }))).toBeNull();
    expect(validateRoundOrdering(patch(ANCHOR, { startsAt: "12:30" }))).toBeNull(); // equal is allowed
    const err = validateRoundOrdering(patch(ANCHOR, { startsAt: "13:00" }));
    expect(err).toContain("no later than every other medication round");
    expect(err).toContain("Noon medication round (12:30)");
  });

  // R16 is a property of the SET. These two paths reach the same broken state without touching the
  // anchor row, so a guard that only fires when the EDITED slot is the anchor lets both through.
  it("C5 · a NON-anchor round cannot be moved earlier than the anchor", () => {
    const err = validateRoundOrdering(patch("slot-4", { startsAt: "05:00" }));
    expect(err).toContain("no later than every other medication round");
    expect(err).toContain("Noon medication round (05:00)");
    expect(err).toContain("the anchor at 06:30");
    // A non-anchor round moved to a LATER time is fine, and so is a non-round moved anywhere.
    expect(validateRoundOrdering(patch("slot-4", { startsAt: "13:30" }))).toBeNull();
    expect(validateRoundOrdering(patch("slot-3", { startsAt: "05:00" }))).toBeNull(); // CLINIC
  });

  it("C5 · a round parked OFF earlier than the anchor cannot simply be switched back on", () => {
    // The headmaster's route around the guard: park the 06:45 round off, move the anchor to 07:00
    // (legal — the off round is ignored), then flip the round back on.
    const early: SickbaySlot = {
      ...slots[3],
      id: "slot-early",
      label: "Early medication round",
      startsAt: "06:45",
      endsAt: "07:15",
      active: false,
    };
    const parked = [...patch(ANCHOR, { startsAt: "07:00" }), early];
    expect(validateRoundOrdering(parked)).toBeNull(); // an inactive round does not constrain

    const switchedOn = parked.map((s) => (s.id === "slot-early" ? { ...s, active: true } : s));
    const err = validateRoundOrdering(switchedOn);
    expect(err).toContain("Early medication round (06:45)");
    expect(err).toContain("the anchor at 07:00");
  });

  it("no active anchor (Mode C, or every round off) is not an error", () => {
    expect(validateRoundOrdering([])).toBeNull();
    expect(validateRoundOrdering(patch(ANCHOR, { active: false }))).toBeNull();
  });

  it("staffing is free text and descriptions are stored (the handoff document)", () => {
    expect(slots.every((s) => s.description && s.description.length > 0)).toBe(true);
    expect(sortSlots(slots).map((s) => s.staffing)).toEqual([
      "Matron + Prefect",
      "Matron",
      "Matron",
      "Matron",
      "Doctor + Matron",
      "Matron or Asst.",
      "Asst. Matron",
    ]);
  });
});

describe("E1/E2 · the role gates", () => {
  it("MATRON reads the module but cannot write the config", () => {
    expect(hasAnyRole(["MATRON"], SICKBAY_ROLES)).toBe(true);
    expect(hasAnyRole(["MATRON"], SICKBAY_CONFIG_WRITE_ROLES)).toBe(false);
  });
  it("ADMIN and HEADMASTER read and write; HOUSEMASTER / TEACHER / PARENT reach neither", () => {
    for (const r of ["ADMIN", "HEADMASTER"]) {
      expect(hasAnyRole([r], SICKBAY_ROLES)).toBe(true);
      expect(hasAnyRole([r], SICKBAY_CONFIG_WRITE_ROLES)).toBe(true);
    }
    for (const r of ["HOUSEMASTER", "TEACHER", "PARENT", "STUDENT", "DEAN_OF_BOARDING"]) {
      expect(hasAnyRole([r], SICKBAY_ROLES), r).toBe(false);
      expect(hasAnyRole([r], SICKBAY_CONFIG_WRITE_ROLES), r).toBe(false);
    }
  });
});

describe("F1/F2 · the omitted strings appear NOWHERE in the shipped copy", () => {
  const corpus = JSON.stringify({
    slots: CANONICAL_SICKBAY_SLOTS,
    modes: SICKBAY_MODE_CARDS,
    anchors: SICKBAY_POLICY_ANCHORS,
  });
  const OMITTED = [
    "2.4",
    "3.1",
    "Adwoa Mensa",
    "since 09:14",
    "On shift",
    "Off · back 18:00",
    "11 years here",
    "Roster lead",
    "trained Feb 2026",
    "two-week rotation",
    "Currently occupied",
    "Avg. weekly load",
  ];
  it.each(OMITTED)("%s is absent from every constant", (s) => {
    expect(corpus).not.toContain(s);
  });
  it("the visiting doctor's name is NOT baked into the canonical slot description", () => {
    // The surface prints "Dr K. Mensah · admissions reviewed"; the name lives on the settings row
    // (visiting_doctor_name), so a school that renames its doctor does not carry a stale slot.
    expect(CANONICAL_SICKBAY_SLOTS.find((s) => s.kind === "DOCTOR_VISIT")!.description).toBe(
      "Admissions reviewed",
    );
  });
});

describe("render helpers", () => {
  it("E1 · Mode C renames the post but keeps the same pointer", () => {
    expect(staffDesignation("SENIOR_MATRON", "FIRST_AID")).toBe("Senior Matron");
    expect(staffDesignation("SENIOR_MATRON", "FULL")).toBe("Senior Matron");
    expect(staffDesignation("SENIOR_MATRON", "REFERRAL_ONLY")).toBe(
      "School Health Coordinator · SHEP",
    );
    expect(staffDesignation("VISITING_DOCTOR", "FIRST_AID")).toBe("Visiting doctor");
  });
  it("splitBold marks odd indices", () => {
    expect(splitBold("Typical for **Cat. A** schools")).toEqual([
      "Typical for ",
      "Cat. A",
      " schools",
    ]);
  });
  it("formLabel renders `F3 BUS` from level + programme, and degrades honestly", () => {
    expect(formLabel("Form 3", "Form 3 Business", "BUSINESS")).toBe("F3 BUS");
    expect(formLabel("Form 2", "Form 2 Science", "GENERAL_SCIENCE")).toBe("F2 SCI");
    expect(formLabel(null, "Form 1 Arts", null)).toBe("F1");
    expect(formLabel(null, null, null)).toBe("—");
  });
});

describe("avatar glyphs", () => {
  it("drops the honorific and uses first + surname initials", () => {
    expect(initials("Mrs Akua Bediako")).toBe("AB");
    expect(initials("Ms Grace Antwi")).toBe("GA");
    expect(initials("Dr K. Mensah")).toBe("KM");
    expect(initials("Madonna")).toBe("M");
    expect(initials("  ")).toBe("—");
  });
});

describe("R100 · Reset to defaults RECONCILES — slot ids are STABLE (AC E6)", () => {
  it("a canonical-shaped school → 7 UPDATEs, no insert, no delete, EVERY id kept", () => {
    // `slots` is the canonical 7 with ids slot-1…slot-7; a matron may have edited the times/labels.
    const edited = slots.map((s) =>
      s.isAnchor ? { ...s, startsAt: "05:45", label: "Early round" } : s,
    );
    const plan = planScheduleReset(edited);
    expect(plan.update.length).toBe(CANONICAL_SICKBAY_SLOTS.length);
    expect(plan.insert).toEqual([]);
    expect(plan.deleteIds).toEqual([]);
    // The ids that survive the reset are EXACTLY the ids that went in — nothing is re-created.
    const before = edited.map((s) => s.id).sort();
    const after = plan.update.map((u) => u.id).sort();
    expect(after).toEqual(before);
    // A dose pinned to the anchor's id keeps pointing at a MEDICATION_ROUND (never the doctor slot).
    const anchorId = edited.find((s) => s.isAnchor)!.id;
    const rehomed = plan.update.find((u) => u.id === anchorId)!;
    expect(rehomed.slot.kind).toBe("MEDICATION_ROUND");
    expect(rehomed.slot.isAnchor).toBe(true);
  });

  it("within-kind pairing: every existing MEDICATION_ROUND id is UPDATEd, never deleted-then-recreated", () => {
    const plan = planScheduleReset(slots);
    const medExistingIds = slots.filter((s) => s.kind === "MEDICATION_ROUND").map((s) => s.id);
    const medUpdatedIds = plan.update
      .filter((u) => u.slot.kind === "MEDICATION_ROUND")
      .map((u) => u.id);
    expect(medUpdatedIds.sort()).toEqual(medExistingIds.sort());
    expect(plan.deleteIds).toEqual([]);
  });

  it("an EMPTY school inserts the canonical 7 and updates/deletes nothing", () => {
    const plan = planScheduleReset([]);
    expect(plan.insert.length).toBe(CANONICAL_SICKBAY_SLOTS.length);
    expect(plan.update).toEqual([]);
    expect(plan.deleteIds).toEqual([]);
  });

  it("a surplus row of a kind is deleted; a missing kind is inserted", () => {
    // Drop the on-call row, add a spurious extra clinic (3 clinics vs canonical 2).
    const drifted: SickbaySlot[] = [
      ...slots.filter((s) => s.kind !== "ON_CALL"),
      { ...slots[1], id: "extra-clinic" },
    ];
    const plan = planScheduleReset(drifted);
    expect(plan.insert.some((s) => s.kind === "ON_CALL")).toBe(true); // the missing kind
    expect(plan.deleteIds).toContain("extra-clinic"); // the surplus clinic
  });
});
