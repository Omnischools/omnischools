import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { civilDay, examDayLabel, examWindowView, paperWindow } from "./exam-window";
// The sickbay module pinned the same civil day first (R33). One idiom, asserted equal below.
import { civilDate } from "@/lib/sickbay/visits";

/**
 * 🔴 R90 / Lucy F7 for the WASSCE module — the sickbay board-copy precedent applied to the exam
 * timetable. `schoolup-wassce-setup.html` draws `Started Tue 13 May … Today (Wed 14 May)`. BOTH
 * weekdays are wrong for their own dates (13 May 2026 is a Wednesday, 14 May a Thursday) and the
 * whole clause was stale the morning after it was written. The mockup wins on presentation and
 * loses on logic, so the dates derive and this file is the guard that they stay derived.
 */

/** The seeded WAEC 2026 timetable (db/seed/wassce.ts §6), trimmed to what the banner reads. */
const PAPERS = [
  {
    name: "Social Studies 1 (Objective)",
    scheduledDate: "2026-04-21",
    scheduledTime: "09:00",
    durationMinutes: 60,
  },
  {
    name: "Social Studies 2 (Essay)",
    scheduledDate: "2026-04-21",
    scheduledTime: "10:00",
    durationMinutes: 120,
  },
  {
    name: "Mathematics (Core) 1 (Objective)",
    scheduledDate: "2026-05-05",
    scheduledTime: "09:00",
    durationMinutes: 90,
  },
  {
    name: "Oral English",
    scheduledDate: "2026-05-13",
    scheduledTime: "08:00",
    durationMinutes: 45,
  },
  {
    name: "English Language 2 (Essay)",
    scheduledDate: "2026-05-14",
    scheduledTime: "09:30",
    durationMinutes: 150,
  },
  {
    name: "English Language 1 (Objective)",
    scheduledDate: "2026-05-14",
    scheduledTime: "14:00",
    durationMinutes: 60,
  },
  {
    name: "Literature in English 2 (Prose)",
    scheduledDate: "2026-06-16",
    scheduledTime: "09:30",
    durationMinutes: 120,
  },
];

// The exact instant the shipped page claimed was a Wednesday.
const NOW = new Date("2026-05-14T09:45:00Z");

describe("R90 · the banner's dates derive from the timetable and the request instant", () => {
  it("🔴 `Wed 14 May` was a THURSDAY — the derived label says so", () => {
    const ew = examWindowView(PAPERS, NOW)!;
    expect(ew.todayLabel).toBe("Thu 14 May");
    // …and the day the surface called Tuesday is a Wednesday. Neither literal is an expected value
    // anywhere: they are read back off the calendar, through the one formatter.
    expect(examDayLabel("2026-05-13")).toBe("Wed 13 May");
    expect(examDayLabel("2026-05-24")).toBe("Sun 24 May"); // the subject page's old `Sat 24 May`
  });

  it("today's papers are the timetable's own rows, with the clock window computed from duration", () => {
    const ew = examWindowView(PAPERS, NOW)!;
    expect(ew.todayPapers).toEqual([
      { name: "English Language 2 (Essay)", window: "09:30–12:00" },
      { name: "English Language 1 (Objective)", window: "14:00–15:00" },
    ]);
  });

  it("the window's edges, day number and span come off the first and last dated papers", () => {
    const ew = examWindowView(PAPERS, NOW)!;
    expect(ew.startLabel).toBe("Tue 21 Apr");
    expect(ew.startPapers).toBe(
      "Social Studies 1 (Objective) + Social Studies 2 (Essay)",
    );
    expect(ew.endLabel).toBe("Tue 16 Jun");
    expect(ew.dayIndex).toBe(24); // 21 Apr → 14 May inclusive
    expect(ew.windowDays).toBe(57); // 21 Apr → 16 Jun inclusive
    expect(ew.nextPaper).toEqual({
      name: "Literature in English 2 (Prose)",
      label: "Tue 16 Jun",
      inDays: 33,
    });
  });

  it("a day with NO paper says so — it never repeats the previous paper day", () => {
    const ew = examWindowView(PAPERS, new Date("2026-05-15T08:00:00Z"))!;
    expect(ew.todayPapers).toEqual([]);
    expect(ew.todayLabel).toBe("Fri 15 May");
    expect(ew.dayIndex).toBe(25); // still inside the window, just not sitting
  });

  it("before the first paper and after the last there is NO day number to state", () => {
    const before = examWindowView(PAPERS, new Date("2026-04-01T08:00:00Z"))!;
    expect(before.dayIndex).toBeNull();
    expect(before.nextPaper?.name).toBe("Social Studies 1 (Objective)");

    const after = examWindowView(PAPERS, new Date("2026-07-01T08:00:00Z"))!;
    expect(after.dayIndex).toBeNull();
    expect(after.nextPaper).toBeNull();
    expect(after.todayPapers).toEqual([]);
  });

  it("a cohort with no dated paper gets NO banner — omitted, never a placeholder window", () => {
    expect(examWindowView([], NOW)).toBeNull();
    expect(
      examWindowView(
        [
          {
            name: "Unscheduled",
            scheduledDate: null,
            scheduledTime: null,
            durationMinutes: null,
          },
        ],
        NOW,
      ),
    ).toBeNull();
  });

  it("an unstored end is not invented, and an unstored clock is NAMED", () => {
    expect(paperWindow("09:30", 150)).toBe("09:30–12:00");
    expect(paperWindow("09:30", null)).toBe("09:30");
    expect(paperWindow(null, 150)).toBe("time not scheduled");
    // Past midnight the end still reads as a clock, never `24:15`.
    expect(paperWindow("23:30", 60)).toBe("23:30–00:30");
  });

  it("`today` is the ACCRA civil day — the same call the sickbay module already made", () => {
    const at = new Date("2026-05-14T23:30:00Z");
    expect(civilDay(at)).toBe("2026-05-14");
    expect(civilDay(at)).toBe(civilDate(at));
  });
});

// ============================================================================
// The sweep — no shipped WASSCE source may carry a weekday-plus-date literal
// ============================================================================

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Every `.ts`/`.tsx` under a directory, recursively — so a NEW WASSCE file is swept the day it lands. */
function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(resolve(cwd(), dir), { withFileTypes: true })) {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...sourcesUnder(path));
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

const SHIPPED_WASSCE = [
  ...sourcesUnder("app/(app)/senior/wassce"),
  ...sourcesUnder("lib/wassce"),
  ...readdirSync(resolve(cwd(), "components/senior"))
    .filter((f) => f.startsWith("wassce-"))
    .map((f) => `components/senior/${f}`),
].map((path) => ({
  path,
  code: stripComments(readFileSync(resolve(cwd(), path), "utf8")),
}));

/** `Tue 13 May`, `Wednesday 14 May`, `Sat 24 May 2026` — a weekday nothing computed. */
const WEEKDAY_DATE =
  /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.?,?\s+\d{1,2}\s*(st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/;
/** `14 May`-style with the weekday trailing, and the `06:45 today` shape from the §4.2 banner. */
const DATE_WEEKDAY =
  /\b\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*,?\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/;
const CLOCK_TODAY = /\b\d{1,2}:\d{2}\s+(today|yesterday|tomorrow)\b/i;

describe("no shipped WASSCE source states a date the code did not derive", () => {
  it("finds the files to sweep (a silently empty sweep would pass forever)", () => {
    expect(SHIPPED_WASSCE.length).toBeGreaterThan(15);
    for (const p of [
      "app/(app)/senior/wassce/setup/page.tsx",
      "lib/wassce/setup-data.ts",
    ]) {
      expect(
        SHIPPED_WASSCE.some((f) => f.path === p),
        p,
      ).toBe(true);
    }
  });

  it("🔴 no weekday-plus-date literal survives anywhere in the module", () => {
    for (const { path, code } of SHIPPED_WASSCE) {
      expect(
        WEEKDAY_DATE.exec(code)?.[0] ?? null,
        `${path} hardcodes a weekday + date`,
      ).toBeNull();
      expect(
        DATE_WEEKDAY.exec(code)?.[0] ?? null,
        `${path} hardcodes a date + weekday`,
      ).toBeNull();
    }
  });

  it("no clock is pinned to a hardcoded `today`", () => {
    for (const { path, code } of SHIPPED_WASSCE) {
      expect(
        CLOCK_TODAY.exec(code)?.[0] ?? null,
        `${path} hardcodes a time of day`,
      ).toBeNull();
    }
  });

  it("the setup page reads the clock ONCE and hands it to the loader (R68)", () => {
    const page = SHIPPED_WASSCE.find(
      (f) => f.path === "app/(app)/senior/wassce/setup/page.tsx",
    )!;
    expect((page.code.match(/new Date\(\)/g) ?? []).length).toBe(1);
    expect(page.code.includes("loadWassceSetup(tx, school.id, now)")).toBe(true);
    // The loader derives rather than reading its own clock — one instant per request.
    const loader = SHIPPED_WASSCE.find((f) => f.path === "lib/wassce/setup-data.ts")!;
    expect(loader.code.includes("new Date()")).toBe(false);
    expect(loader.code.includes("examWindowView(paperRows, now)")).toBe(true);
  });

  it("there is ONE civil-day helper in the module, and one clock-window formatter", () => {
    for (const { path, code } of SHIPPED_WASSCE) {
      if (path === "lib/wassce/exam-window.ts") continue;
      expect(
        /function\s+(isoDay|civilDay|civilDate)\s*\(/.test(code),
        `${path} declares a second civil-day helper`,
      ).toBe(false);
      expect(
        /const\s+endClock\s*=/.test(code),
        `${path} re-implements the clock window`,
      ).toBe(false);
    }
  });
});
