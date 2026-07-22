import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import {
  ADMITTED_TAG,
  BEDS_CARD_EM,
  BEDS_CARD_TITLE,
  BED_EMPTY_STATE,
  BOARD_ROW_KEYS,
  EMPTY_LOG,
  EMPTY_QUEUE,
  H1_EM,
  H1_LEAD,
  ISO_TAG,
  LIVE_TILE_LABELS,
  LOG_CARD_EM,
  LOG_CARD_TAIL,
  LOG_HEAD_NOTE,
  NOT_CONFIGURED,
  NO_BEDS,
  OMITTED_AT_22C,
  QUEUE_CARD_EM,
  QUEUE_CARD_TITLE,
  WARD_VITAL_LABELS,
  admittedMeta,
  admittedName,
  admittedTileMeta,
  asOf,
  bedLabel,
  bedOccupancyMeta,
  boardDate,
  boardLede,
  dayLabel,
  dispositionPill,
  hhmm,
  initials,
  openVisitCollisionError,
  queueWaitMeta,
  recentLede,
  stampLabel,
  studentMeta,
  visitBreakdown,
} from "./board-copy";
import { formatWait } from "./visits";
import { VITALS_COLUMNS } from "./visit-copy";

const root = resolve(cwd(), "..");
const SURFACE = readFileSync(
  resolve(root, "Surfaces", "schoolup-sickbay-today.html"),
  "utf8",
);

/** Strip markup to a FIXPOINT — see the reasoning in visit-copy.test.ts (same helper, same why). */
function stripMarkup(input: string): string {
  let s = input;
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "").replace(/<[^>]*>/g, "");
  }
  return s.replace(/</g, "");
}
const clean = (s: string) =>
  stripMarkup(s)
    // `&amp;` decodes LAST — decoding it first turns `&amp;gt;` into `>`, silently rewriting the
    // copy this helper exists to compare character for character.
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The two sections in scope. §02 (rounds → 24), §04 (referrals → 25) and §05 (outbreak → 27) reuse
 * the same class names, so every comparison below is scoped or it would be comparing this
 * increment's copy against three increments' worth of it.
 */
const between = (from: string, to: string) =>
  SURFACE.slice(SURFACE.indexOf(from), SURFACE.indexOf(to));
const S01 = between("Live situation · admissions", "Today's medication rounds");
const S03 = between("Recent visits · last 24 hours", "Active referrals out");
const IN_SCOPE = `${S01}\n${S03}`;

/** Inner text of every `<tag class="X">…</tag>` inside the scoped slice. */
function textOf(cls: string, scope: string = IN_SCOPE): string[] {
  const out: string[] = [];
  for (const m of scope.matchAll(new RegExp(`class="${cls}"[^>]*>([\\s\\S]*?)</`, "g"))) {
    out.push(clean(m[1]));
  }
  return out;
}
const SURFACE_TEXT = clean(IN_SCOPE);

/** Case-folded: the surface writes `Hydroxyurea continued`, a leak would write `hydroxyurea`. */
const lower = (s: string) => s.toLowerCase();

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const read = (p: string) => {
  const src = readFileSync(resolve(cwd(), p), "utf8");
  return { path: p, src, code: stripComments(src) };
};

/**
 * Everything INCR-22c ships that can put a string in front of a user. `board-copy.ts` is
 * deliberately EXCLUDED from the omitted-copy sweep below: it is the register that NAMES the
 * omissions, so the very strings the sweep hunts for live there on purpose.
 */
const SHIPPED_22C = [
  "lib/sickbay/board-reads.ts",
  "app/(app)/senior/sickbay/today/page.tsx",
  "components/sickbay/begin-visit-button.tsx",
  "components/sickbay/clinical-restricted.tsx",
].map(read);

const READER = read("lib/sickbay/board-reads.ts");
const PAGE = read("app/(app)/senior/sickbay/today/page.tsx");

// ============================================================================
// AC O — `===` character-exact copy against schoolup-sickbay-today.html
// ============================================================================

describe("O · shipped board copy is character-exact against the today surface", () => {
  it("the h1 lead + em are the surface's own, and the DATE is not part of the fixture", () => {
    // Surface h1: `Today's <em>sickbay</em> · Wed 14 May 2026`.
    expect(SURFACE_TEXT.includes(`${H1_LEAD}${H1_EM}`)).toBe(true);
  });

  it("🔴 R90 · `Wed 14 May 2026` is a THURSDAY — no fixture and no source file carries it", () => {
    // The surface asserts a weekday its own date does not have. The h1 formats the pinned `now`, so
    // the defect cannot be inherited — and enshrining the string as an expected value would.
    expect(SURFACE_TEXT.includes("Wed 14 May 2026")).toBe(true);
    // Comment-stripped: the modules EXPLAIN the defect in prose (this one names it twice), and a
    // sweep that failed on prose would forbid the sentence that states the rule. A fixture is code.
    for (const { path, code } of [...SHIPPED_22C, read("lib/sickbay/board-copy.ts")]) {
      expect(code.includes("Wed 14 May"), path).toBe(false);
      expect(
        /"(Mon|Tue|Wed|Thu|Fri|Sat|Sun)"/.test(code),
        `${path} hardcodes a weekday`,
      ).toBe(false);
    }
    expect(boardDate(new Date("2026-05-14T14:45:00Z"))).toBe("Thu 14 May 2026");
  });

  it("the three surviving live-tile labels ARE the surface's `.lbl`s, in order", () => {
    // The surface draws five; `Active referrals` (INCR-25) and `Cluster watch` (INCR-27) are OMITTED.
    expect(textOf("lbl")).toEqual([
      ...LIVE_TILE_LABELS,
      "Active referrals",
      "Cluster watch",
    ]);
  });

  it("the card heads are the surface's `.ch-title`s, character for character", () => {
    expect(textOf("ch-title")).toEqual([
      `${QUEUE_CARD_TITLE}${QUEUE_CARD_EM}`,
      `${BEDS_CARD_TITLE}${BEDS_CARD_EM}`,
    ]);
  });

  it("§03's head-row note and title tail are the surface's, verbatim", () => {
    expect(SURFACE_TEXT.includes(LOG_HEAD_NOTE)).toBe(true);
    expect(SURFACE_TEXT.includes(`${LOG_CARD_EM}${LOG_CARD_TAIL}`)).toBe(true);
  });

  it("the bed tile's empty state, iso tag and admitted tag are the surface's", () => {
    expect(textOf("bed-state")).toEqual(Array(7).fill(BED_EMPTY_STATE));
    expect(textOf("iso-tag")).toEqual([ISO_TAG, ISO_TAG]);
    expect(textOf("ab-tag admitted")).toEqual([ADMITTED_TAG]);
  });

  it("R85 · the ward vitals use the VISIT RECORD's vocabulary, not today's drift", () => {
    // The today surface prints `Pulse` and `Pain score`; the visit record prints `HR` and `Pain`.
    // One vocabulary wins, and it is the record's (VITALS_COLUMNS, shipped at 22a).
    expect([...WARD_VITAL_LABELS]).toEqual([...VITALS_COLUMNS.slice(1, 6)]);
    expect(textOf("vl")).toEqual(["Temp", "Pulse", "BP", "SpO₂", "Pain score"]);
  });

  it("the derived meta strings reproduce the surface's own fragments", () => {
    expect(admittedTileMeta([{ shortName: "A. Mensa", bedNumber: 3 }])).toBe(
      "**A. Mensa** · bed 3",
    );
    expect(SURFACE_TEXT.includes("A. Mensa · bed 3")).toBe(true);

    expect(queueWaitMeta([7 * 60_000, 4 * 60_000, 2 * 60_000])).toBe(
      "avg wait **4 min** · oldest 7 min",
    );
    expect(SURFACE_TEXT.includes("avg wait 4 min · oldest 7 min")).toBe(true);

    expect(admittedName("Adwoa Mensa", 3, false)).toBe("Adwoa Mensa · admitted bed 3");
    expect(SURFACE_TEXT.includes("Adwoa Mensa · admitted bed 3")).toBe(true);

    expect(bedLabel(3)).toBe("Bed 03");
    expect(bedOccupancyMeta(1, 8)).toBe("1 / 8 · 7 empty");
    expect(SURFACE_TEXT.includes("1 / 8 · 7 empty")).toBe(true);

    expect(formatWait(7 * 60_000)).toBe("7 min wait");
    expect(SURFACE_TEXT.includes("7 min wait")).toBe(true);
  });

  it("A2/R73 · ONE abbreviation, and it is a disclosure tier — not a render preference", () => {
    expect(initials("Adwoa Mensa")).toBe("A. Mensa");
    expect(SURFACE_TEXT.includes("A. Mensa")).toBe(true);
    expect(initials("Kofi Asare Mensah")).toBe("K. Mensah");
    // A one-word name is NOT abbreviated: `M.` alone identifies nobody, so it is not a shorter form.
    expect(initials("Mensa")).toBe("Mensa");
    // A dangling actor pointer drops its clause rather than printing an empty one.
    expect(initials(null)).toBeNull();
    expect(initials("   ")).toBeNull();

    // …and there is exactly ONE implementation. Four had drifted apart on null and single-word
    // names, and because the abbreviation IS the tier, the drift was invisible at the type level.
    for (const { path, code } of SHIPPED_22C) {
      expect(
        /charAt\(0\)\s*\}\s*\./.test(code),
        `${path} re-implements the abbreviation inline`,
      ).toBe(false);
      expect(
        /\b(const|function)\s+(initial|initials|shortName)\s*[=(]/.test(code),
        `${path} declares a second abbreviation helper`,
      ).toBe(false);
    }
  });

  it("the disposition pills are the surface's `.d-pill`s", () => {
    const at = new Date("2026-05-14T14:35:00Z");
    expect(dispositionPill("DISCHARGE", at).label).toBe("Discharged 14:35");
    expect(dispositionPill("ADMIT", null).label).toBe("Admitted");
    expect(dispositionPill("REFER", null).label).toBe("Referred");
    for (const l of ["Discharged 14:35", "Admitted", "Referred"]) {
      expect(SURFACE_TEXT.includes(l), l).toBe(true);
    }
    // AUTHORED (R77): an undisposed visit is in neither the queue nor the ward, so without a pill
    // for it an IN_PROGRESS visit would be invisible on the whole board.
    expect(dispositionPill(null, null)).toEqual({ label: "Open", tone: "open" });
  });
});

// ============================================================================
// 🔴 R90 / R74 — the surface's own tally is WRONG. Derive, and make the terms sum.
// ============================================================================

describe("R90 · the drawn number loses to the derived one, and the terms partition", () => {
  it("the surface's tile-3 fragment is reproduced — but its TOTAL is not an expected value", () => {
    // The surface's own §03 table lists 4 discharges and its own queue holds 3 students, so the
    // honest tile reads 8 = 4 discharged · 1 admitted · 3 awaiting. The literal `5` is nobody's
    // expected value here or anywhere else in the fixtures.
    expect(visitBreakdown({ discharged: 3, admitted: 1, referred: 0, open: 1 })).toBe(
      "3 discharged · 1 admitted · 1 awaiting",
    );
    expect(SURFACE_TEXT.includes("3 discharged · 1 admitted · 1 awaiting")).toBe(true);
    expect(visitBreakdown({ discharged: 4, admitted: 1, referred: 0, open: 3 })).toBe(
      "4 discharged · 1 admitted · 3 awaiting",
    );
  });

  it("R74 · every term that renders is non-zero, and the terms SUM to the total", () => {
    const c = { discharged: 4, admitted: 1, referred: 2, open: 3 };
    const text = visitBreakdown(c)!;
    const sum = [...text.matchAll(/(\d+) /g)].reduce((a, m) => a + Number(m[1]), 0);
    expect(sum).toBe(c.discharged + c.admitted + c.referred + c.open);
    // A zero clause is DROPPED, never rendered as `0 referred`.
    expect(visitBreakdown({ discharged: 2, admitted: 0, referred: 0, open: 0 })).toBe(
      "2 discharged",
    );
    expect(
      visitBreakdown({ discharged: 0, admitted: 0, referred: 0, open: 0 }),
    ).toBeNull();
  });

  it("the lede drops zero clauses and falls back to the authored quiet-day sentence", () => {
    expect(boardLede({ admitted: 1, queued: 3, visitsToday: 8 })).toBe(
      "**1 admitted** · **3 in queue** · **8 visits** today",
    );
    // Mode C: the `admitted` clause is not "0" — it is not a fact about a school with no beds.
    expect(boardLede({ admitted: null, queued: 3, visitsToday: 8 })).toBe(
      "**3 in queue** · **8 visits** today",
    );
    expect(boardLede({ admitted: 0, queued: 0, visitsToday: 0 })).toBe(
      "A quiet day so far — no visits recorded yet.",
    );
  });

  it("an EMPTY queue renders no meta at all — never `avg wait 0 min`", () => {
    expect(queueWaitMeta([])).toBeNull();
    expect(admittedTileMeta([])).toBeNull();
  });

  it("A2 · above ONE admitted patient the tile prints a COUNT and no names", () => {
    const two = [
      { shortName: "A. Mensa", bedNumber: 3 },
      { shortName: "K. Asante", bedNumber: 5 },
    ];
    const meta = admittedTileMeta(two)!;
    expect(meta).toBe("2 on the ward");
    expect(meta.includes("Mensa")).toBe(false);
    expect(meta.includes("Asante")).toBe(false);
  });

  it("§03's head lede partitions too, and is absent on an empty log", () => {
    expect(
      recentLede({ total: 6, discharged: 4, admitted: 1, referred: 1, open: 0 }),
    ).toBe("**6 visits** in last 24 hours · 4 discharged · 1 admitted · 1 referred");
    expect(
      recentLede({ total: 0, discharged: 0, admitted: 0, referred: 0, open: 0 }),
    ).toBeNull();
  });
});

// ============================================================================
// Derived time — every string takes the PINNED `now` (R68)
// ============================================================================

describe("R68 · nothing formats a time without being handed the instant", () => {
  const now = new Date("2026-05-14T14:45:00Z");

  it("§03's day label is derived, and the 24h window makes a third value impossible", () => {
    expect(dayLabel(new Date("2026-05-14T09:14:00Z"), now)).toBe("Today");
    expect(dayLabel(new Date("2026-05-13T19:40:00Z"), now)).toBe("Yesterday");
  });

  it("the admitted stamp names `today` on the day, and the date after it", () => {
    expect(stampLabel(new Date("2026-05-14T09:14:00Z"), now)).toBe("09:14 today");
    expect(stampLabel(new Date("2026-05-13T19:40:00Z"), now)).toBe("19:40 13 May");
    expect(SURFACE_TEXT.includes("09:14 today")).toBe(true);
  });

  it("`just now` replaces a `0 min wait` on a student who has waited ten seconds", () => {
    expect(formatWait(10_000)).toBe("just now");
    expect(formatWait(60_000)).toBe("1 min wait");
  });

  it("the honesty marker replaces the surface's pulsing dot beside a frozen timestamp", () => {
    expect(asOf(now)).toBe("as of 14:45 GMT");
    expect(hhmm(now)).toBe("14:45");
  });

  it("R75b · the collision error names the day and reads back the shipped sentence", () => {
    const msg = openVisitCollisionError(new Date("2026-05-14T09:14:00Z"), now);
    expect(msg).toBe(
      "This student already has an open sickbay visit — opened 09:14 today. " +
        "Open that visit to close or void it first.",
    );
    expect(msg.startsWith("This student already has an open sickbay visit")).toBe(true);
    expect(openVisitCollisionError(new Date("2026-05-13T19:40:00Z"), now)).toContain(
      "opened 19:40 13 May.",
    );
  });
});

// ============================================================================
// R69/R87 — the field ceiling, asserted against the READER'S SOURCE
// ============================================================================

describe("B6/R87 · the board reader cannot leak a clinical assertion", () => {
  it("the five narrative columns are NEVER SELECTED — not filtered later, not fetched", () => {
    for (const col of [
      "workingImpression",
      "redFlagsScreened",
      "hydrationStatus",
      "escalationTriggers",
      "sickbayDoctorConsult",
      "voidReason",
      "dischargeCriteria",
      "overnightPlan",
      "dischargeNote",
      "intakeReportedBy",
    ]) {
      expect(READER.code.includes(col), `board-reads.ts selects ${col}`).toBe(false);
      expect(PAGE.code.includes(col), `the board page renders ${col}`).toBe(false);
    }
    // `plan` is a whole word: `plan:` / `.plan` would be the column, `planBedReconcile` would not.
    expect(/\bplan\b\s*[:.]/.test(READER.code)).toBe(false);
  });

  it("the ONE clinical string is `presentingComplaint`, selected once, landing on the queue only", () => {
    expect((READER.code.match(/presentingComplaint/g) ?? []).length).toBe(1);
    expect([...BOARD_ROW_KEYS.queue]).toContain("complaint");
    for (const type of ["ward", "bed", "bedOccupant", "recent", "latestVital"] as const) {
      expect([...BOARD_ROW_KEYS[type]], type).not.toContain("complaint");
    }
  });

  it("🔴 R87 · the ward row carries NO impression, hydration or plan — by key set", () => {
    for (const k of [
      "workingImpression",
      "hydrationStatus",
      "plan",
      "chronic",
      "condition",
    ]) {
      expect([...BOARD_ROW_KEYS.ward], k).not.toContain(k);
    }
  });

  it("B1/22c-obligation · the board NEVER calls the visit-record reader (N×9 round trip + leak)", () => {
    for (const { path, code } of SHIPPED_22C) {
      expect(code.includes("getVisitRecord"), `${path} reuses getVisitRecord`).toBe(
        false,
      );
    }
  });

  it("R70 guard 2 · no board type is produced by mapping over another", () => {
    // `bedTiles = ward.map(...)` is exactly how a clinical field arrives on a second type as a
    // "harmless" spread. Each type is built from its OWN select's rows.
    expect(
      /(bedTiles|beds|recent|queue)\s*(:[^=]*)?=\s*(ward|queue|recent|bedTiles)\b[^;]*\.map\(/.test(
        READER.code,
      ),
    ).toBe(false);
    // …and there is exactly one select per source table.
    for (const t of ["sickbayVisit", "sickbayAdmission", "sickbayVitalReading"]) {
      expect(
        (READER.code.match(new RegExp(`\\.from\\(${t}\\)`, "g")) ?? []).length,
        t,
      ).toBe(1);
    }
  });

  it("R68 · the reader takes `now` and reads no clock — nor does the page, twice", () => {
    expect(READER.code.includes("new Date()")).toBe(false);
    expect(READER.code.includes("now: Date")).toBe(true);
    // The page pins it exactly once and threads it.
    expect((PAGE.code.match(/new Date\(\)/g) ?? []).length).toBe(1);
    expect(
      read("components/sickbay/begin-visit-button.tsx").code.includes("new Date()"),
    ).toBe(false);
  });

  /**
   * ⚠️ THIS IS A TEXTUAL GUARD, AND THE LIVE ONE IS `🔴 G2 an ADMIN reader issues NO SQL AT ALL` in
   * `scripts/verify-sickbay-board.ts` — it counts real round trips and is what actually enforces
   * R81. An earlier version of this test compared the gate against `withSchool` ONLY, so moving the
   * gate below `await getSickbayConfig(schoolId)` — a HELPER that queries — left it green while the
   * live counter went 0 → 2. So the assertion is against the FIRST `await` of any kind: every query
   * this reader can issue, direct or through a helper, is behind one.
   */
  it("R81 · the role gate precedes the reader's FIRST await, not just its first `withSchool`", () => {
    const body = READER.code.slice(
      READER.code.indexOf("export async function getSickbayBoard"),
    );
    const gate = body.indexOf("SICKBAY_CLINICAL_READ_ROLES");
    expect(gate).toBeGreaterThan(-1);
    // The generic guard: nothing is awaited before the gate, so no helper can smuggle a query past.
    const firstAwait = body.search(/\bawait\b/);
    expect(firstAwait).toBeGreaterThan(-1);
    expect(gate, "a query is awaited BEFORE the clinical gate").toBeLessThan(firstAwait);
    // …and named, so a failure says WHICH entry point moved above it.
    for (const entry of ["withSchool", "getSickbayConfig"]) {
      const at = body.indexOf(entry);
      expect(at, `${entry} is not called by the reader any more`).toBeGreaterThan(-1);
      expect(gate, `${entry} is called before the clinical gate`).toBeLessThan(at);
    }
  });

  it("🔴 R78 · the queue's void backstop is LIVE — `voidedAt` is SELECTED, never hardcoded", () => {
    // Dex A1: `isQueued({ ...v, voidedAt: null }, now)` type-checks, reads fine, and silences the
    // one in-memory check that would survive the SQL `isNull()` being deleted. The column is
    // selected and the row is passed whole.
    expect(READER.code.includes("voidedAt: sickbayVisit.voidedAt")).toBe(true);
    expect(/voidedAt:\s*null/.test(READER.code), "voidedAt is fabricated").toBe(false);
    expect(READER.code.includes("isQueued(v, now)")).toBe(true);
    // …and the SQL predicate the counters and §03 rest on is still there.
    expect(READER.code.includes("isNull(sickbayVisit.voidedAt)")).toBe(true);
  });

  it("the reader is `server-only` and is NOT a `use server` module", () => {
    expect(READER.code.trimStart().startsWith('import "server-only"')).toBe(true);
    expect(READER.code.includes('"use server"')).toBe(false);
  });
});

// ============================================================================
// AC O — omit-not-fake: no shell, no badge, no zero, no disabled control
// ============================================================================

describe("O · the omitted elements appear NOWHERE in the shipped board", () => {
  it("each omitted string is absent from every file that can render one", () => {
    for (const { text, why } of OMITTED_AT_22C) {
      for (const { path, code } of SHIPPED_22C) {
        expect(
          lower(code).includes(lower(text)),
          `${path} still contains "${text}" — ${why}`,
        ).toBe(false);
      }
    }
  });

  it("the omit register is HONEST — every entry names copy the today surface really draws", () => {
    for (const { text } of OMITTED_AT_22C) {
      expect(
        lower(SURFACE_TEXT).includes(lower(text)),
        `"${text}" is not in the today surface`,
      ).toBe(true);
    }
  });

  it("A1/A3/A4 · no condition, drug or chronic tag survives beside a name", () => {
    for (const { path, code } of SHIPPED_22C) {
      for (const leak of [
        "SCD",
        "HbSS",
        "Sickle cell",
        "hydroxyurea",
        "chronicFlag",
        "URTI",
      ]) {
        expect(
          lower(code).includes(lower(leak)),
          `${path} carries the adjacency leak "${leak}"`,
        ).toBe(false);
      }
    }
  });

  it("R89 · Mode C gets NO explanatory panel where the bed board was", () => {
    // The shipped `MODE_C_CAPACITY_PANEL` belongs on SETUP, a decision surface. On a board the
    // matron opens every morning for the rest of her career it is noise by week two.
    for (const { path, code } of SHIPPED_22C) {
      expect(code.includes("MODE_C_CAPACITY_PANEL"), path).toBe(false);
      expect(code.includes("Referral-only operation"), path).toBe(false);
    }
  });

  it("O3 · no false zero and no `—` stand-in anywhere on the board", () => {
    for (const { path, code } of SHIPPED_22C) {
      expect(code.includes("0 / 0"), path).toBe(false);
      expect(code.includes("0/0"), path).toBe(false);
      expect(code.includes("0 min"), path).toBe(false);
      // The em dash as a VALUE (`"—"`), not as punctuation: a dash standing in for an unmeasured
      // vital reads as "measured and normal" to a nurse.
      expect(code.includes('"—"'), path).toBe(false);
      expect(code.includes('{"—"}'), path).toBe(false);
      expect(code.includes("PLACEHOLDER"), path).toBe(false);
      expect(code.includes("disabled={true}"), path).toBe(false);
    }
  });

  it("§02 / §04 / §05 have no shell, no badge and no anchor target", () => {
    for (const { path, code } of SHIPPED_22C) {
      for (const token of [
        "medication round",
        "Mark 17:00",
        "#rounds",
        "#referrals",
        "#outbreak",
        "Outbreak",
        "Cluster",
        "06:30",
        "12:30",
        "21:00",
      ]) {
        expect(
          code.includes(token),
          `${path} reaches into an out-of-scope section: ${token}`,
        ).toBe(false);
      }
    }
  });

  it("the authored empty states are honest — no illustration copy, no pep, no hidden section", () => {
    expect(EMPTY_QUEUE).toBe("No one waiting.");
    expect(EMPTY_LOG).toBe("No visits in the last 24 hours.");
    expect(NO_BEDS).toBe("No beds configured — add capacity in **Sickbay setup**.");
    expect(NOT_CONFIGURED).toBe(
      "Sickbay not set up yet — declare your school's mode in **Sickbay setup**.",
    );
    for (const s of [EMPTY_QUEUE, EMPTY_LOG, NO_BEDS, NOT_CONFIGURED]) {
      expect(PAGE.src.includes(s.replace(/\*\*/g, "")), s).toBe(false); // composed, never re-typed
    }
  });
});

// ============================================================================
// The rendered identity fragments — tier 1 and 2 of the disclosure ladder ONLY
// ============================================================================

describe("the identity fragments the board is allowed to print", () => {
  it("the queue prints `House`, §03 prints the bare House name — the surface's own per-element form", () => {
    expect(studentMeta("F2 SCI", "Aggrey", "#2024/F2/0188", true)).toBe(
      "F2 SCI · **Aggrey House** · #2024/F2/0188",
    );
    expect(SURFACE_TEXT.includes("F2 SCI · Aggrey House · #2024/F2/0188")).toBe(true);
    expect(studentMeta("F2 BUS", "Nkrumah", null, false)).toBe("F2 BUS · **Nkrumah**");
  });

  it("the House clause DROPS for a day student rather than rendering a dash", () => {
    expect(studentMeta("F1 GA", null, "ASK-24-0007", true)).toBe("F1 GA · ASK-24-0007");
  });

  it("the admitted meta is identity + location + duration, and nothing above that tier", () => {
    const meta = admittedMeta({
      formLabel: "F1 GA",
      houseName: "Slessor",
      studentCode: "#2025/F1/0214",
      admittedStamp: "09:14 today",
      admittedByName: "A. Bediako",
      elapsed: "05h 31m",
    });
    expect(meta).toBe(
      "F1 GA · **Slessor House** · Adm. #2025/F1/0214 · admitted **09:14 today** by A. Bediako · 05h 31m on bed",
    );
    // F2 — the surface's `#` is demo chrome in the queue and part of the label in the block; the
    // code is rendered VERBATIM as stored, with no added prefix either way.
    expect(
      admittedMeta({
        formLabel: "F1 GA",
        houseName: null,
        studentCode: "ASK-24-0007",
        admittedStamp: "09:14 today",
        admittedByName: null,
        elapsed: "05h 31m",
      }),
    ).toBe("F1 GA · Adm. ASK-24-0007 · admitted **09:14 today** · 05h 31m on bed");
  });
});
