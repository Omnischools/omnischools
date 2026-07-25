import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";

/**
 * R167(e) — the `medical-hold` rewrite from non-sargable `column::date` casts to half-open timestamp
 * ranges. Two things must hold and this file proves both without a DB (local dev is a superuser; a DB
 * test proves nothing about the plan):
 *
 *   1. SARGABILITY — no `<column>::date` cast survives on the three columns the indexes cover, and the
 *      half-open bounds are present (source-shape, the plan is not observable from JS).
 *   2. EQUIVALENCE — the new predicates return the SAME rows as the old ones. This runs on every
 *      register save at every Senior school, so a boundary slip (`<` vs `<=`, an off-by-one day) is a
 *      silent attendance-mark corruption. Ghana is UTC+0 year-round, so a timestamptz's civil date IS
 *      its UTC date and `date::date` is that day's 00:00 — modelled here in UTC and checked across the
 *      exact boundary instants a cast rounds differently.
 */
const SRC = "lib/sickbay/medical-hold.ts";

describe("R167(e) · sargable half-open ranges replace the column::date casts", () => {
  const src = () => readCode(SRC);

  it("no `<column>::date` cast survives on admitted_at / discharged_at / presented_at", () => {
    const s = src();
    expect(s, "admitted_at must be compared BARE").not.toMatch(/admittedAt\}::date/);
    expect(s, "discharged_at must be compared BARE").not.toMatch(/dischargedAt\}::date/);
    expect(s, "presented_at must be compared BARE").not.toMatch(/presentedAt\}::date/);
  });

  it("the cast now sits on the date PARAMETER, with a half-open upper bound", () => {
    const s = src();
    expect(s).toMatch(/\$\{date\}::date \+ interval '1 day'/);
    // admission lower bound on discharge, and the clinic lower bound, are bare `>= ${date}::date`.
    expect(s).toMatch(/>= \$\{date\}::date/);
    // 🔴 24a MINOR-2 (Quinn): the upper bounds must be STRICT `<`, not `<=` — a `<=` would hold a
    // next-midnight admit on the every-register-save path, and the presence checks above don't see it.
    // Pin the strict operator on BOTH upper-bound expressions so that mutation reds here.
    expect(s, "the admission upper bound must be strict `<`").toMatch(
      /admittedAt\}\s*<\s*\$\{date\}::date \+ interval '1 day'/,
    );
    expect(s, "the clinic upper bound must be strict `<`").toMatch(
      /presentedAt\}\s*<\s*\$\{date\}::date \+ interval '1 day'/,
    );
    expect(s, "no `<=` may sneak onto a half-open upper bound").not.toMatch(
      /(admittedAt|presentedAt)\}\s*<=\s*\$\{date\}::date \+ interval/,
    );
  });
});

// The two predicates modelled in UTC (Ghana = UTC+0). `dayStart` = 00:00 of the civil date.
const DAY = 24 * 60 * 60 * 1000;
const admissionOld = (adm: number, dis: number | null, dayStart: number) =>
  Math.floor(adm / DAY) <= Math.floor(dayStart / DAY) &&
  (dis === null || Math.floor(dis / DAY) >= Math.floor(dayStart / DAY));
const admissionNew = (adm: number, dis: number | null, dayStart: number) =>
  adm < dayStart + DAY && (dis === null || dis >= dayStart);
const clinicOld = (pres: number, dayStart: number) =>
  Math.floor(pres / DAY) === Math.floor(dayStart / DAY);
const clinicNew = (pres: number, dayStart: number) =>
  pres >= dayStart && pres < dayStart + DAY;

describe("R167(e) · the half-open ranges return the SAME rows as the ::date casts", () => {
  const dayStart = Date.UTC(2026, 6, 20); // a civil day at 00:00 UTC
  // Boundary instants: the previous night, exact midnights, mid-day, the next midnight.
  const marks = [
    dayStart - 1, // 23:59:59.999 the day before
    dayStart, // exactly 00:00 of the day
    dayStart + 30 * 60 * 1000, // 00:30
    dayStart + DAY / 2, // noon
    dayStart + DAY - 1, // 23:59:59.999 the same day
    dayStart + DAY, // exactly 00:00 the next day
    dayStart + DAY + 1,
  ];

  it("admission arm agrees for every (admitted, discharged) boundary pair", () => {
    for (const adm of marks) {
      for (const dis of [...marks, null]) {
        if (dis !== null && dis < adm) continue; // a discharge cannot precede the admission
        expect(admissionNew(adm, dis, dayStart), `adm=${adm} dis=${dis}`).toBe(
          admissionOld(adm, dis, dayStart),
        );
      }
    }
  });

  it("open-visit arm agrees for every presented-at boundary", () => {
    for (const pres of marks) {
      expect(clinicNew(pres, dayStart), `pres=${pres}`).toBe(clinicOld(pres, dayStart));
    }
  });
});
