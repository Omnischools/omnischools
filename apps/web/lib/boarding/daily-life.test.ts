import { describe, it, expect } from "vitest";
import { CANONICAL_SCHEDULE_TEMPLATES, type ScheduleTemplate } from "./defaults";
import {
  resolveDayType,
  weekdayToken,
  buildTimeline,
  deriveF3Accent,
  policyHasDay,
  policyTimeRange,
  findingsSchema,
  computeAnomalies,
  computePrepSummary,
  isPrepExceptionStatus,
  offCampusBoarders,
  type PrepExceptionStatus,
} from "./daily-life";

const tpl = (dayType: string, formScope = "ALL"): ScheduleTemplate => {
  const t = CANONICAL_SCHEDULE_TEMPLATES.find(
    (x) => x.dayType === dayType && x.formScope === formScope,
  )!;
  return { dayType: t.dayType, formScope: t.formScope, activities: t.activities, active: true };
};
const WEEKDAY = tpl("WEEKDAY");
const WEEKDAY_F3 = tpl("WEEKDAY", "FORM_3");

// A Wednesday and a Saturday in UTC (2026-05-13 = Wed, 2026-05-16 = Sat, 2026-05-17 = Sun).
const WED = "2026-05-13";
const SAT = "2026-05-16";
const SUN = "2026-05-17";
/** now = the given UTC HH:MM on the WED date. */
const at = (h: number, m = 0) => new Date(`${WED}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);

describe("day-type + weekday (UTC)", () => {
  it("B1 · Wednesday→WEEKDAY, Saturday→SATURDAY", () => {
    expect(resolveDayType(WED, new Set())).toBe("WEEKDAY");
    expect(resolveDayType(SAT, new Set())).toBe("SATURDAY");
  });
  it("B2 · Sunday matching a VISITING event→VISITING_SUNDAY, else SUNDAY (T2)", () => {
    expect(resolveDayType(SUN, new Set())).toBe("SUNDAY");
    expect(resolveDayType(SUN, new Set([SUN]))).toBe("VISITING_SUNDAY");
  });
  it("weekday token is read in UTC", () => {
    expect(weekdayToken(WED)).toBe("Wed");
    expect(weekdayToken(SAT)).toBe("Sat");
  });
});

describe("A · timeline done/now/upcoming from the clock", () => {
  it("A1/A3 · siesta at 15:13 is NOW with 13 in / 47 left; earlier done; later upcoming", () => {
    const t = buildTimeline(WEEKDAY, WED, at(15, 13));
    const siesta = t.slots.find((s) => s.short === "Siesta")!;
    expect(siesta.state).toBe("now");
    expect(t.now?.minutesIn).toBe(13);
    expect(t.now?.minutesRemaining).toBe(47);
    expect(t.slots.find((s) => s.short === "Classes")!.state).toBe("done");
    expect(t.slots.find((s) => s.short === "Supper")!.state).toBe("upcoming");
    expect(t.live).toBe(true);
  });
  it("A2 · single-time lights-out is upcoming before, done after", () => {
    expect(buildTimeline(WEEKDAY, WED, at(20, 0)).slots.find((s) => s.short === "Lights out")!.state).toBe(
      "upcoming",
    );
    expect(buildTimeline(WEEKDAY, WED, at(23, 0)).slots.find((s) => s.short === "Lights out")!.state).toBe(
      "done",
    );
  });
  it("A4 · a gap between blocks → NOW=null, surfaces next + time-until", () => {
    // 06:50 assembly ends, 07:00 classes start → 06:55 falls in the gap.
    const t = buildTimeline(WEEKDAY, WED, at(6, 55));
    expect(t.now).toBeNull();
    expect(t.next?.short).toBe("Classes");
    expect(t.next?.minutesUntil).toBe(5);
  });
  it("A5 · before the first block → NOW=null, next is the first block", () => {
    const t = buildTimeline(WEEKDAY, WED, at(3, 0));
    expect(t.now).toBeNull();
    expect(t.next?.short).toBe("Rising");
    expect(t.slots.every((s) => s.state === "upcoming")).toBe(true);
  });
  it("A5/T3 · after lights-out (22:30 UTC) → all done, NOW=null, next=null", () => {
    const t = buildTimeline(WEEKDAY, WED, at(22, 30));
    expect(t.now).toBeNull();
    expect(t.next).toBeNull();
    expect(t.slots.every((s) => s.state === "done")).toBe(true);
  });
  it("a past date → all done + NOW=null; a future date → all upcoming + NOW=null (not live)", () => {
    const past = buildTimeline(WEEKDAY, "2026-05-12", at(15, 13));
    expect(past.now).toBeNull();
    expect(past.live).toBe(false);
    expect(past.slots.every((s) => s.state === "done")).toBe(true);
    const future = buildTimeline(WEEKDAY, "2026-05-14", at(15, 13));
    expect(future.now).toBeNull();
    expect(future.slots.every((s) => s.state === "upcoming")).toBe(true);
  });
});

describe("A7 · F3 prep-extension accent (delta, not a swap)", () => {
  it("returns the 22:00 vs 21:30 delta when a FORM_3 variant exists", () => {
    const a = deriveF3Accent(WEEKDAY, WEEKDAY_F3)!;
    expect(a.lightsOutAll).toBe("21:30");
    expect(a.lightsOutF3).toBe("22:00");
    expect(a.prepRange).toContain("21:40");
  });
  it("no FORM_3 variant → no accent", () => {
    expect(deriveF3Accent(WEEKDAY, null)).toBeNull();
  });
  it("identical lights-out → no accent", () => {
    expect(deriveF3Accent(WEEKDAY, WEEKDAY)).toBeNull();
  });
});

describe("A8 · scrubbing/washing weekday gating", () => {
  it("Wed=both, Tue=neither, Fri=washing only", () => {
    const scrub = "Wed 16:00 — 17:00";
    const wash = "Wed & Fri afternoons";
    expect(policyHasDay(scrub, "Wed") && policyHasDay(wash, "Wed")).toBe(true);
    expect(policyHasDay(scrub, "Tue") || policyHasDay(wash, "Tue")).toBe(false);
    expect(policyHasDay(scrub, "Fri")).toBe(false);
    expect(policyHasDay(wash, "Fri")).toBe(true);
  });
  it("extracts the time range fragment", () => {
    expect(policyTimeRange("Wed 16:00 — 17:00")).toBe("16:00 — 17:00");
  });
});

describe("C/D · findings Zod shapes discriminated by type", () => {
  const daily = {
    kind: "DAILY",
    checks: { bunks: "OK", lockers: "ISSUE", attire: "OK" },
    flaggedBunks: [6, 9, 13],
    notes: "spoken to",
  };
  const weekly = {
    kind: "WEEKLY",
    areas: [
      { area: "Washrooms", result: "ISSUE", note: "drains" },
      { area: "Drying lines", result: "OK" },
    ],
  };
  it("a DAILY payload validates as DAILY and computes anomalies (1 issue + 3 bunks = 4)", () => {
    const p = findingsSchema.parse(daily);
    expect(p.kind).toBe("DAILY");
    expect(computeAnomalies(p)).toBe(4);
  });
  it("a WEEKLY payload validates as WEEKLY and counts ISSUE areas (1)", () => {
    const p = findingsSchema.parse(weekly);
    expect(p.kind).toBe("WEEKLY");
    expect(computeAnomalies(p)).toBe(1);
  });
  it("a DAILY shape with WEEKLY fields is rejected (and vice-versa)", () => {
    expect(findingsSchema.safeParse({ kind: "DAILY", areas: [] }).success).toBe(false);
    expect(findingsSchema.safeParse({ kind: "WEEKLY", checks: {} }).success).toBe(false);
  });
  it("a clean DAILY has zero anomalies", () => {
    expect(
      computeAnomalies(
        findingsSchema.parse({ kind: "DAILY", checks: { bunks: "OK", lockers: "OK", attire: "OK" } }),
      ),
    ).toBe(0);
  });
});

describe("F · prep exception summary", () => {
  const boarders = [
    { id: "a", formLabel: "Form 1" },
    { id: "b", formLabel: "Form 1" },
    { id: "c", formLabel: "Form 2" },
    { id: "d", formLabel: "Form 3" },
    { id: "e", formLabel: "Form 3" },
  ];
  it("F1/F4 · no exceptions → present-by-default = roster; LATE still counts present", () => {
    const s = computePrepSummary(boarders, new Map([["a", "LATE"]]), new Set());
    expect(s.rosterCount).toBe(5);
    expect(s.present).toBe(5); // LATE counts present
    expect(s.late).toBe(1);
    expect(s.absent).toBe(0);
  });
  it("F4 · present = roster − ABSENT", () => {
    const s = computePrepSummary(boarders, new Map<string, PrepExceptionStatus>([["a", "ABSENT"]]), new Set());
    expect(s.present).toBe(4);
    expect(s.absent).toBe(1);
  });
  it("T5 · a boarder on a DEPARTED exeat is excluded from roster + auto-EXCUSED, never ABSENT", () => {
    const s = computePrepSummary(boarders, new Map(), new Set(["e"]));
    expect(s.rosterCount).toBe(4); // e excluded
    expect(s.onExeat).toBe(1);
    expect(s.excused).toBe(1); // auto-excused
    expect(s.absent).toBe(0);
    expect(s.byForm.find((f) => f.form === "Form 3")!.count).toBe(1); // only d remains in F3
  });
  it("per-form roster counts drive the prep rooms", () => {
    const s = computePrepSummary(boarders, new Map(), new Set());
    expect(s.byForm).toEqual([
      { form: "Form 1", count: 2 },
      { form: "Form 2", count: 1 },
      { form: "Form 3", count: 2 },
    ]);
  });
  it("only LATE/ABSENT/EXCUSED/MEDICAL are exception statuses (never PRESENT)", () => {
    expect(isPrepExceptionStatus("PRESENT")).toBe(false);
    expect(isPrepExceptionStatus("LATE")).toBe(true);
  });
});

// R225.1 (INCR-28a) — the in-House off-campus formula. `inHouse = boarders.length − offCampus.size`.
describe("🔴 R225.1 · offCampusBoarders — exeat ∪ referred-out, deduped, this-house only", () => {
  const boarders = new Set(["a", "b", "c", "d"]);
  const inHouse = (off: Set<string>) => boarders.size - off.size;

  // AC-R225-1 — the partition invariant holds for ANY inputs.
  it("AC-R225-1 · partition invariant: inHouse + offCampus.size === boarders.length", () => {
    const cases: [Set<string>, Set<string>][] = [
      [new Set(), new Set()],
      [new Set(["a"]), new Set(["b"])],
      [new Set(["a", "b"]), new Set(["a", "c"])], // overlap between the two arms
      [new Set(["a", "b", "c", "d"]), new Set(["a", "b", "c", "d"])], // everyone out
    ];
    for (const [exeat, referred] of cases) {
      const off = offCampusBoarders(boarders, exeat, referred);
      expect(inHouse(off) + off.size).toBe(boarders.size);
    }
  });

  // AC-R225-2 — a boarder on BOTH exeat AND referred-out subtracts exactly ONCE (SET union, not −size−size).
  it("AC-R225-2 · a doubly-out boarder subtracts once (never −size−size)", () => {
    const exeat = new Set(["a", "b"]); // 2 on exeat
    const referred = new Set(["b", "c"]); // b is BOTH; c is referral-only
    const off = offCampusBoarders(boarders, exeat, referred);
    expect(off).toEqual(new Set(["a", "b", "c"])); // 3 distinct, not 4
    expect(inHouse(off)).toBe(1); // d only — NOT 4 − 2 − 2 = 0
  });

  // AC-R225-3 — the school-wide referred-out set is intersected with THIS house's boarders.
  it("AC-R225-3 · a referred-out student of ANOTHER house / a day student is a no-op", () => {
    const exeat = new Set<string>();
    const referred = new Set(["x", "y", "a"]); // x,y belong to other houses; a is ours
    const off = offCampusBoarders(boarders, exeat, referred);
    expect(off).toEqual(new Set(["a"]));
    expect(inHouse(off)).toBe(3); // only `a` moved; x,y never touch this house's count
  });

  // AC-R225-4 — admissions are NEVER an input: an admitted boarder is not in either set, stays in-House.
  it("AC-R225-4 · sick-bay admissions are not passed in — in-House is unchanged by an admission", () => {
    // `d` is admitted to the sick bay but on NO exeat and NOT referred out → not in offCampus.
    const off = offCampusBoarders(boarders, new Set(), new Set());
    expect(off.has("d")).toBe(false);
    expect(inHouse(off)).toBe(4); // full house — the admission does not subtract
  });

  // AC-R225-8 — a Basic-tier / no-sickbay house: referredOut = ∅, so in-House == the exeat-only prior.
  it("AC-R225-8 · empty referred-out set reproduces the exeat-only in-House (no throw)", () => {
    const exeat = new Set(["a"]);
    const off = offCampusBoarders(boarders, exeat, new Set()); // ∅ referrals
    expect(off).toEqual(exeat);
    expect(inHouse(off)).toBe(boarders.size - exeat.size); // identical to the pre-28 formula
  });
});
