import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { stripMarkup } from "@/scripts/_strip-markup";
import {
  CHRONIC_ROW_KEYS,
  CONDITION_PILL,
  DORM_CARD_FOOT,
  PASTORAL_BODY,
  PLAN_REVIEW_DAYS,
  conditionLabel,
  grantCountLabel,
  lastVisitStamp,
  medicationLine,
  planVersionMeta,
  registerCounts,
  registerLede,
  relativeVisitAge,
  roundColumns,
  statusPill,
  type ChronicCondition,
} from "./chronic-copy";
import { CANONICAL_SICKBAY_SLOTS, roundSchedule, type SickbaySlot } from "./defaults";

const root = resolve(cwd(), "..");
const SURFACE = readFileSync(
  resolve(root, "Surfaces", "schoolup-sickbay-chronic-register.html"),
  "utf8",
);
const clean = (s: string) =>
  stripMarkup(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const SURFACE_TEXT = clean(SURFACE);

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const read = (p: string) => stripComments(readFileSync(resolve(cwd(), p), "utf8"));

// ============================================================================
// R43/R94 — the `diagnos` ban, swept across every 23a file that ships an identifier.
// ============================================================================

describe("R43/R94 · `diagnos` appears in no identifier this increment ships", () => {
  // The ACTUAL shipped 23a files (Quinn M1: the old list named two files that never shipped —
  // `chronic-register-list.tsx`, `chronic-plan.tsx` — and a `try/catch { continue }` skipped them
  // silently, so the sweep never once inspected the write UI, the action, or the error mapper. That
  // is the skip-hatch pattern: a file the sweep cannot find is a FAILURE, not a pass.) The seed is
  // deliberately absent — its matron-authored `conditionDetail` prose ("diagnosed in early
  // childhood") is DATA the owner chose to store (D1), not an identifier R43/R94 bans.
  const SHIPPED = [
    "lib/sickbay/chronic-copy.ts",
    "lib/sickbay/chronic-reads.ts",
    "lib/sickbay/chronic-write-errors.ts",
    "lib/actions/sickbay-chronic.ts",
    "components/sickbay/chronic-plan-forms.tsx",
    "app/(app)/senior/sickbay/chronic-register/page.tsx",
    "app/(app)/senior/sickbay/chronic-register/new/page.tsx",
    "app/(app)/senior/sickbay/chronic-register/[studentId]/page.tsx",
    "app/(app)/senior/sickbay/chronic-register/[studentId]/edit/[entryId]/page.tsx",
  ];
  it("no shipped 23a source carries the string `diagnos` (in code, not comments)", () => {
    for (const p of SHIPPED) {
      // read() throws if the file is gone — a moved/renamed file must FAIL here, never skip. That is
      // the whole lesson of the old list: a sweep that silently covers nothing reads as "clean".
      const src = read(p);
      expect(src.toLowerCase().includes("diagnos"), `${p} contains "diagnos" in code`).toBe(false);
    }
  });
});

// ============================================================================
// The condition pill — enum → colour, stored string → words (§3.4)
// ============================================================================

describe("the condition pill separates COLOUR (enum) from WORDS (stored label)", () => {
  it("renders the stored label when present, the humanised enum otherwise", () => {
    expect(conditionLabel("SICKLE_CELL", "Sickle cell · HbSS")).toBe("Sickle cell · HbSS");
    expect(conditionLabel("ASTHMA", null)).toBe("Asthma");
    expect(conditionLabel("DIABETES", "   ")).toBe("Diabetes");
    // Never a diagnosis word, never the raw enum token.
    expect(conditionLabel("MENTAL_HEALTH", null)).toBe("Mental health");
  });
  it("every condition family has a solid pill token (no slash-opacity trap)", () => {
    const families: ChronicCondition[] = [
      "SICKLE_CELL",
      "ASTHMA",
      "EPILEPSY",
      "ALLERGY",
      "MENTAL_HEALTH",
      "DIABETES",
      "OTHER",
    ];
    for (const f of families) {
      expect(CONDITION_PILL[f]).toBeTruthy();
      expect(CONDITION_PILL[f], `${f} pill uses a slash-opacity token`).not.toMatch(/\/\d/);
    }
    // M11 — the mental-health pill is navy (identifiable across a room; renders only to a scoped reader).
    expect(CONDITION_PILL.MENTAL_HEALTH).toBe("bg-navy-2 text-bg");
  });
});

// ============================================================================
// Status (3 values) — R95; the med line drops for a mental-health row (C4/M4)
// ============================================================================

describe("status is 3 values and the med line is EMPTY for a mental-health plan", () => {
  it("statusPill maps the three enum values", () => {
    expect(statusPill("ACTIVE_CRISIS")).toEqual({ label: "Active crisis", tone: "crisis" });
    expect(statusPill("MONITOR")).toEqual({ label: "Monitor", tone: "monitor" });
    expect(statusPill("STABLE")).toEqual({ label: "Stable", tone: "stable" });
  });
  it("medicationLine leads with the first scheduled drug, never a stored duplicate", () => {
    expect(
      medicationLine([
        { drugName: "Hydroxyurea", doseLabel: "500mg OD", isPrn: false },
        { drugName: "Paracetamol", doseLabel: "500mg", isPrn: true },
      ]),
    ).toBe("Hydroxyurea 500mg OD");
    // A PRN-only plan falls back to its first PRN drug.
    expect(medicationLine([{ drugName: "Salbutamol", doseLabel: "2 puffs", isPrn: true }])).toBe(
      "Salbutamol 2 puffs",
    );
    // 🔴 C4/M4 — no meds ⇒ EMPTY cell, never `no on-site medication`.
    expect(medicationLine([])).toBeNull();
  });
});

// ============================================================================
// R125 — `Last visit` is timestamp + relative age ONLY, no reason clause
// ============================================================================

describe("R125 · last visit is time + relative age, and the reason fragment is gone", () => {
  const now = new Date("2026-05-14T14:45:00Z");
  it("stamps the timestamp the surface's own way", () => {
    expect(lastVisitStamp(new Date("2026-05-12T18:40:00Z"))).toBe("12 May 18:40");
    expect(SURFACE_TEXT.includes("12 May 18:40")).toBe(true);
  });
  it("relative age is whole civil days from the pinned now", () => {
    expect(relativeVisitAge(new Date("2026-05-14T09:14:00Z"), now)).toBe("today");
    expect(relativeVisitAge(new Date("2026-05-13T23:00:00Z"), now)).toBe("yesterday");
    expect(relativeVisitAge(new Date("2026-05-04T14:22:00Z"), now)).toBe("10 days ago");
    expect(relativeVisitAge(new Date("2026-03-29T22:40:00Z"), now)).toBe("6 wk ago");
  });
});

// ============================================================================
// Grant-count cell — singular / plural / the authored No grants (§3.4)
// ============================================================================

describe("the HM-grants cell prints a count, never an avatar stack", () => {
  it("pluralises and falls back to the authored empty state", () => {
    expect(grantCountLabel(3)).toBe("3 staff");
    expect(grantCountLabel(1)).toBe("1 member of staff");
    expect(grantCountLabel(0)).toBe("No grants");
  });
});

// ============================================================================
// Counts — over the reader's visible set; the partition invariant (R74)
// ============================================================================

describe("R74 · the status buckets partition; referral-managed is a second axis", () => {
  const now = new Date("2026-05-14T14:45:00Z");
  const rows = [
    { status: "ACTIVE_CRISIS", referralManaged: false, reviewedAt: new Date("2026-04-21T00:00:00Z") },
    { status: "MONITOR", referralManaged: false, reviewedAt: new Date("2026-05-10T00:00:00Z") },
    { status: "MONITOR", referralManaged: true, reviewedAt: null }, // never reviewed → overdue
    { status: "STABLE", referralManaged: false, reviewedAt: new Date("2026-05-11T00:00:00Z") },
    { status: "STABLE", referralManaged: false, reviewedAt: new Date("2026-01-01T00:00:00Z") }, // old → overdue
  ] as const;

  it("crisis + monitor + stable === all, and referral-managed does not partition", () => {
    const c = registerCounts(rows, now);
    expect(c.all).toBe(5);
    expect(c.crisis + c.monitor + c.stable).toBe(c.all);
    expect(c).toMatchObject({ crisis: 1, monitor: 2, stable: 2, referralManaged: 1 });
  });
  it("a never-reviewed plan and a plan older than PLAN_REVIEW_DAYS both count as needing review", () => {
    const c = registerCounts(rows, now);
    expect(PLAN_REVIEW_DAYS).toBe(30);
    expect(c.needingReview).toBe(2);
    expect(c.crisesToday).toBe(1);
  });
});

// ============================================================================
// Lede + version meta — derived, and the no-review branches are authored
// ============================================================================

describe("the lede and version meta are derived over the visible set", () => {
  it("the lede counts the VISIBLE set and drops last-review when nothing was reviewed", () => {
    // 🔴 F1 — the surface writes `Mon 12 May`, but 12 May 2026 is a TUESDAY. The weekday is DERIVED,
    // never the surface's own wrong string (the today board settled the same off-by-one at R90).
    expect(registerLede(5, new Date("2026-05-12T00:00:00Z"))).toBe(
      "**5 active** care plans · last review **Tue 12 May** · **admin-private** by default",
    );
    expect(registerLede(1, null)).toBe(
      "**1 active** care plan · **admin-private** by default",
    );
    // `next monthly review` is nowhere — nothing schedules a review.
    expect(registerLede(5, new Date()).includes("next")).toBe(false);
  });
  it("planVersionMeta renders the version line, and the not-yet-reviewed variant is authored", () => {
    expect(planVersionMeta(4, new Date("2026-04-21T00:00:00Z"), "Mrs A. Bediako")).toBe(
      "v4 · 21 Apr 2026 · Mrs A. Bediako",
    );
    expect(planVersionMeta(1, null, null)).toBe("plan version v1 · not yet reviewed");
  });
});

// ============================================================================
// The med grid columns come from the ROUND SCHEDULE, never the surface's 13:00 (R101/F6)
// ============================================================================

describe("R101 · med-grid columns are the canonical rounds, and 13:00 is nowhere", () => {
  it("derives one column per active MEDICATION_ROUND, anchor first, no 13:00", () => {
    const slots: SickbaySlot[] = CANONICAL_SICKBAY_SLOTS.map((s, i) => ({ ...s, id: `s-${i}` }));
    const cols = roundColumns(roundSchedule(slots));
    expect(cols.map((c) => c.time)).toEqual(["06:30", "12:30", "21:00"]);
    expect(cols[0].label).toBe("Morning medication round");
    expect(cols.some((c) => c.time === "13:00")).toBe(false);
  });
});

// ============================================================================
// Verbatim surface copy — the physical-adjacency controls ship character-exact
// ============================================================================

describe("the load-bearing non-disclosure copy is character-exact against the surface", () => {
  it("the dorm-card foot is the surface's own words", () => {
    const foot = DORM_CARD_FOOT.replace(/\*\*/g, "");
    expect(SURFACE_TEXT.includes(foot)).toBe(true);
  });
  it("the pastoral block's frozen first two sentences are the surface's", () => {
    expect(SURFACE_TEXT.includes(PASTORAL_BODY)).toBe(true);
  });
});

// ============================================================================
// The runtime key-set pins (MEDIUM-3) — sorted, and mental-health-free by construction
// ============================================================================

describe("CHRONIC_ROW_KEYS pins the view shape so a scope leak fails a test", () => {
  it("the register row key-set carries identity + status, never a clinical narrative column", () => {
    for (const leak of ["conditionDetail", "emergencyProtocol", "triggers", "meds", "redFlags"]) {
      expect([...CHRONIC_ROW_KEYS.register], leak).not.toContain(leak);
    }
    expect([...CHRONIC_ROW_KEYS.register]).toEqual([...CHRONIC_ROW_KEYS.register].sort());
  });
  it("the entry key-set is sorted (so `Object.keys().sort()` can compare it directly)", () => {
    expect([...CHRONIC_ROW_KEYS.entry]).toEqual([...CHRONIC_ROW_KEYS.entry].sort());
  });
});
