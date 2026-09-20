import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import {
  hasAnyRole,
  VLC_DASHBOARD_READ_ROLES,
  VLC_PASTORAL_READ_ROLES,
  VLC_PARAGRAPH_READ_ROLES,
  VLC_CONFIG_READ_ROLES,
} from "@/lib/access";

/**
 * 🔴 INCR-44 · VLC School dashboard — AC VLC44-1..18. Metadata-only rollup + the Form-3 leaver roster; NO new
 * tables, NO journal content, NO widened gate. The CRUX is AC-4/AC-5: the counts-only reader projects ZERO
 * confidential content and the sole-content-path invariant HOLDS (severity/context/surfaced_by stay only in
 * pastoral-data.ts; the casework/paragraph bodies only in pastoral-data.ts/paragraph-data.ts; the dashboard
 * reader in NEITHER list and importing none of the three confidential readers). Static source-analysis +
 * pure-function gate matrices, mirroring vlc-pastoral.test.ts; behavioral live-DB isolation is Sarah/Quinn.
 */
const src = (rel: string) => readFileSync(resolve(cwd(), rel), "utf8");
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const reader = stripComments(src("lib/vlc/dashboard-data.ts"));
const rawReader = src("lib/vlc/dashboard-data.ts"); // un-stripped (for import-shape checks)
const page = stripComments(src("app/(app)/senior/vlc/dashboard/page.tsx"));
const rosterPage = stripComments(src("app/(app)/senior/vlc/reference/page.tsx"));
const tabs = stripComments(src("components/vlc/vlc-tabs.tsx"));
const layout = stripComments(src("app/(app)/senior/vlc/layout.tsx"));
const authz = src("lib/vlc/authz.ts");
const access = src("lib/access.ts");

// The DashboardClassRow interface block (the per-class matrix shape) — bounded so sibling types don't bleed in.
const rowType = reader.slice(
  reader.indexOf("export interface DashboardClassRow"),
  reader.indexOf("export interface CoverageValue"),
);
const rosterType = reader.slice(
  reader.indexOf("export interface LeaverRosterEntry"),
  reader.indexOf("export async function getVlcLeaverRoster"),
);

// ── VLC44-1 · Tier-1 school totals — aggregates, ZERO student identity ──────────────────────────────
describe("VLC44-1 · Tier-1 totals: sessions / attendance / PG / trainings / flags — no student identity", () => {
  it("the view exposes the Tier-1 aggregates", () => {
    for (const field of [
      "sessionsHeld",
      "avgAttendancePct",
      "activePgCount",
      "trainingsDone",
      "trainingPct",
      "reflectionSubmissionPct",
      "coverage",
      "flags",
    ]) {
      expect(reader).toContain(`${field}:`);
    }
  });
  it("no per-student identity leaves the reader (no fullName / firstName / student name projection)", () => {
    // The reader JOINS on student ids but must expose NO student name anywhere in its view types.
    expect(rowType).not.toMatch(/fullName|firstName|studentName/);
    expect(reader.slice(reader.indexOf("export interface DashboardView"), reader.indexOf("export async function getVlcDashboard"))).not.toMatch(/fullName|studentName/);
  });
});

// ── VLC44-2 · Tier-2 per-class matrix + open-flag COUNT — no severity / name / body ─────────────────
describe("VLC44-2 · per-class matrix carries an open-flag COUNT, never a name / severity / why", () => {
  it("the row type has openFlagCount + class-level metrics, and NO student/severity/body field", () => {
    expect(rowType).toContain("openFlagCount:");
    expect(rowType).toMatch(/className:|classId:/);
    expect(rowType).not.toMatch(/severity|context|surfacedBy|studentId|fullName|body|summary/);
  });
});

// ── VLC44-3 · flag-count correctness — open = resolved_at IS NULL, per-class GROUP BY the student's class ─
describe("VLC44-3 · open = resolved_at IS NULL; the per-class count groups by the student's class", () => {
  it("open uses resolved_at IS NULL", () => {
    expect(reader).toMatch(/filter \(where resolved_at is null\)/);
    expect(reader).toMatch(/isNull\(vlcPastoralFlag\.resolvedAt\)/);
  });
  it("the per-class count joins flag→student and groups by students.classId (student_id is a JOIN key)", () => {
    expect(reader).toMatch(/eq\(students\.id,\s*vlcPastoralFlag\.studentId\)/);
    expect(reader).toMatch(/\.groupBy\(students\.classId\)/);
  });
});

// ── VLC44-4 · CRUX — the reader projects ZERO confidential content ──────────────────────────────────
describe("VLC44-4 · dashboard-data.ts SELECTs no severity/context/surfaced_by/body/summary/observed_by", () => {
  it("no drizzle projection of any confidential column (`key: table.col`)", () => {
    // A drizzle SELECT projection is `key: table.column`. A COUNT FILTER predicate (raw `severity = 'CRISIS'`)
    // is NOT a projection — Kofi R343 blesses that form explicitly.
    expect(reader).not.toMatch(/:\s*vlcPastoral\w*\.(severity|context|surfacedBy|body|summary|observedBy)\b/);
  });
  it("the reader never touches the drizzle column object vlcPastoralFlag.severity/context/surfacedBy", () => {
    // Guards the shipped VLC42b sole-content-path walk (which greps the bare substring): the reader references
    // `severity` ONLY as a raw-SQL FILTER predicate, never the drizzle column object.
    expect(reader).not.toMatch(/vlcPastoralFlag\.(severity|context|surfacedBy)/);
  });
  it("the reader never touches the casework/paragraph body tables at all", () => {
    for (const table of ["vlcPastoralNote", "vlcPastoralObservation", "vlcPastoralCase", "vlcPastoralParagraph"]) {
      expect(reader).not.toContain(table);
    }
  });
  it("escalated is a COUNT predicate on severity, not a projection", () => {
    expect(reader).toMatch(/filter \(where severity = 'CRISIS'/);
  });
});

// ── VLC44-5 · CRUX — the sole-content-path invariant HOLDS (repo walk + no confidential-reader import) ─
describe("VLC44-5 · sole-content-path preserved — dashboard reader in NEITHER content list, imports none of the 3 readers", () => {
  const walk = (needle: RegExp): string[] => {
    const offenders: string[] = [];
    const rec = (dir: string) => {
      for (const e of readdirSync(resolve(cwd(), dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) rec(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          if (needle.test(readFileSync(resolve(cwd(), p), "utf8"))) offenders.push(p);
        }
      }
    };
    for (const root of ["app", "components", "features", "hooks", "lib"]) rec(root);
    return offenders;
  };
  it("only pastoral-data.ts projects the 42b flag content (dashboard reader is NOT an offender)", () => {
    const offenders = walk(/vlcPastoralFlag\.(severity|context|surfacedBy)/);
    expect(offenders).toEqual(["lib/vlc/pastoral-data.ts"]);
    expect(offenders).not.toContain("lib/vlc/dashboard-data.ts");
  });
  it("only pastoral-data.ts projects the casework bodies (dashboard reader is NOT an offender)", () => {
    const offenders = walk(/vlcPastoral(?:Journal|Note|Observation)\.body|vlcPastoralCase\.summary/);
    expect(offenders).toEqual(["lib/vlc/pastoral-data.ts"]);
  });
  it("the dashboard reader imports NONE of the three confidential readers", () => {
    // Stripped of comments (the JSDoc NAMES the three readers to document the fence); the CODE imports none.
    for (const forbidden of ["getStudentCasework", "getCharacterParagraph", "getPastoralFlags", "pastoral-data", "paragraph-data"]) {
      expect(reader).not.toContain(forbidden);
    }
  });
  it("the reader is server-only", () => {
    expect(rawReader).toMatch(/^import "server-only";/m);
  });
});

// ── VLC44-6 · audience gate — Dean/HM/ADMIN full; FM/PG/student/parent excluded ─────────────────────
describe("VLC44-6 · VLC_DASHBOARD_READ_ROLES = [DEAN, HM, ADMIN]; FM/PG/student/parent excluded", () => {
  it("the audience is exactly Dean + HM + ADMIN", () => {
    expect([...VLC_DASHBOARD_READ_ROLES].sort()).toEqual(["ADMIN", "DEAN_OF_STUDENTS", "HEADMASTER"]);
  });
  it("FM / PG / student / parent are NOT in the audience", () => {
    for (const barred of ["FORM_MASTER", "PEER_GUIDE", "STUDENT", "PARENT"]) {
      expect(VLC_DASHBOARD_READ_ROLES).not.toContain(barred);
    }
    expect(hasAnyRole(["FORM_MASTER"], VLC_DASHBOARD_READ_ROLES)).toBe(false);
    expect(hasAnyRole(["DEAN_OF_STUDENTS"], VLC_DASHBOARD_READ_ROLES)).toBe(true);
    expect(hasAnyRole(["HEADMASTER"], VLC_DASHBOARD_READ_ROLES)).toBe(true);
    expect(hasAnyRole(["ADMIN"], VLC_DASHBOARD_READ_ROLES)).toBe(true);
  });
  it("the page gates on requireSchoolRole(VLC_DASHBOARD_READ_ROLES)", () => {
    expect(page).toMatch(/requireSchoolRole\(VLC_DASHBOARD_READ_ROLES\)/);
  });
});

// ── VLC44-7 · ADMIN/HM see metadata never content — no drill-in for ADMIN ───────────────────────────
describe("VLC44-7 · ADMIN reaches NO per-student content; the drill-ins are tighter than the page gate", () => {
  it("ADMIN is in the dashboard audience but in NEITHER confidential drill-in set", () => {
    expect(hasAnyRole(["ADMIN"], VLC_DASHBOARD_READ_ROLES)).toBe(true);
    expect(hasAnyRole(["ADMIN"], VLC_PASTORAL_READ_ROLES)).toBe(false); // no journal/case link
    expect(hasAnyRole(["ADMIN"], VLC_PARAGRAPH_READ_ROLES)).toBe(false); // no roster/reference link
  });
  it("HM sees the roster drill-in but NOT the journal/casework drill-in (casework stays FM+Dean)", () => {
    expect(hasAnyRole(["HEADMASTER"], VLC_PARAGRAPH_READ_ROLES)).toBe(true);
    expect(hasAnyRole(["HEADMASTER"], VLC_PASTORAL_READ_ROLES)).toBe(false);
  });
  it("the casework gate stays HM+ADMIN-free (getStudentCasework returns null for them by construction)", () => {
    expect(VLC_PASTORAL_READ_ROLES).not.toContain("HEADMASTER");
    expect(VLC_PASTORAL_READ_ROLES).not.toContain("ADMIN");
  });
  it("the page renders each drill-in only behind its role check", () => {
    expect(page).toMatch(/hasAnyRole\(roles,\s*VLC_PARAGRAPH_READ_ROLES\)/);
    expect(page).toMatch(/hasAnyRole\(roles,\s*VLC_PASTORAL_READ_ROLES\)/);
  });
});

// ── VLC44-8 · the flag-drilldown is OMIT-NOT-FAKE (absent for EVERY role incl. Dean) ─────────────────
describe("VLC44-8 · no per-student flag cards / severity / narrative / pattern anywhere on the dashboard", () => {
  it("the page carries no per-student flag card, severity, welfare narrative, or pattern block", () => {
    for (const forbidden of ["severity", "bereavement", "violence", "flag-card", "flagCard", "pattern", "surfaced", "context"]) {
      expect(page.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

// ── VLC44-9 · drill-in nav is role-gated + every destination self-gates ─────────────────────────────
describe("VLC44-9 · drill-in links are gated; destinations re-enforce their own gate server-side", () => {
  it("the roster link targets the leaver roster, gated to VLC_PARAGRAPH_READ_ROLES", () => {
    expect(page).toMatch(/canReachRoster\s*=\s*hasAnyRole\(roles,\s*VLC_PARAGRAPH_READ_ROLES\)/);
    expect(page).toContain('href="/senior/vlc/reference"');
  });
  it("the casework link targets the gated register path, gated to VLC_PASTORAL_READ_ROLES", () => {
    expect(page).toMatch(/canReachCasework\s*=\s*hasAnyRole\(roles,\s*VLC_PASTORAL_READ_ROLES\)/);
    expect(page).toContain('href="/senior/vlc/sessions"');
  });
  it("the roster destination re-gates on VLC_PARAGRAPH_READ_ROLES", () => {
    expect(rosterPage).toMatch(/requireSchoolRole\(VLC_PARAGRAPH_READ_ROLES\)/);
  });
});

// ── VLC44-10 · the leaver roster is name / class / form ONLY ────────────────────────────────────────
describe("VLC44-10 · roster = full name + class + form only — no paragraph / flag / locked state", () => {
  it("the roster view type carries only directory fields", () => {
    expect(rosterType).toMatch(/fullName:/);
    expect(rosterType).toMatch(/className:/);
    expect(rosterType).toMatch(/formLabel:/);
    expect(rosterType).not.toMatch(/body|locked|paragraph|flag|severity|draft/i);
  });
  it("the roster reader touches no confidential (paragraph/flag/journal) table", () => {
    const rosterFn = reader.slice(reader.indexOf("export async function getVlcLeaverRoster"));
    for (const table of ["vlcPastoralParagraph", "vlcPastoralFlag", "vlcPastoralJournal"]) {
      expect(rosterFn).not.toContain(table);
    }
  });
  it("Form 3 is the leaver cohort (OC3)", () => {
    expect(reader).toMatch(/classFormNumber\([^)]*\)\s*===\s*3/);
  });
});

// ── VLC44-11 · roster gate + click-through self-re-gates at the 43b reader ──────────────────────────
describe("VLC44-11 · roster gated to FM/Dean/HM; each row links to the EXISTING self-re-gating reference route", () => {
  it("the roster page gates to VLC_PARAGRAPH_READ_ROLES and rows deep-link the gated per-student route", () => {
    expect(rosterPage).toMatch(/requireSchoolRole\(VLC_PARAGRAPH_READ_ROLES\)/);
    expect(rosterPage).toMatch(/href=\{`\/senior\/vlc\/reference\/\$\{s\.studentId\}`\}/);
  });
  it("ADMIN cannot reach the roster (not in VLC_PARAGRAPH_READ_ROLES)", () => {
    expect(hasAnyRole(["ADMIN"], VLC_PARAGRAPH_READ_ROLES)).toBe(false);
  });
});

// ── VLC44-12 · NO new schema — Wells has ZERO work ──────────────────────────────────────────────────
describe("VLC44-12 · the increment defines no table / migration / prod-paste (pure read layer)", () => {
  it("the new files declare no pgTable / CREATE TABLE / migration / prod-paste", () => {
    for (const code of [reader, page, rosterPage]) {
      expect(code).not.toMatch(/pgTable|CREATE TABLE|db\/sql\/prod-paste|drizzle-kit|migration/i);
    }
  });
});

// ── VLC44-13 · SCOPE FENCE — the gates/readers stay byte-unchanged except the additive const ────────
describe("VLC44-13 · authz + confidential role sets unchanged; only VLC_DASHBOARD_READ_ROLES is additive", () => {
  it("authz.ts is untouched by INCR-44 (no dashboard reference)", () => {
    expect(authz).not.toMatch(/dashboard|VLC_DASHBOARD/i);
  });
  it("the confidential role sets are unchanged", () => {
    expect([...VLC_PASTORAL_READ_ROLES].sort()).toEqual(["DEAN_OF_STUDENTS", "FORM_MASTER"]);
    expect([...VLC_PARAGRAPH_READ_ROLES].sort()).toEqual(["DEAN_OF_STUDENTS", "FORM_MASTER", "HEADMASTER"]);
    expect([...VLC_CONFIG_READ_ROLES].sort()).toEqual(["ADMIN", "DEAN_OF_STUDENTS", "FORM_MASTER", "HEADMASTER"]);
  });
  it("access.ts adds VLC_DASHBOARD_READ_ROLES as a typed const", () => {
    expect(access).toMatch(/export const VLC_DASHBOARD_READ_ROLES = \[[\s\S]*?\] as const satisfies readonly KnownAppRole\[\]/);
  });
});

// ── VLC44-14 · tenant isolation — every read is scoped by withSchool + school_id ────────────────────
describe("VLC44-14 · all counts run inside withSchool and filter school_id (cross-tenant 0)", () => {
  it("both readers wrap in withSchool(schoolId, …)", () => {
    expect((reader.match(/withSchool\(schoolId,/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("the confidential-table counts filter school_id", () => {
    expect(reader).toMatch(/eq\(vlcPastoralFlag\.schoolId,\s*schoolId\)/);
    expect(reader).toMatch(/eq\(vlcPastoralJournal\.schoolId,\s*schoolId\)/);
  });
});

// ── VLC44-15 · submission is a BARE COUNT (no journal content) ──────────────────────────────────────
describe("VLC44-15 · reflection submission = a bare distinct-student COUNT, never journal body", () => {
  it("submission derives from count(distinct student) over the journal, projecting no body", () => {
    expect(reader).toMatch(/count\(distinct \$\{vlcPastoralJournal\.studentId\}\)/);
    expect(rowType).toContain("submissionPct:");
  });
});

// ── VLC44-16 · header-action honesty — the fake write buttons are OMIT-NOT-FAKE ─────────────────────
describe("VLC44-16 · no 'Export term report' and no 'Open pastoral case file' dead buttons", () => {
  it("the page omits both surface buttons", () => {
    expect(page).not.toContain("Export term report");
    expect(page).not.toContain("Open pastoral case file");
    expect(page).not.toContain("case file");
  });
});

// ── VLC44-17 · curriculum coverage derives from sessions-per-value ──────────────────────────────────
describe("VLC44-17 · coverage = % of classes that reached each value (done/current/upcoming)", () => {
  it("the reader derives coverage per active value and a done/current/upcoming state", () => {
    expect(reader).toContain("coverage:");
    expect(reader).toMatch(/state:\s*CoverageValue\["state"\]|"done"|"current"|"upcoming"/);
    expect(reader).toMatch(/classesByValue/);
  });
});

// ── VLC44-18 · attendance derives present = enrolled − ABSENT ───────────────────────────────────────
describe("VLC44-18 · attendance % derives present-by-default (enrolled − ABSENT rows)", () => {
  it("absent rows are counted and present = enrolled − absent", () => {
    expect(reader).toMatch(/eq\(vlcSessionAttendance\.status,\s*"ABSENT"\)/);
    expect(reader).toMatch(/enrolled\s*-\s*\(absentBySession\.get/);
  });
});

// ── nav — NO DEAD LINKS: the tab row is role-conditional ────────────────────────────────────────────
describe("VLC44 nav · role-conditional tabs — no role gets a tab whose target redirects/notFounds it", () => {
  it("the Dashboard tab is gated to VLC_DASHBOARD_READ_ROLES; the Leavers tab to VLC_PARAGRAPH_READ_ROLES", () => {
    expect(tabs).toMatch(/hasAnyRole\(roles,\s*VLC_DASHBOARD_READ_ROLES\)[\s\S]*senior\/vlc\/dashboard/);
    expect(tabs).toMatch(/hasAnyRole\(roles,\s*VLC_PARAGRAPH_READ_ROLES\)[\s\S]*senior\/vlc\/reference/);
  });
  it("the layout passes the viewer's roles to the tab row", () => {
    expect(layout).toMatch(/<VlcTabs roles=\{user\.roles\}/);
  });
  it("FM gets no Dashboard tab; ADMIN gets no Leavers tab (both would otherwise be dead links)", () => {
    expect(hasAnyRole(["FORM_MASTER"], VLC_DASHBOARD_READ_ROLES)).toBe(false); // no dead Dashboard for FM
    expect(hasAnyRole(["ADMIN"], VLC_PARAGRAPH_READ_ROLES)).toBe(false); // no dead Leavers for ADMIN
    expect(hasAnyRole(["FORM_MASTER"], VLC_PARAGRAPH_READ_ROLES)).toBe(true); // FM keeps the roster (own-class)
  });
});
