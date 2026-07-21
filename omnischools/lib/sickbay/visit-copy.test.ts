import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import {
  ASSESSMENT_ROW_LABELS,
  CLUSTER_NOTE_TAIL,
  COMPLAINT_LABEL,
  DISPOSITION_EYEBROW,
  DISPOSITION_FIELD_LABELS,
  EXPECTED_DISCHARGE_SUB,
  OMITTED_AT_22A,
  STATUS_TILE_LABELS,
  VITALS_COLUMNS,
  attendanceLine,
} from "./visit-copy";
import { vitalTrend } from "./vitals";

const root = resolve(cwd(), "..");
const SURFACE = readFileSync(
  resolve(root, "Surfaces", "schoolup-sickbay-visit-record.html"),
  "utf8",
);

/** Inner text of every `<tag class="X">…</tag>` — tags stripped, entities decoded, ws collapsed. */
function textOf(cls: string): string[] {
  const out: string[] = [];
  for (const m of SURFACE.matchAll(new RegExp(`class="${cls}"[^>]*>([\\s\\S]*?)</`, "g"))) {
    out.push(clean(m[1]));
  }
  return out;
}
const clean = (s: string) =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The surface as one normalised text stream — for the `.includes` (exact-character) assertions. */
const SURFACE_TEXT = clean(SURFACE.replace(/<style[\s\S]*?<\/style>/g, ""));

/**
 * COMMENTS ARE NOT CODE. The R43 ceiling is about a column, enum, type, zod key, UI label or route —
 * the shipped 0057 schema itself says "NOT a diagnosis" in prose, so a grep that failed on prose
 * would forbid the very sentence that states the rule. Every identifier/label assertion below runs
 * against comment-stripped source; the copy assertions run against the RENDERABLE files only.
 */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const read = (p: string) => {
  const raw = readFileSync(resolve(cwd(), p), "utf8");
  return { path: p, src: raw, code: stripComments(raw) };
};

/** Everything INCR-22a ships. */
const SHIPPED = [
  "lib/sickbay/visits.ts",
  "lib/sickbay/vitals.ts",
  "lib/sickbay/visit-copy.ts",
  "lib/sickbay/visit-reads.ts",
  "lib/actions/sickbay-visit.ts",
  "components/sickbay/visit-record-console.tsx",
  "components/sickbay/new-visit-form.tsx",
  "components/sickbay/clinical-restricted.tsx",
  "app/(app)/senior/sickbay/visits/[visitId]/page.tsx",
  "app/(app)/senior/sickbay/visits/new/page.tsx",
].map(read);

/**
 * The files that can put a string in front of a user. `visit-copy.ts` is deliberately EXCLUDED from
 * the omitted-copy sweep: it is the register that NAMES the omissions, so the very strings the sweep
 * hunts for live there on purpose — and it is asserted separately that the register is honest.
 */
const RENDERABLE = SHIPPED.filter((f) => !f.path.endsWith("visit-copy.ts"));

// ============================================================================
// O4 — `===` character-exact copy comparison against the surface HTML
// ============================================================================

describe("O4 · shipped copy is character-exact against schoolup-sickbay-visit-record.html", () => {
  it("§01 status-strip labels ARE the surface's four `.st-lbl`s, in order", () => {
    expect(textOf("st-lbl")).toEqual([...STATUS_TILE_LABELS]);
  });

  it("§01 tile 4's sub-line matches the surface's `.st-sub` text", () => {
    // Surface: `if criteria <b>met</b>` → "if criteria met".
    expect(textOf("st-sub")).toContain(EXPECTED_DISCHARGE_SUB);
  });

  it("§01 vitals table headers ARE the surface's seven `th`s, in order", () => {
    const thead = SURFACE.slice(SURFACE.indexOf("<table class=\"vitals-table\">"));
    const headers = [...thead.slice(0, thead.indexOf("</thead>")).matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map(
      (m) => clean(m[1]),
    );
    expect(headers).toEqual([...VITALS_COLUMNS]);
  });

  it("§01 complaint label is the surface's `.cb-lbl`, character for character", () => {
    expect(textOf("cb-lbl")).toEqual([COMPLAINT_LABEL]);
  });

  it("§02 assessment labels ARE the surface's `.ar-lbl`s (bar the DERIVED `Recorded by`)", () => {
    const surfaceLabels = textOf("ar-lbl");
    expect(surfaceLabels).toEqual([...ASSESSMENT_ROW_LABELS, "Recorded by"]);
    // `Recorded by` renders as the card's meta line (actor + N&MC), not as a stored assessment row.
    expect(ASSESSMENT_ROW_LABELS).not.toContain("Recorded by");
  });

  it("§04 disposition eyebrow + field labels are the surface's `.dc-eyebrow` / `.f-lbl`s", () => {
    expect(textOf("dc-eyebrow")).toEqual([DISPOSITION_EYEBROW]);
    expect(textOf("f-lbl")).toEqual([...DISPOSITION_FIELD_LABELS]);
  });

  it("§04 cluster-note tail is the surface's own sentence, verbatim", () => {
    expect(SURFACE_TEXT.includes(CLUSTER_NOTE_TAIL)).toBe(true);
    // The two trimmed clauses ARE in the surface and must NOT be in what we ship (they need the
    // task list and the Tier-2 parent chain, both INCR-26).
    expect(SURFACE_TEXT.includes("on the Matron's task list")).toBe(true);
    for (const { path, src } of RENDERABLE) {
      expect(src.includes("Matron's task list"), path).toBe(false);
      expect(src.includes("parent re-notified"), path).toBe(false);
    }
  });

  it("the trend-strip labels ARE the surface's five `.tt-lbl`s, in order", () => {
    const tiles = vitalTrend([
      {
        takenAt: new Date("2026-05-14T09:14:00Z"),
        tempC: 37.8, systolic: 110, diastolic: 72, pulseBpm: 96, spo2Pct: 98, painScore: 6,
        context: null, takenByName: null,
      },
    ]);
    expect(tiles.map((t) => t.label)).toEqual(textOf("tt-lbl"));
  });
});

// ============================================================================
// O1–O3 — omit-not-fake: no shell, no badge, no zero, no anchor target
// ============================================================================

describe("O1–O3 · the omitted elements appear NOWHERE in the shipped source", () => {
  it("each omitted string is absent from every file that can render one", () => {
    for (const { text, why } of OMITTED_AT_22A) {
      for (const { path, code } of RENDERABLE) {
        expect(code.includes(text), `${path} still contains "${text}" — ${why}`).toBe(false);
      }
    }
  });

  it("the omit register is HONEST — every entry names copy the visit-record surface really draws", () => {
    // Guards the register against becoming a straw man. Four entries belong to the `today` surface
    // (22c) or to the setup surface and are listed here because 22a must not smuggle them in early.
    const elsewhere = new Set(["No chronic flag", "Print day sheet", "refresh 15s", "Routine"]);
    for (const { text } of OMITTED_AT_22A) {
      if (elsewhere.has(text)) continue;
      expect(SURFACE_TEXT.includes(text), `"${text}" is not in the visit-record surface`).toBe(true);
    }
  });

  it("O2 §03 (medications) and §05 (communications) have no shell, badge or anchor target", () => {
    for (const { path, code } of RENDERABLE) {
      expect(code.includes("#medications"), path).toBe(false);
      expect(code.includes("#communications"), path).toBe(false);
      // The boarding `LIGHT·PLACEHOLDER` badge idiom — never a stub tile standing in for a section.
      expect(code.includes("PLACEHOLDER"), path).toBe(false);
      expect(code.includes("Medications administered"), path).toBe(false);
      expect(code.includes("Notification log"), path).toBe(false);
    }
  });

  it("O3 no false zero: the omitted tiles are absent, never `0 / 8`, `0/0` or a `—` stand-in", () => {
    for (const { path, src } of RENDERABLE) {
      expect(src.includes("0 / 8"), path).toBe(false);
      expect(src.includes("0/0"), path).toBe(false);
      expect(src.includes("Avg. weekly load"), path).toBe(false);
    }
  });

  it("A1/A2/A4/A6 — no adjacency leak survives: no condition beside a name anywhere", () => {
    for (const { path, code } of RENDERABLE) {
      for (const leak of ["SCD", "HbSS", "Sickle cell", "hydroxyurea", "chronic-flag", "chronicFlag"]) {
        expect(code.includes(leak), `${path} carries the adjacency leak "${leak}"`).toBe(false);
      }
    }
  });
});

// ============================================================================
// R65 / R30 — the ONE §04 attendance line
// ============================================================================

describe("R65 · the §04 attendance line names a DAY, and is honest when nothing was marked", () => {
  const day = "Wed 14 May";

  it("the marked case says Medical, and says what a class teacher will see", () => {
    const line = attendanceLine({ dayLabel: day, markedLabel: "Medical", skipReason: null });
    expect(line).toBe(
      "Attendance · Wed 14 May is marked Medical for the whole day. Class teachers see M, not A — no medical detail leaves this module.",
    );
  });

  it("R53 · the classless skip NAMES the reason — never silent, never a blocked visit", () => {
    expect(
      attendanceLine({ dayLabel: day, markedLabel: null, skipReason: "Y. Aidoo has no class assigned" }),
    ).toBe(
      "Attendance · Wed 14 May was not marked — Y. Aidoo has no class assigned. The visit record is unaffected.",
    );
  });

  it("R52 · the closed-term skip says so, and says the clinical record stands", () => {
    expect(attendanceLine({ dayLabel: day, markedLabel: null, skipReason: "Term 2 is closed" })).toContain(
      "was not marked — Term 2 is closed",
    );
  });

  it("H14 · a corrected day reads the corrected status, not the sickbay's claim", () => {
    expect(attendanceLine({ dayLabel: day, markedLabel: "Present", skipReason: null })).toBe(
      "Attendance · Wed 14 May reads Present — changed since the sickbay marked it.",
    );
  });

  it("R30 · it NEVER claims periods, and it carries no clinical content", () => {
    const all = [
      attendanceLine({ dayLabel: day, markedLabel: "Medical", skipReason: null }),
      attendanceLine({ dayLabel: day, markedLabel: null, skipReason: "Term 2 is closed" }),
      attendanceLine({ dayLabel: day, markedLabel: "Absent", skipReason: null }),
    ].join(" ");
    for (const forbidden of ["period", "5 periods", "all classes", "auto-applied to roll-call", "diagnos"]) {
      expect(all.toLowerCase().includes(forbidden.toLowerCase()), forbidden).toBe(false);
    }
  });
});

// ============================================================================
// W4 / R43 — the no-diagnosis ceiling, grep-testable
// ============================================================================

describe("R43 · `diagnos` appears in NO column, enum, type, zod key, label or route we add", () => {
  it("no identifier, label or route in a shipped 22a file contains it, in any case", () => {
    for (const { path, code } of SHIPPED) {
      expect(code.toLowerCase().includes("diagnos"), `${path} breaks the no-diagnosis ceiling`).toBe(
        false,
      );
    }
  });

  it("and no ICD / SNOMED / code list / picker crept in with it", () => {
    for (const { path, code: src } of SHIPPED) {
      for (const token of ["ICD-10", "ICD10", "SNOMED", "icdCode", "conditionCode"]) {
        expect(src.includes(token), path).toBe(false);
      }
    }
  });

  it("`escalation_triggers` is INERT — stored and rendered, never evaluated", () => {
    const src = SHIPPED.map((f) => f.src).join("\n");
    // It is written and read, and NOTHING branches on its content: no comparison, no notify, no job.
    expect(src.includes("escalationTriggers")).toBe(true);
    expect(/escalationTriggers\s*[<>=]/.test(src)).toBe(false);
    expect(/notify|sendSms|enqueue|scheduleJob/i.test(src)).toBe(false);
  });
});

// ============================================================================
// R37 — nothing in 22a hard-deletes, and no attendance write leaks in (22b)
// ============================================================================

describe("R37 / the attendance seam · what the write path must NOT contain", () => {
  it("no code path in the clinical write path issues a DELETE", () => {
    for (const { path, code } of SHIPPED) {
      expect(/\.delete\(/.test(code), `${path} issues a DELETE`).toBe(false);
    }
  });

  it("R49 · the clinical action writes NO attendance row itself — it calls the ONE shared writer", () => {
    const clinical = SHIPPED.filter((f) => f.path === "lib/actions/sickbay-visit.ts");
    for (const { path, code: src } of clinical) {
      // No table, no status literal, no register action reachable from here: the whole attendance
      // rulebook (guard, coercion, closed term, skips, audit) lives in lib/attendance/mark.ts.
      expect(src.includes("attendanceRecord"), path).toBe(false);
      expect(src.includes("saveAttendance"), path).toBe(false);
      expect(src.includes("MEDICAL"), path).toBe(false);
      expect(src.includes("markSickbayMedical"), path).toBe(true);
    }
  });

  it("R46 · the hook fires on ADMIT and REFER, and NEVER on DISCHARGE", () => {
    const src = SHIPPED.find((f) => f.path === "lib/actions/sickbay-visit.ts")!.code;
    // The single call site inside disposeVisit is guarded by a REFER test; admitPatient's is
    // unconditional. A DISCHARGE therefore cannot reach the hook on any path.
    expect(/disposition === "REFER"\s*\)\s*\{\s*await fireAttendanceHook/.test(src)).toBe(true);
    expect(src.includes('disposition === "DISCHARGE"')).toBe(false);
    expect((src.match(/fireAttendanceHook\(/g) ?? []).length).toBe(3); // 1 definition + 2 call sites
  });

  it("🔴 H16 · the shared writer is server-only and is NOT a `use server` module", () => {
    // Every export of a "use server" module is a remotely callable endpoint. A POST-able
    // markSickbayMedical would let anyone forge a clinical assertion about any student.
    for (const p of ["lib/attendance/mark.ts", "lib/attendance/mark-rules.ts", "lib/sickbay/medical-hold.ts"]) {
      // Comment-stripped: the files EXPLAIN the rule in prose, and a grep that failed on prose would
      // forbid the very sentence that states it. A directive is code.
      const { code } = read(p);
      expect(code.includes('"use server"'), p).toBe(false);
      expect(code.includes("'use server'"), p).toBe(false);
    }
    expect(read("lib/attendance/mark.ts").src.startsWith('import "server-only"')).toBe(true);
    expect(read("lib/sickbay/medical-hold.ts").src.startsWith('import "server-only"')).toBe(true);
  });

  it("R54 · the attendance write is OUTSIDE the clinical transaction and cannot roll it back", () => {
    const src = read("lib/actions/sickbay-visit.ts").code;
    // Both call sites take the value the `withSchool(...)` RESOLVED to, so they are structurally
    // unable to run inside it — the binding does not exist until the transaction has committed.
    expect(src.includes("const admitted = await withSchool")).toBe(true);
    expect(src.includes("fireAttendanceHook(auth.schoolId, auth.actor, admitted, admitted.at)")).toBe(true);
    expect(src.includes("const closed = await withSchool")).toBe(true);
    expect(src.includes("fireAttendanceHook(auth.schoolId, auth.actor, closed, closed.at)")).toBe(true);
    // …and the writer itself never throws at its caller: every failure path returns a named skip.
    const mark = read("lib/attendance/mark.ts").code;
    expect(/catch \{[\s\S]*?return \{ marked: false, skipped: "FAILED"/.test(mark)).toBe(true);
  });

  it("R60 the consult authorises nothing — no approval, signature or co-sign field", () => {
    for (const { path, code: src } of SHIPPED) {
      for (const token of ["approvedBy", "approved_by", "signature", "coSign", "countersign"]) {
        expect(src.includes(token), path).toBe(false);
      }
    }
  });
});
