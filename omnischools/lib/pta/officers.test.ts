import { describe, it, expect } from "vitest";
import {
  coalesceExOfficio,
  exOfficioSlotOffice,
  composeMatrix,
  assignmentOfficeError,
  holderError,
  addYearsISO,
  EX_OFFICIO_DEFAULTS,
  type PtaComposeInput,
  type StoredOfficer,
  type EndedOfficer,
} from "./officers";

/**
 * INCR-51 (R424/R425) — the PURE ex-officio derivation + matrix compose. No DB. Proves the honesty
 * rules the surface depends on: 0 stored rows → honest all-vacant (never a fabricated holder), the
 * ex-officio Secretary derives + counts as FILLED, the Headmaster appends (excluded from completion),
 * VACANT electable offices carry the previous holder, and the multi-hat spotlight is derived.
 */

const TODAY = "2026-05-01";

// ── coalesce (the spine seeds tier_settings as `{}`) ──
describe("coalesceExOfficio — the {} spine defaults", () => {
  it("coalesces the three keys to HEADMASTER / Secretary / 2", () => {
    expect(coalesceExOfficio({})).toEqual(EX_OFFICIO_DEFAULTS);
    expect(coalesceExOfficio(null)).toEqual(EX_OFFICIO_DEFAULTS);
  });
  it("honours a configured override", () => {
    expect(coalesceExOfficio({ headmaster_role: "PRINCIPAL", ex_officio_office: "Scribe", officer_term_years: "3" })).toEqual(
      { headmasterRole: "PRINCIPAL", exOfficioOffice: "Scribe", officerTermYears: 3 },
    );
  });
  it("rejects a non-positive / non-numeric term-years back to 2", () => {
    expect(coalesceExOfficio({ officer_term_years: "0" }).officerTermYears).toBe(2);
    expect(coalesceExOfficio({ officer_term_years: "abc" }).officerTermYears).toBe(2);
  });
});

describe("exOfficioSlotOffice — only FORM/HOUSE occupy a slot", () => {
  it("FORM & HOUSE Secretary is ex-officio-occupied; GENERAL/EMERGENCY are not", () => {
    expect(exOfficioSlotOffice("FORM", {})).toBe("Secretary");
    expect(exOfficioSlotOffice("HOUSE", {})).toBe("Secretary");
    expect(exOfficioSlotOffice("GENERAL", {})).toBeNull();
    expect(exOfficioSlotOffice("EMERGENCY", {})).toBeNull();
  });
});

// ── compose fixtures ──
const mkForm = (over: Partial<PtaComposeInput> = {}): PtaComposeInput => ({
  id: "form1",
  tierType: "FORM",
  label: "Form 2 GA A PTA",
  scopeBadge: "32 students",
  officerRoles: ["Chair", "Vice", "Secretary", "Treasurer"],
  tierSettings: {},
  exOfficioSecretaryName: "Mr A. Mensah",
  headmasterNames: [],
  ...over,
});
const mkGeneral = (over: Partial<PtaComposeInput> = {}): PtaComposeInput => ({
  id: "gen1",
  tierType: "GENERAL",
  label: "General PTA",
  scopeBadge: null,
  officerRoles: ["Chair", "Vice", "Secretary", "Treasurer"],
  tierSettings: {},
  exOfficioSecretaryName: null,
  headmasterNames: ["Rev Dr James Otoo"],
  ...over,
});

describe("composeMatrix — honesty (R425)", () => {
  it("0 stored officers ⇒ honest all-vacant, but the ex-officio Secretary still derives + counts filled", () => {
    const { forms } = composeMatrix([mkForm()], [], [], TODAY);
    const card = forms[0];
    const byOffice = new Map(card.rows.map((r) => [r.office, r]));
    expect(byOffice.get("Chair")?.kind).toBe("VACANT");
    expect(byOffice.get("Secretary")?.kind).toBe("EX_OFFICIO");
    expect(byOffice.get("Secretary")?.holderName).toBe("Mr A. Mensah");
    expect(byOffice.get("Secretary")?.assignable).toBe(false); // read-only, never assignable
    // 4 offices, only the ex-officio Secretary is filled ⇒ 1/4 (the D1 fix: ex-officio counts filled).
    expect(card.filled).toBe(1);
    expect(card.total).toBe(4);
    // the office picker excludes the ex-officio Secretary.
    expect(card.assignableOffices).toEqual(["Chair", "Vice", "Treasurer"]);
  });

  it("a Form with no class teacher shows a derived vacant ex-officio Secretary (not assignable, not filled)", () => {
    const { forms } = composeMatrix([mkForm({ exOfficioSecretaryName: null })], [], [], TODAY);
    const sec = forms[0].rows.find((r) => r.office === "Secretary")!;
    expect(sec.kind).toBe("EX_OFFICIO_VACANT");
    expect(sec.assignable).toBe(false);
    expect(forms[0].filled).toBe(0);
  });

  it("NEVER fabricates a holder for a stored office (a VACANT carries the previous holder)", () => {
    const ended: EndedOfficer[] = [
      { ptaId: "form1", office: "Chair", holderName: "Mr Nkrumah", endedAt: "2026-03-12", endReason: "relocated" },
    ];
    const { forms } = composeMatrix([mkForm()], [], ended, TODAY);
    const chair = forms[0].rows.find((r) => r.office === "Chair")!;
    expect(chair.kind).toBe("VACANT");
    expect(chair.holderName).toBeNull();
    expect(chair.previousHolder).toBe("Mr Nkrumah");
    expect(chair.vacantSince).toBe("12 Mar 2026");
    expect(chair.vacantReason).toBe("relocated");
  });
});

describe("composeMatrix — General appends the Headmaster (excluded from completion)", () => {
  it("the Headmaster is an APPENDED_EX row, not one of the 4 completion offices", () => {
    const stored: StoredOfficer[] = [
      s("gen1", "Chair", "u-chair"),
      s("gen1", "Vice", "u-vice"),
      s("gen1", "Secretary", "u-sec"),
      s("gen1", "Treasurer", "u-treas"),
    ];
    const { general } = composeMatrix([mkGeneral()], stored, [], TODAY);
    expect(general).not.toBeNull();
    const hm = general!.rows.find((r) => r.kind === "APPENDED_EX")!;
    expect(hm.office).toBe("Headmaster");
    expect(hm.holderName).toBe("Rev Dr James Otoo");
    expect(hm.assignable).toBe(false);
    // General's Secretary is electable here (only FORM/HOUSE occupy the slot).
    expect(general!.assignableOffices).toContain("Secretary");
    expect(general!.filled).toBe(4); // all 4 elected filled; the appended HM is not counted
    expect(general!.total).toBe(4);
  });

  it("no Headmaster in post ⇒ a single derived vacant appended row (honest, not fabricated)", () => {
    const { general } = composeMatrix([mkGeneral({ headmasterNames: [] })], [], [], TODAY);
    const hm = general!.rows.find((r) => r.kind === "APPENDED_EX")!;
    expect(hm.holderName).toBeNull();
  });
});

describe("composeMatrix — multi-hat spotlight + term warning", () => {
  it("a person with ≥2 current offices surfaces; a single-office person does not; the tag counts others", () => {
    const stored: StoredOfficer[] = [
      s("gen1", "Treasurer", "vivian", { holderName: "Mrs Vivian Asare", personType: "parent" }),
      s("house1", "Vice", "vivian", { holderName: "Mrs Vivian Asare", personType: "parent" }),
      s("gen1", "Chair", "solo", { holderName: "Mr Solo", personType: "parent" }),
    ];
    const houseCard = mkGeneral({ id: "house1", tierType: "HOUSE", label: "Aryee House PTA", exOfficioSecretaryName: "Mr K. Mensah", headmasterNames: [] });
    const { multiHat, general: gen } = composeMatrix([mkGeneral(), houseCard], stored, [], TODAY);
    expect(multiHat).toHaveLength(1);
    expect(multiHat[0].name).toBe("Mrs Vivian Asare");
    expect(multiHat[0].hats).toHaveLength(2);
    // the "+1 other PTA roles" tag on Vivian's General Treasurer row
    const treas = gen!.rows.find((r) => r.office === "Treasurer")!;
    expect(treas.otherHatCount).toBe(1);
    // Solo (one office) never surfaces + carries no tag
    const chair = gen!.rows.find((r) => r.office === "Chair")!;
    expect(chair.otherHatCount).toBe(0);
  });

  it("flags a term ending in <30 days", () => {
    const soon = s("gen1", "Chair", "u1", { termEnd: "2026-05-20" }); // 19 days out
    const far = s("gen1", "Vice", "u2", { termEnd: "2027-05-20" });
    const { general: gen } = composeMatrix([mkGeneral()], [soon, far], [], TODAY);
    expect(gen!.rows.find((r) => r.office === "Chair")!.termEndingSoon).toBe(true);
    expect(gen!.rows.find((r) => r.office === "Vice")!.termEndingSoon).toBe(false);
  });
});

describe("assignmentOfficeError (R420/R424) — the assign-time office guard", () => {
  const roles = ["Chair", "Vice", "Secretary", "Treasurer"];
  it("rejects an office not in officer_roles", () => {
    expect(assignmentOfficeError({ office: "Sports Master", officerRoles: roles, exOfficioSlot: "Secretary" })).toMatch(/isn't one of/i);
  });
  it("🔴 rejects the ex-officio slot (Form/House Secretary is derived, never assignable)", () => {
    expect(assignmentOfficeError({ office: "Secretary", officerRoles: roles, exOfficioSlot: "Secretary" })).toMatch(/ex-officio/i);
  });
  it("admits an electable office; admits General's Secretary (exOfficioSlot null)", () => {
    expect(assignmentOfficeError({ office: "Treasurer", officerRoles: roles, exOfficioSlot: "Secretary" })).toBeNull();
    expect(assignmentOfficeError({ office: "Secretary", officerRoles: roles, exOfficioSlot: null })).toBeNull();
  });
});

describe("holderError (R419) — exactly one holder", () => {
  it("rejects neither and both", () => {
    expect(holderError(null, null)).toMatch(/exactly one/i);
    expect(holderError("u1", "Mr External")).toMatch(/exactly one/i);
    expect(holderError("u1", "   ")).toBeNull(); // whitespace external ⇒ treated as absent, person wins
  });
  it("admits exactly one", () => {
    expect(holderError("u1", null)).toBeNull();
    expect(holderError(null, "Mr BOG Member")).toBeNull();
  });
});

describe("addYearsISO (R422) — ELECTED term auto-calc", () => {
  it("adds the tier's term years to the start date", () => {
    expect(addYearsISO("2026-05-15", 2)).toBe("2028-05-15");
    expect(addYearsISO("2025-10-14", 2)).toBe("2027-10-14");
  });
});

function s(
  ptaId: string,
  office: string,
  personUserId: string | null,
  over: Partial<StoredOfficer> = {},
): StoredOfficer {
  return {
    id: `${ptaId}-${office}`,
    ptaId,
    office,
    personUserId,
    holderName: over.holderName ?? "Someone",
    personType: over.personType ?? "parent",
    assignmentBasis: over.assignmentBasis ?? "ELECTED",
    electionRef: over.electionRef ?? "AGM 2025 minute 3.2",
    termStart: over.termStart ?? "2025-10-14",
    termEnd: over.termEnd === undefined ? "2027-10-12" : over.termEnd,
    ...over,
  };
}
