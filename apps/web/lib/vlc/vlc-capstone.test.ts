import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { canAccessPastoralFlag } from "./authz";

/**
 * 🔴 INCR-45 · VLC Capstone — AC VLC45-1..15. Retires the INCR-13 boarding pastoral STUB and wires the
 * real `vlc_pastoral_flag` existence read, preserving the INCR-30 non-disclosure. Static source + repo-walk
 * guards (the vlc-pastoral.test.ts idiom) prove every invariant a read + a pure function can: the existence
 * helper projects NO confidential column, boarding never SELECTs the flag table, bypass parity (manual +
 * auto, any severity), the OC1 gated link vs signpost, and complete retirement (zero residual, stub deleted).
 * Behavioral live-DB read/RLS is Quinn/Sarah's gate.
 */
const src = (rel: string) => readFileSync(resolve(cwd(), rel), "utf8");
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const HELPER = "lib/vlc/pastoral-flags.ts";
const helper = stripComments(src(HELPER));
const disciplineCore = stripComments(src("lib/boarding/discipline-core.ts"));
const disciplineData = stripComments(src("lib/boarding/discipline-data.ts"));
const rosterData = stripComments(src("lib/boarding/roster-data.ts"));
const visitingData = stripComments(src("lib/boarding/visiting-data.ts"));
const visitingNotify = stripComments(src("lib/boarding/visiting-notify.ts"));
const page = stripComments(src("app/(app)/senior/boarding/discipline/page.tsx"));
// The pastoral card render only — the ledger/ladder elsewhere on the page legitimately renders `severity`.
const pastoralCard = page.slice(page.indexOf("board.pastoral.length"), page.indexOf("function LadderRow"));

const BOARDING_CONSUMERS = [
  "lib/boarding/discipline-core.ts",
  "lib/boarding/discipline-data.ts",
  "lib/boarding/roster-data.ts",
  "lib/boarding/visiting-data.ts",
  "lib/boarding/visiting-notify.ts",
];

// The confidential columns the helper must NEVER project (the INCR-30 invariant).
const CONFIDENTIAL = /vlcPastoralFlag\.(severity|context|surfacedBy|body)/;

// ── VLC45-1 · helper shape + EXISTENCE-ONLY (mutation → sole-content sweep RED) ─────────────────────
describe("VLC45-1 · pastoral-flags.ts is server-only and projects EXISTENCE ONLY (id / student_id)", () => {
  it("server-only + exports exactly the two existence helpers", () => {
    expect(helper).toMatch(/^import "server-only";/m);
    expect(helper).toMatch(/export async function hasActivePastoralFlag\(/);
    expect(helper).toMatch(/export async function activePastoralFlagStudentIds\(/);
  });
  it("projects ONLY vlcPastoralFlag.id / .studentId — NEVER severity/context/surfaced_by/body", () => {
    // NON-VACUOUS: this is the mutation guard. Adding a severity projection here fails BOTH this assertion
    // and the shipped sole-content-path walk (vlc-pastoral.test.ts VLC42b-7, which offenders==[pastoral-data]).
    expect(helper).not.toMatch(CONFIDENTIAL);
    expect(helper).toMatch(/select\(\{\s*id:\s*vlcPastoralFlag\.id\s*\}\)/);
    expect(helper).toMatch(/select\(\{\s*studentId:\s*vlcPastoralFlag\.studentId\s*\}\)/);
  });
  it("the sole-content-path walk still names pastoral-data.ts alone (helper is NOT an offender)", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(resolve(cwd(), dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          if (CONFIDENTIAL.test(readFileSync(resolve(cwd(), p), "utf8"))) offenders.push(p);
        }
      }
    };
    for (const root of ["app", "components", "features", "hooks", "lib"]) walk(root);
    expect(offenders).toEqual(["lib/vlc/pastoral-data.ts"]);
  });
});

// ── VLC45-2 · ACTIVE = resolved_at IS NULL, severity-blind ─────────────────────────────────────────
describe("VLC45-2 · active = resolved_at IS NULL, and the helper is severity-blind", () => {
  it("both queries filter isNull(resolvedAt) and reference no severity", () => {
    expect((helper.match(/isNull\(vlcPastoralFlag\.resolvedAt\)/g) ?? []).length).toBe(2);
    expect(helper).not.toContain("severity");
  });
});

// ── VLC45-3 · tenant-scoped ─────────────────────────────────────────────────────────────────────────
describe("VLC45-3 · every helper query is tenant-scoped on school_id", () => {
  it("both queries carry eq(vlcPastoralFlag.schoolId, schoolId)", () => {
    expect((helper.match(/eq\(vlcPastoralFlag\.schoolId,\s*schoolId\)/g) ?? []).length).toBe(2);
  });
});

// ── VLC45-4/12 · boarding NEVER SELECTs the flag table — only the helper (INCR-30 across consumers) ──
describe("VLC45-4/12 · boarding consumes only the helper — never SELECTs vlc_pastoral_flag", () => {
  it("no boarding consumer references the flag table object or imports it from the schema", () => {
    for (const f of BOARDING_CONSUMERS) {
      const code = stripComments(src(f));
      expect(code, `${f} must not touch vlcPastoralFlag`).not.toContain("vlcPastoralFlag");
      expect(code, `${f} must import the VLC helper`).toMatch(/from "@\/lib\/vlc\/pastoral-flags"/);
    }
  });
  it("single-student sites use hasActivePastoralFlag; roster/list sites use the id-Set", () => {
    expect(disciplineCore).toMatch(/hasActivePastoralFlag\(tx,\s*schoolId,\s*studentId\)/);
    expect(visitingNotify).toMatch(/hasActivePastoralFlag\(tx,\s*schoolId,\s*v\.studentId\)/);
    for (const code of [disciplineData, rosterData, visitingData]) {
      expect(code).toMatch(/activePastoralFlagStudentIds\(tx,\s*schoolId\)/);
      expect(code).toMatch(/flaggedIds\.has\(/);
    }
  });
});

// ── VLC45-5/6/7 · bypass parity — manual + auto, severity-agnostic ─────────────────────────────────
describe("VLC45-5/6/7 · bypass parity — manual AND auto, ANY severity, one audit, zero infraction", () => {
  it("the shared insert site bypasses on the existence read → {bypassed} + one audit, before the insert", () => {
    const branch = disciplineCore.slice(
      disciplineCore.indexOf("if (await hasActivePastoralFlag"),
      disciplineCore.indexOf(".insert(boardingInfractions)"),
    );
    expect(branch).toMatch(/recordAudit\(tx,/);
    expect(branch).toContain('return { status: "bypassed" }');
    // exactly one audit call in the bypass branch, and NO infraction insert before the return
    expect((branch.match(/recordAudit\(/g) ?? []).length).toBe(1);
    expect(branch).not.toContain("insert(boardingInfractions)");
  });
  it("MANUAL and AUTO both route through the shared insertInfraction site (so the bypass covers both)", () => {
    // manual log + the overstay auto-log both call insertInfraction, which holds the single bypass.
    expect(visitingNotify).toMatch(/insertInfraction\(tx,\s*\{/);
    expect(disciplineCore).toMatch(/export async function insertInfraction\(/);
  });
  it("severity-agnostic — the bypass depends on existence only, never on a severity threshold (OC2)", () => {
    // helper is severity-blind (VLC45-2) and the core reads only the boolean → NOTE bypasses exactly as CRISIS.
    expect(helper).not.toContain("severity");
    expect(disciplineCore).not.toMatch(/hasActivePastoralFlag[\s\S]{0,80}(CRISIS|CONCERN|threshold)/);
  });
});

// ── VLC45-8 · routedTo honest + reason VERBATIM (INCR-30 redaction lockstep) ───────────────────────
describe("VLC45-8 · routedTo is honest (no stub) and the neutralized reason stays verbatim", () => {
  it("routedTo is the VLC-pastoral owner, the '(VLC 4.5 stub)' tag is gone", () => {
    expect(disciplineCore).toContain('routedTo: "Dean of Students · VLC pastoral"');
    expect(disciplineCore).not.toContain("VLC 4.5 stub");
    expect(disciplineCore).not.toContain("Dean of Boarding (VLC");
  });
  it("the human-readable reason is UNCHANGED — the INCR-30 write-site redaction", () => {
    expect(disciplineCore).toContain('reason: "Discipline routing — details restricted"');
  });
});

// ── VLC45-9/10/11 · OC1 gated link vs signpost, no dead link, destination self-re-gates ────────────
describe("VLC45-9/10/11 · OC1 — gated case-file link vs INCR-30 signpost; /journal self-re-gates", () => {
  it("the card is server-gated: canViewCase = canAccessPastoralFlag on the flagged student's class teacher", () => {
    expect(disciplineData).toMatch(/classTeacherUserId:\s*classes\.classTeacherUserId/);
    expect(disciplineData).toMatch(/canViewCase:\s*canAccessPastoralFlag\(\{\s*roles,\s*userId,\s*classTeacherUserId/);
    expect(disciplineData).toMatch(/studentId:\s*b\.id/);
  });
  it("gated arm → a real Link to the confidential journal; the honest copy, no stub/case-number", () => {
    expect(page).toMatch(/p\.canViewCase\s*\?/);
    expect(page).toMatch(/<Link\s+href=\{`\/senior\/vlc\/journal\/\$\{p\.studentId\}`\}/);
    expect(page).toContain("↳ Open VLC case file");
  });
  it("non-gated arm → a plain span signpost, NO link, NO severity/reason/case-number (OC1 · no dead link)", () => {
    // the else-branch affordance is a <span>, and the card mentions neither severity nor a case number.
    expect(page).toMatch(/\)\s*:\s*\(\s*<span/);
    expect(page).toContain("↳ Dean-routed · action is routed to the Dean before the ledger");
    for (const leak of ["case 2026", "CONCERN", "CRISIS", "severity", "surfaced"]) {
      expect(pastoralCard, `the card must not leak ${leak}`).not.toContain(leak);
    }
  });
  it("the meta count DERIVES from the real result — never a hardcoded '1 STUDENT FLAGGED'", () => {
    expect(page).not.toContain("1 STUDENT FLAGGED");
    expect(page).toMatch(/board\.pastoral\.length/);
  });
  it("the destination /senior/vlc/journal/[studentId] self-re-gates (notFound for a non-gated viewer)", () => {
    const journal = src("app/(app)/senior/vlc/journal/[studentId]/page.tsx");
    expect(journal).toMatch(/requireSchoolRole\(VLC_PASTORAL_READ_ROLES\)/);
    expect(journal).toMatch(/getStudentCasework\(/);
    expect(journal).toMatch(/if \(!view\) notFound\(\)/);
  });
});

// ── VLC45-9 (pure) · the gate matrix — Dean / own-class FM open; everyone else signposts ────────────
describe("VLC45-9 · canAccessPastoralFlag — the OC1 gate (Dean OR own-class-FM identity)", () => {
  const gate = (roles: string[], userId: string | null, ct: string | null) =>
    canAccessPastoralFlag({ roles, userId, classTeacherUserId: ct });
  it("Dean of Students opens any case; the flagged student's own-class FM opens theirs", () => {
    expect(gate(["DEAN_OF_STUDENTS"], "d1", "fmA")).toBe(true);
    expect(gate(["FORM_MASTER"], "fmA", "fmA")).toBe(true);
  });
  it("Housemaster / HM / Admin / an OTHER-class FM all signpost (no link) — never a dead link", () => {
    expect(gate(["HOUSEMASTER"], "h1", "fmA")).toBe(false);
    expect(gate(["HEADMASTER"], "hm1", "fmA")).toBe(false);
    expect(gate(["ADMIN"], "a1", "fmA")).toBe(false);
    expect(gate(["FORM_MASTER"], "fmB", "fmA")).toBe(false); // 🔴 the IDOR fence — different identity
  });
});

// ── VLC45-13/14 · complete retirement + test re-home + redaction lockstep ──────────────────────────
describe("VLC45-13/14 · complete retirement — zero residual, stub deleted, tests re-homed in lockstep", () => {
  it("the stub module is DELETED", () => {
    expect(existsSync(resolve(cwd(), "lib/boarding/pastoral-stub.ts"))).toBe(false);
  });
  it("ZERO residual in shipping code (excludes test files, which assert the absence)", () => {
    const residual = ["isPastorallyFlagged", "pastoral-stub", "VLC 4.5 stub"];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(resolve(cwd(), dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const code = readFileSync(resolve(cwd(), p), "utf8");
          if (residual.some((r) => code.includes(r))) offenders.push(p);
        }
      }
    };
    for (const root of ["app", "components", "features", "hooks", "lib"]) walk(root);
    expect(offenders).toEqual([]);
  });
  it("discipline.test.ts no longer imports the deleted stub; redaction.test.ts moved in lockstep", () => {
    const disciplineTest = src("lib/boarding/discipline.test.ts");
    expect(disciplineTest).not.toContain("isPastorallyFlagged");
    expect(disciplineTest).not.toContain("pastoral-stub");
    const redactionTest = src("lib/audit/redaction.test.ts");
    expect(redactionTest).toContain("Dean of Students · VLC pastoral"); // fixture moved to the new routedTo
    expect(redactionTest).not.toContain("Dean of Boarding (VLC 4.5 stub)"); // the old literal is gone
    expect(redactionTest).toContain("Discipline routing — details restricted"); // reason assertion unchanged
  });
});

// ── VLC45-15 · seed continuity — J. Manu's bypass now rides the real flag row ──────────────────────
describe("VLC45-15 · seed continuity — the ACTIVE flag on ASK-24-0118 drives the bypass (not the stub Set)", () => {
  it("the VLC seed plants ONE active flag (no resolved_at) on Joseph Manu (ASK-24-0118)", () => {
    const seed = stripComments(src("db/seed/vlc.ts"));
    expect(seed).toContain("ASK-24-0118");
    expect(seed).toMatch(/insert\(vlcPastoralFlag\)/);
    // active = resolved_at unset at insert; a later resolve (resolved_at set) drops it from the helper's
    // isNull(resolvedAt) filter, so a resolved flag no longer protects — the continuity contract.
    const insert = seed.slice(seed.indexOf("insert(vlcPastoralFlag)"), seed.indexOf("returning({ id: vlcPastoralFlag.id })"));
    expect(insert).not.toContain("resolvedAt");
  });
});
