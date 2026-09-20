import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";
import {
  SC12_TRIGGER_STATUSES,
  SC12_BANNER_STATUSES,
  sc12TriggerFires,
  sc12BannerRows,
  sc12FiledDate,
  type Sc12BannerInput,
} from "@/lib/wassce/sc12";

/**
 * INCR-28b · the WASSCE lane. Behavioural tests for the two PURE seams (R226 trigger gate + R227 banner
 * projection) plus SOURCE-SHAPE tripwires for everything a superuser DB cannot prove: the writer's
 * idempotent DRAFT-only ON CONFLICT DO NOTHING (never fileScForm), the best-effort-outside-tx invoke,
 * the untouched fileScForm gate, the parent DRAFT-hidden filter, the banner's zero clinical tokens, and
 * the deep-dive §7 STAYING OMITTED (R228).
 */

// ────────────────────────────── R226 · the auto-suggest trigger gate (pure) ──────────────────────────
describe("🔴 R226.1 · sc12TriggerFires — a live candidate with an upcoming paper, nothing else", () => {
  it("AC-R226-1 · REGISTERED/ACTIVE + an upcoming paper FIRES", () => {
    expect(sc12TriggerFires("REGISTERED", true)).toBe(true);
    expect(sc12TriggerFires("ACTIVE", true)).toBe(true);
  });

  it("AC-R226-2 · a past-only timetable (no upcoming paper) does NOT fire", () => {
    expect(sc12TriggerFires("REGISTERED", false)).toBe(false);
    expect(sc12TriggerFires("ACTIVE", false)).toBe(false);
  });

  it("AC-R226-3 · a non-live candidate (WITHDRAWN/COMPLETED) never fires, even with an upcoming paper", () => {
    expect(sc12TriggerFires("WITHDRAWN", true)).toBe(false);
    expect(sc12TriggerFires("COMPLETED", true)).toBe(false);
    // The trigger set is EXACTLY the two live statuses — a mutant adding WITHDRAWN reds here.
    expect([...SC12_TRIGGER_STATUSES].sort()).toEqual(["ACTIVE", "REGISTERED"]);
  });
});

// ────────────────────────────── R227 · the §4.2 banner projection (pure) ──────────────────────────────
const CLINICAL_KEYS = ["hospital", "diagnosis", "condition", "clinician", "ward", "bed", "malaria"];
const input = (over: Partial<Sc12BannerInput>): Sc12BannerInput => ({
  candidateName: "Y. Aidoo",
  indexNumber: "0184-0817",
  status: "FILED",
  waecRef: null,
  makeUpScheduledAt: null,
  makeUpCentre: null,
  filedAt: null,
  ...over,
});

describe("🔴 R227 · sc12BannerRows — live SC-12 only, zero clinical field", () => {
  it("AC-R227-3 · DRAFT and the terminal COMPLETED/REJECTED are excluded; the 4 live statuses pass", () => {
    const rows = sc12BannerRows([
      input({ status: "DRAFT" }),
      input({ status: "FILED" }),
      input({ status: "ACKNOWLEDGED" }),
      input({ status: "APPROVED" }),
      input({ status: "SCHEDULED" }),
      input({ status: "COMPLETED" }),
      input({ status: "REJECTED" }),
    ]);
    expect(rows.map((r) => r.statusLabel)).toEqual([
      "SC-12 filed",
      "SC-12 acknowledged",
      "SC-12 approved",
      "SC-12 make-up scheduled",
    ]);
    // The live-status set is exactly the four non-DRAFT, non-terminal states.
    expect([...SC12_BANNER_STATUSES]).toEqual(["FILED", "ACKNOWLEDGED", "APPROVED", "SCHEDULED"]);
  });

  it("AC-R227-5 · empty in → empty out (the caller then omits the banner entirely)", () => {
    expect(sc12BannerRows([])).toEqual([]);
    // A DRAFT-only school also produces nothing → banner omitted.
    expect(sc12BannerRows([input({ status: "DRAFT" })])).toEqual([]);
  });

  it("AC-R227-2 · a projected row carries EXACTLY the WAEC-workflow keys — no clinical key ever", () => {
    const [row] = sc12BannerRows([
      input({ status: "SCHEDULED", waecRef: "WR-99", makeUpCentre: "Asankrangwa SHS", makeUpScheduledAt: new Date("2026-06-01T09:00:00Z"), filedAt: new Date("2026-05-14T11:00:00Z") }),
    ]);
    expect(Object.keys(row).sort()).toEqual(
      ["candidateName", "filedDateLabel", "indexNumber", "makeUpLabel", "statusLabel", "waecRef"].sort(),
    );
    for (const k of CLINICAL_KEYS) expect(Object.keys(row)).not.toContain(k);
    // filed_at renders as a bare DATE, never a clock (R90) — no colon.
    expect(row.filedDateLabel).toBe("14 May 2026");
    expect(row.filedDateLabel).not.toContain(":");
    expect(row.makeUpLabel).toBe("Asankrangwa SHS · 1 Jun 2026");
    expect(row.waecRef).toBe("WR-99");
  });

  it("a bare FILED row (no ref/make-up/filed stamp) nulls its optional fields", () => {
    const [row] = sc12BannerRows([input({ status: "FILED" })]);
    expect(row).toMatchObject({ waecRef: null, makeUpLabel: null, filedDateLabel: null });
  });

  it("sc12FiledDate is the UTC civil date, dropping the clock", () => {
    expect(sc12FiledDate(new Date("2026-05-14T23:59:00Z"))).toBe("14 May 2026");
  });
});

// ────────────────────────────── R226 · the SYSTEM writer (source shape) ──────────────────────────────
const WRITER = "lib/sickbay/sc12-suggest.ts";
const writer = () => readCode(WRITER);

describe("🔴 R226 · sc12-suggest.ts — idempotent DRAFT-only, never fileScForm, no gate of its own", () => {
  it("AC-R226-11 · INSERT … ON CONFLICT DO NOTHING on (school_id, candidate_id, sc_form) — never DO UPDATE", () => {
    const s = writer();
    expect(s).toMatch(/\.onConflictDoNothing\(/);
    expect(s, "an UPDATE would downgrade a human FILED row to DRAFT").not.toMatch(/onConflictDoUpdate/);
    expect(s, "no update SET clause anywhere").not.toMatch(/\bset:\s*\{/);
    expect(s).toMatch(/target:\s*\[\s*[\s\S]*waecSpecialConsideration\.schoolId/);
    expect(s).toContain("waecSpecialConsideration.candidateId");
    expect(s).toContain("waecSpecialConsideration.scForm");
  });

  it("AC-R226-11 · does NOT import or call fileScForm (writes its own insert)", () => {
    expect(writer()).not.toMatch(/fileScForm/);
  });

  it("AC-R226-3 · the row is a bare DRAFT — status DRAFT, filed_at/filed_by NULL, no clinical field", () => {
    const s = writer();
    expect(s).toMatch(/status:\s*"DRAFT"/);
    expect(s).toMatch(/filedAt:\s*null/);
    expect(s).toMatch(/filedByUserId:\s*null/);
    // No clinical column is ever written onto the SC row.
    for (const t of ["hospital", "diagnosis", "workingImpression", "complaint", "malaria"]) {
      expect(s, `${t} must not appear on the SC row`).not.toContain(t);
    }
  });

  it("AC-R226-8 · issues NO WASSCE_SETUP_ROLES / role assertion — it rides the caller's MATRON authz", () => {
    const s = writer();
    expect(s).not.toMatch(/WASSCE_SETUP_ROLES/);
    expect(s).not.toMatch(/assertAnyRole/);
    expect(s).not.toMatch(/requireSchoolRole|requireSchool\b/);
  });

  it("opens its OWN withSchool (outside any clinical tx) and gates on the pure trigger", () => {
    const s = writer();
    expect(s).toMatch(/withSchool\(schoolId/);
    expect(s).toContain("sc12TriggerFires(");
    expect(s).toContain("wassceCandidates.candidateStatus");
    expect(s).toMatch(/gte\(\s*wasscePapers\.scheduledDate/);
  });
});

// ────────────────────────────── R226 · the best-effort invoke sites ──────────────────────────────────
const INVOKE_SITES = ["lib/actions/sickbay-referral.ts", "lib/actions/sickbay-visit.ts"];

describe("🔴 R226-7 · both R46 sites call the suggest BEST-EFFORT, OUTSIDE the clinical tx", () => {
  for (const path of INVOKE_SITES) {
    it(`${path} · wraps maybeSuggestSc12(schoolId, …) in try/catch and never rethrows`, () => {
      const s = readCode(path);
      // Called with a schoolId (so the writer opens its OWN connection) inside a try that swallows the throw.
      expect(s).toMatch(
        /try\s*\{\s*await maybeSuggestSc12\(auth\.schoolId,[^)]*\);\s*\}\s*catch/,
      );
      // The clinical Result is returned unconditionally — a suggest throw cannot turn it not-ok.
      expect(s).toMatch(/return \{ ok: true, id/);
      // The call passes a schoolId, never the clinical `tx` (never nested in the committed transaction).
      expect(s).not.toMatch(/maybeSuggestSc12\(\s*tx\b/);
    });
  }
});

// ────────────────────────────── R226-10 · the parent boundary holds ──────────────────────────────────
describe("🔴 R226-10 · the auto-DRAFT stays invisible to the parent portal", () => {
  it("parent-portal-data.ts still filters SC forms to non-DRAFT (re-prove :248)", () => {
    const s = readCode("lib/parent/parent-portal-data.ts");
    expect(s).toMatch(/ne\(\s*waecSpecialConsideration\.status,\s*"DRAFT"\s*\)/);
  });
});

// ────────────────────────────── R226-8 · fileScForm's gate is untouched ──────────────────────────────
describe("🔴 R226-8 · the human filing stays WASSCE_SETUP_ROLES-gated (fileScForm unchanged)", () => {
  it("wassce-readiness.ts still asserts WASSCE_SETUP_ROLES before filing", () => {
    expect(readCode("lib/actions/wassce-readiness.ts")).toContain("assertAnyRole(WASSCE_SETUP_ROLES)");
  });
});

// ────────────────────────────── R227 · the served banner is clinical-free ────────────────────────────
describe("🔴 R227 · the WASSCE setup surface carries ZERO clinical token (ADMIN + VHA readers)", () => {
  const page = () => readCode("app/(app)/senior/wassce/setup/page.tsx");

  it("AC-R227-1 · no hospital / inpatient / ward / diagnosis / clinician / condition token in served markup", () => {
    const s = page();
    for (const re of [
      /\bhospital\b/i,
      /\binpatient\b/i,
      /\bward\b/i,
      /\bmalaria\b/i,
      /mensah/i,
      /certificate pending/i,
      /pulls live/i,
      /\bdiagnosis\b/i,
      /\bclinician\b/i,
      /\bdischarge\b/i,
    ]) {
      expect(s, `${re} must not appear on the WASSCE setup surface`).not.toMatch(re);
    }
  });

  it("AC-R227-4 · no hardcoded candidate — the banner binds to derived data, not Y. Aidoo", () => {
    expect(page()).not.toContain("Aidoo");
  });

  it("AC-R227-5 · the banner is guarded on the derived count (omitted when there is no live SC-12)", () => {
    expect(page()).toMatch(/data\.sc12Banner\.length/);
  });
});

// ────────────────────────────── R228 · deep-dive §7 STAYS OMITTED ─────────────────────────────────────
describe("🔴 R228 · the WASSCE deep-dive renders no sickbay element and reads no sickbay table", () => {
  it("AC-R228-2 · the deep-dive loader reads no sickbay table and imports nothing from lib/sickbay", () => {
    const s = readCode("lib/wassce/deepdive-data.ts");
    expect(s).not.toMatch(/sickbay/i);
    expect(s).not.toMatch(/@\/lib\/sickbay/);
  });

  it("AC-R228-1 · the deep-dive view + panels render no sickbay cell (SC-12 stays the sole medical signal)", () => {
    expect(readCode("lib/wassce/deepdive-view.ts")).not.toMatch(/sickbay/i);
    expect(readCode("components/senior/wassce-deepdive-panels.tsx")).not.toMatch(/sickbay/i);
  });
});
