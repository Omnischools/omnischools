import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import {
  VLC_CADENCE,
  VLC_PHASES,
  VLC_VALUES,
  VLC_TERM_ARCS,
  coalesceVlcProgramme,
  formatVlcTime,
  formatVlcWindow,
  vlcSessionCount,
  type VlcProgrammeRow,
} from "./defaults";
import { KNOWN_APP_ROLES } from "@/lib/auth";
import { STAFF_ROLES, roleLabel } from "@/lib/staff-roles";
import {
  hasAnyRole,
  rankOf,
  canGrantRole,
  FINANCE_ROLES,
  STAFF_ADMIN_ROLES,
  USER_ADMIN_ROLES,
  SENIOR_LEDGER_ROLES,
  SENIOR_MANAGEMENT_ROLES,
  WASSCE_SETUP_ROLES,
  BOARDING_ROLES,
  BOARDING_SCHOOL_SCOPED_ROLES,
  SICKBAY_ROLES,
  SICKBAY_CONFIG_WRITE_ROLES,
  SICKBAY_STOCK_WRITE_ROLES,
  SICKBAY_CLINICAL_READ_ROLES,
  SICKBAY_CLINICAL_WRITE_ROLES,
  SICKBAY_RECON_READ_ROLES,
  VLC_CONFIG_READ_ROLES,
  VLC_CONFIG_WRITE_ROLES,
} from "@/lib/access";
import {
  SHOWN_AUDIT_ENTITIES,
  REDACTED_AUDIT_ENTITIES,
  isRedactedAuditEntity,
} from "@/lib/audit/redaction";

const src = (rel: string) => readFileSync(resolve(cwd(), rel), "utf8");
/** Strip block + `//` comments (the schema's prose names the omitted columns on purpose). */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const VLC_ENTITIES = ["vlc_programme", "vlc_value", "vlc_session_template"] as const;

// ── VLC40-2 · the singleton programme coalesces to the frozen defaults ──────────────────────────
describe("VLC40-2 · programme coalesce (a missing vlc_programme row is legal)", () => {
  it("a NULL row → Wednesday 2:30 defaults, five phases summing to 60, configured:false", () => {
    const p = coalesceVlcProgramme(null);
    expect(p.configured).toBe(false);
    expect(p.sessionDay).toBe(3);
    expect(p.dayName).toBe("Wednesday");
    expect(p.sessionStart).toBe("14:30");
    expect(p.phases.map((x) => x.min)).toEqual([5, 25, 15, 10, 5]);
    expect(p.totalMin).toBe(60);
    expect(p.endTime).toBe("15:30");
    // names/roles are the frozen editorial, in order
    expect(p.phases.map((x) => x.name)).toEqual([
      "Opener",
      "Small groups",
      "Plenary",
      "Reflection",
      "Close",
    ]);
  });

  it("a stored row → its own values + configured:true from configured_at (NOT a fixed 60)", () => {
    const row: VlcProgrammeRow = {
      sessionDay: 3,
      sessionStart: "15:00",
      openerMin: 10,
      smallGroupMin: 30,
      plenaryMin: 10,
      reflectionMin: 10,
      closeMin: 5,
      configuredAt: new Date(),
    };
    const p = coalesceVlcProgramme(row);
    expect(p.configured).toBe(true);
    expect(p.sessionStart).toBe("15:00");
    expect(p.totalMin).toBe(65); // durations are free — no sum-to-60 invariant
    expect(p.endTime).toBe("16:05");
  });

  it("formats the cal-block time exactly as the surface prints it", () => {
    expect(formatVlcTime("14:30")).toEqual({ time: "2:30", meridiem: "PM" });
    expect(formatVlcWindow("14:30", "15:30")).toBe("2:30 — 3:30 PM");
  });
});

// ── VLC40-3/4 · eleven ordered values, twenty-two derived sessions ──────────────────────────────
describe("VLC40-3/4 · the canonical 11 values + 22 session templates (counts DERIVED)", () => {
  it("has 11 values, ordinals 1..11 in order, term groups 1..3", () => {
    expect(VLC_VALUES.length).toBe(11);
    expect(VLC_VALUES.map((v) => v.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const v of VLC_VALUES) expect(v.termGroup).toBeGreaterThanOrEqual(1);
    for (const v of VLC_VALUES) expect(v.termGroup).toBeLessThanOrEqual(3);
    // term buckets: 1-4 / 5-8 / 9-11
    expect(VLC_VALUES.filter((v) => v.termGroup === 1).map((v) => v.ordinal)).toEqual([1, 2, 3, 4]);
    expect(VLC_VALUES.filter((v) => v.termGroup === 2).map((v) => v.ordinal)).toEqual([5, 6, 7, 8]);
    expect(VLC_VALUES.filter((v) => v.termGroup === 3).map((v) => v.ordinal)).toEqual([9, 10, 11]);
  });

  it("derives 22 sessions — every value carries exactly slot A then slot B", () => {
    expect(vlcSessionCount(VLC_VALUES)).toBe(22);
    for (const v of VLC_VALUES) {
      expect(v.sessions.map((s) => s.slot)).toEqual(["A", "B"]);
      for (const s of v.sessions) expect(s.title.length).toBeGreaterThan(0);
    }
  });

  it("keeps the Twi diacritics and the intra-curriculum cross-reference verbatim", () => {
    const byOrd = new Map(VLC_VALUES.map((v) => [v.ordinal, v]));
    expect(byOrd.get(3)!.nameTwi).toBe("Asɛyɛde");
    expect(byOrd.get(4)!.nameTwi).toBe("Akwankyerɛ");
    expect(byOrd.get(6)!.nameTwi).toBe("Mmɔborɔhunu");
    expect(byOrd.get(7)!.nameTwi).toBe("Ɔman dɔ");
    // value 11 is the capstone (the one config marker); nobody else is
    expect(byOrd.get(11)!.capstone).toBe(true);
    expect(VLC_VALUES.filter((v) => v.capstone)).toHaveLength(1);
    // 7B "Service project planning" ↔ 9B "…paired with Value 7B" (design commitment, preserved)
    expect(byOrd.get(9)!.sessions[1].prompt).toBe("paired with Value 7B");
  });

  it("the three-term arc names + subtitles are the frozen set", () => {
    expect(VLC_TERM_ARCS.map((a) => a.name)).toEqual([
      "Foundations",
      "Interpersonal",
      "Integration",
    ]);
    expect(VLC_TERM_ARCS.map((a) => a.subtitle)).toEqual([
      "· self-formation",
      "· toward others",
      "· into community",
    ]);
  });

  it("the seed + onboarding provision the SAME defaulted set (source-shape, 2 owner-calls)", () => {
    const seed = src("db/seed/vlc.ts");
    expect(seed).toMatch(/VLC_VALUES/);
    expect(seed).toMatch(/vlcSessionTemplate/);
    // onboarding seeds values + templates (NOT a programme row) for every school with a SENIOR tier.
    // The guard is productRows.includes("SENIOR") — NOT productLine === "SENIOR", which collapses
    // COMBINED to BASIC and would strand a COMBINED Dean on the read-only page the gate admits them to
    // (Dex MED-1). The VLC insert block must sit under the productRows guard, ahead of vlcSessionTemplate.
    const onboard = src("lib/actions/onboarding.ts");
    expect(onboard).toMatch(/productRows\.includes\("SENIOR"\)[\s\S]*vlcValue[\s\S]*vlcSessionTemplate/);
    expect(onboard).not.toMatch(/vlcProgramme/); // programme stays null until the Dean configures
  });
});

// ── VLC40-5 · no derived / frozen-lib duplicate columns in the schema ───────────────────────────
describe("VLC40-5 · the schema stores no derivable or frozen-lib duplicate", () => {
  it("vlc.ts has no session_end / total_minutes / term_arc / academic_year / programme_id column", () => {
    // Strip comments first — the schema's prose deliberately NAMES the omitted columns.
    const schema = stripComments(src("db/schema/vlc.ts"));
    for (const forbidden of [
      "session_end",
      "sessionEnd",
      "total_minutes",
      "totalMinutes",
      "term_arc",
      "termArc",
      "academic_year",
      "academicYear",
      "programme_id",
      "programmeId",
    ]) {
      expect(schema, `vlc.ts must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });
});

// ── VLC40-6 · the write gate is present on all three actions ─────────────────────────────────────
describe("VLC40-6 · every VLC mutation is behind the write gate", () => {
  const actions = src("lib/actions/vlc.ts");
  const names = ["updateVlcProgramme", "updateVlcValue", "updateVlcSessionTemplate"] as const;

  it("the shared gate checks VLC_CONFIG_WRITE_ROLES via assertAnyRole", () => {
    expect(actions).toMatch(/assertAnyRole\(VLC_CONFIG_WRITE_ROLES\)/);
  });

  it("each of the three actions routes through authorizeVlcWrite()", () => {
    for (const name of names) {
      const start = actions.indexOf(`export async function ${name}`);
      expect(start, `${name} exported`).toBeGreaterThan(-1);
      const nextExport = actions.indexOf("export async function ", start + 1);
      const body = actions.slice(start, nextExport === -1 ? undefined : nextExport);
      expect(body, `${name} calls the gate`).toMatch(/authorizeVlcWrite\(\)/);
    }
  });

  it("each action audits its own SHOWN entity", () => {
    expect(actions).toMatch(/entityType: "vlc_programme"/);
    expect(actions).toMatch(/entityType: "vlc_value"/);
    expect(actions).toMatch(/entityType: "vlc_session_template"/);
  });
});

// ── VLC40-8/9/10 · DEAN_OF_STUDENTS is a known, assignable, rank-1, inert role ───────────────────
describe("VLC40-8/9/10 · the DEAN_OF_STUDENTS role", () => {
  it("is in KNOWN_APP_ROLES and the assignable STAFF_ROLES with a label", () => {
    expect((KNOWN_APP_ROLES as readonly string[]).includes("DEAN_OF_STUDENTS")).toBe(true);
    expect(STAFF_ROLES.some((r) => r.code === "DEAN_OF_STUDENTS")).toBe(true);
    expect(roleLabel("DEAN_OF_STUDENTS")).toBe("Dean of Students");
  });

  it("is rank-1 (any other staff role) — never a manager rank", () => {
    expect(rankOf(["DEAN_OF_STUDENTS"])).toBe(1);
  });

  it("escalation: an ADMIN may grant it; a Dean may NOT grant ADMIN or PROPRIETOR", () => {
    expect(canGrantRole(["ADMIN"], "DEAN_OF_STUDENTS")).toBe(true); // 1 <= 2
    expect(canGrantRole(["DEAN_OF_STUDENTS"], "DEAN_OF_STUDENTS")).toBe(true); // peers
    expect(canGrantRole(["DEAN_OF_STUDENTS"], "ADMIN")).toBe(false); // 2 > 1
    expect(canGrantRole(["DEAN_OF_STUDENTS"], "PROPRIETOR")).toBe(false); // 3 > 1
  });

  it("is INERT — a member of the two VLC groups and NO other access group", () => {
    expect(hasAnyRole(["DEAN_OF_STUDENTS"], VLC_CONFIG_READ_ROLES)).toBe(true);
    expect(hasAnyRole(["DEAN_OF_STUDENTS"], VLC_CONFIG_WRITE_ROLES)).toBe(true);
    const otherGroups: readonly (readonly string[])[] = [
      FINANCE_ROLES,
      STAFF_ADMIN_ROLES,
      USER_ADMIN_ROLES,
      SENIOR_LEDGER_ROLES,
      SENIOR_MANAGEMENT_ROLES,
      WASSCE_SETUP_ROLES,
      BOARDING_ROLES,
      BOARDING_SCHOOL_SCOPED_ROLES,
      SICKBAY_ROLES,
      SICKBAY_CONFIG_WRITE_ROLES,
      SICKBAY_STOCK_WRITE_ROLES,
      SICKBAY_CLINICAL_READ_ROLES,
      SICKBAY_CLINICAL_WRITE_ROLES,
      SICKBAY_RECON_READ_ROLES,
    ];
    for (const g of otherGroups) {
      expect(g.includes("DEAN_OF_STUDENTS"), `must be inert in ${g.join(",")}`).toBe(false);
    }
  });
});

// ── VLC40-11 · no appRoleEnum change ────────────────────────────────────────────────────────────
describe("VLC40-11 · the pg app_role enum is NOT touched", () => {
  it("db/schema/_enums.ts's appRoleEnum does not gain DEAN_OF_STUDENTS", () => {
    const enums = src("db/schema/_enums.ts");
    const start = enums.indexOf('pgEnum("app_role"');
    const block = enums.slice(start, enums.indexOf("]", start));
    expect(block).not.toContain("DEAN_OF_STUDENTS");
  });
});

// ── VLC40-12/13 · the three entities are SHOWN; no pastoral redaction branch yet ─────────────────
describe("VLC40-12/13 · audit classification", () => {
  it("all three vlc entities are SHOWN and never redacted (config, no PII)", () => {
    for (const e of VLC_ENTITIES) {
      expect(SHOWN_AUDIT_ENTITIES.has(e), `${e} SHOWN`).toBe(true);
      expect(REDACTED_AUDIT_ENTITIES.has(e), `${e} not redacted`).toBe(false);
      expect(isRedactedAuditEntity(e), `${e} predicate not redacting`).toBe(false);
    }
  });

  it("a reserved vlc_pastoral_* entity is NOT redacted today (INCR-42/43 introduces that family)", () => {
    expect(isRedactedAuditEntity("vlc_pastoral_case")).toBe(false);
  });
});

// ── nav label discipline ────────────────────────────────────────────────────────────────────────
describe("nav · the sidebar item is 'Student support', never 'Pastoral'", () => {
  const sidebar = src("components/app/sidebar.tsx");
  it("adds the /senior/vlc/setup item labelled 'Student support'", () => {
    expect(sidebar).toMatch(/label: "Student support"/);
    expect(sidebar).toMatch(/href: "\/senior\/vlc\/setup"/);
  });
  it("never labels a nav item 'Pastoral'", () => {
    expect(sidebar).not.toMatch(/label: "Pastoral/);
  });
});

// self-check: the frozen cadence + phase fields line up with the vlc_programme columns
describe("frozen contract self-check", () => {
  it("the five phase fields are the five editable programme columns", () => {
    expect(VLC_PHASES.map((p) => p.field)).toEqual([
      "openerMin",
      "smallGroupMin",
      "plenaryMin",
      "reflectionMin",
      "closeMin",
    ]);
    expect(VLC_CADENCE.sessionDay).toBe(3);
    expect(VLC_CADENCE.sessionStart).toBe("14:30");
  });
});
