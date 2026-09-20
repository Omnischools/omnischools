import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { readCode, filesUnder } from "@/lib/test-utils/source-shape";

/**
 * 🔴 INCR-46 (Kofi R358–R365 · AC VLC46-1..14) — the FIRST & ONLY VLC parent-read: the FM-authored
 * FINALISED leaver character-reference body, own-child only. The reader imports the DB driver
 * (server-only), so — like parent-sickbay-data.test.ts — these are SOURCE-SHAPE assertions: the
 * disclosure boundary is a structural property of the projection + the query + the RLS predicate, not
 * something a superuser DB proves. Sarah's LIVE RLS probe proves the row-access (own-finalised 1,
 * own-draft 0, other-child 0, cross-tenant 0, absent-GUC 0); this proves the column + state + import
 * boundary. `readCode` strips comments, so the deny-list tokens named in the docblocks don't self-trip.
 */
const READER = "lib/parent/parent-reference-data.ts";
const CARD = "components/parent/leaver-reference.tsx";
const PAGE = "app/(parent)/wassce/page.tsx";
const POLICIES = "db/sql/policies.sql";
const PROD_PASTE = "db/sql/prod-paste-0073-parent-leaver-paragraph-scope.sql";

const reader = () => readCode(READER);
const raw = (p: string) => readFileSync(resolve(cwd(), p), "utf8");

/** The keys of the `return { ... }` object inside parentLeaverReferenceTx (no nested braces in it). */
const projectorKeys = (): string[] => {
  const s = reader();
  const from = s.indexOf("export async function parentLeaverReferenceTx");
  const rstart = s.indexOf("return {", from);
  const block = s.slice(rstart, s.indexOf("}", rstart));
  return [...block.matchAll(/^\s*(\w+)[,:]/gm)].map((m) => m[1]).sort();
};

// The five confidential VLC tables (drizzle identifiers) + the three confidential readers/modules the
// parent reader must NEVER touch or import.
const CONFIDENTIAL_TABLES = [
  "vlcPastoralFlag",
  "vlcPastoralJournal",
  "vlcPastoralNote",
  "vlcPastoralObservation",
  "vlcPastoralCase",
];
const CONFIDENTIAL_READERS = [
  "getStudentCasework",
  "getCharacterParagraph",
  "getPastoralFlags",
  "pastoral-data",
  "paragraph-data",
];
// Confidential columns that must never reach the returned shape (AC-5 non-vacuity).
const CONFIDENTIAL_COLUMNS = [
  "severity",
  "context",
  "surfacedBy",
  "surfaced_by",
  "summary",
  "observedBy",
  "observed_by",
];

// ── VLC46-5 · CRUX — body-only projection, non-vacuous (frozen key-set is mutation-killable) ────────
describe("🔴 VLC46-5 · the FROZEN key-set — body + names only, no confidential column", () => {
  it("returns EXACTLY {authorName, body, schoolName, studentFirstName, studentFullName}", () => {
    expect(projectorKeys()).toEqual([
      "authorName",
      "body",
      "schoolName",
      "studentFirstName",
      "studentFullName",
    ]);
  });

  it("returns NO studentId / id / draft-state / lock stamp (studentId is an INPUT filter only)", () => {
    const keys = projectorKeys();
    for (const forbidden of ["studentId", "id", "lockedAt", "locked", "draft", "updatedAt", "status"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("adding any confidential column to the reader REDs this test — none appear anywhere in it", () => {
    const s = reader();
    for (const col of CONFIDENTIAL_COLUMNS) {
      expect(s, `${col} must not appear in the parent reader`).not.toContain(col);
    }
  });

  it("body is the ONLY column projected off vlc_pastoral_paragraph", () => {
    const s = reader();
    // The paragraph table is projected exactly once, for `body`. No other paragraph column is read.
    expect(s).toMatch(/body:\s*vlcPastoralParagraph\.body/);
    expect(s).not.toMatch(/:\s*vlcPastoralParagraph\.(?!body)\w+/);
  });
});

// ── VLC46-6 · exactly one table opens — imports NONE of the confidential readers/tables ─────────────
describe("🔴 VLC46-6 · the reader joins none of the five confidential VLC tables + imports no VLC reader", () => {
  it("references NONE of the five confidential VLC tables (flag/journal/note/observation/case)", () => {
    const s = reader();
    for (const t of CONFIDENTIAL_TABLES) {
      expect(s, `must NOT touch ${t}`).not.toContain(t);
    }
  });

  it("imports NONE of the confidential VLC readers / modules", () => {
    const s = reader();
    for (const r of CONFIDENTIAL_READERS) {
      expect(s, `must NOT import ${r}`).not.toContain(r);
    }
  });

  it("touches ONLY vlc_pastoral_paragraph (+ students, ref_school, ref_user for display)", () => {
    const s = reader();
    expect(s).toContain("vlcPastoralParagraph");
    expect(s).toContain("students");
    expect(s).toContain("schools"); // ref_school — the school name
    expect(s).toContain("users"); // ref_user — the FM author name (the Lucy attribution)
  });
});

// ── VLC46-2 · DRAFT invisible — finalised-only in BOTH the reader (belt) and RLS (braces) ───────────
describe("🔴 VLC46-2 · a DRAFT is never returned — locked_at IS NOT NULL in reader AND RLS", () => {
  it("the reader re-filters isNotNull(lockedAt) (belt-and-suspenders)", () => {
    expect(reader()).toMatch(/isNotNull\(vlcPastoralParagraph\.lockedAt\)/);
  });

  it("the RLS parent_scope on vlc_pastoral_paragraph bakes locked_at IS NOT NULL into the predicate", () => {
    for (const sql of [raw(POLICIES), raw(PROD_PASTE)]) {
      const block = sql.slice(sql.indexOf("CREATE POLICY parent_scope ON vlc_pastoral_paragraph"));
      const policy = block.slice(0, block.indexOf(";"));
      expect(policy).toContain("locked_at IS NOT NULL");
      expect(policy).toContain("parent_student_ids");
    }
  });
});

// ── VLC46-3 · own-child only / IDOR — RLS parent_student_ids + studentId is not a URL param ─────────
describe("🔴 VLC46-3 · own-child only — studentId is a server-resolved INPUT, RLS scopes to the parent", () => {
  it("RLS scopes student_id IN parent_student_ids(school_id, app.current_parent_user)", () => {
    const policy = raw(POLICIES).slice(raw(POLICIES).indexOf("CREATE POLICY parent_scope ON vlc_pastoral_paragraph"));
    expect(policy).toMatch(/student_id IN \(\s*SELECT parent_student_ids/);
    expect(policy).toContain("app.current_parent_user");
  });

  it("the reader takes studentId as an argument (resolved from the guardian link, never a URL param)", () => {
    expect(reader()).toMatch(/loadParentLeaverReference\(\s*schoolId: string,\s*userId: string,\s*studentId: string/);
  });

  it("the PAGE resolves studentId from children[0], not from route params/searchParams", () => {
    const p = readCode(PAGE);
    expect(p).toMatch(/loadParentLeaverReference\(school\.id,\s*user\.id,\s*child\.studentId\)/);
    // the reader call site never passes a params/searchParams-derived id
    expect(p).not.toMatch(/loadParentLeaverReference\([^)]*params/);
  });
});

// ── VLC46-9 · no parent write path (SELECT only) ────────────────────────────────────────────────────
describe("🔴 VLC46-9 · read-only — no insert/update/delete, no server action", () => {
  it("the reader has NO write path", () => {
    const s = reader();
    expect(s).not.toMatch(/\.insert\(/);
    expect(s).not.toMatch(/\.update\(/);
    expect(s).not.toMatch(/\.delete\(/);
  });

  it("the card component mounts no server action / write affordance", () => {
    const c = readCode(CARD);
    expect(c).not.toContain('"use server"');
    expect(c).not.toMatch(/<(button|form)\b/);
    expect(c).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
  });
});

// ── VLC46-14 / D10 · runs under withParentScope ONLY ────────────────────────────────────────────────
describe("🔴 VLC46-14 · withParentScope only (never withSchool / withoutTenantScope), server-only", () => {
  it("the reader is server-only and parent-scoped", () => {
    const s = reader();
    expect(s).toContain('import "server-only"');
    expect(s).toContain("withParentScope");
    expect(s).not.toContain("withSchool");
    expect(s).not.toContain("withoutTenantScope");
  });
});

// ── VLC46-13 · render honesty — section absent when the reader returns nothing ──────────────────────
describe("🔴 VLC46-13 · the card renders ONLY on a finalised own-child paragraph; empty state = absent", () => {
  it("the page gates the card on a truthy reader return ({x && <Card/>}), section-absent on null", () => {
    const p = readCode(PAGE);
    expect(p).toMatch(/leaverReference && \(\s*<div/);
    expect(p).toContain("<LeaverReference reference={leaverReference} />");
    // NO ternary else on the render — a null return renders NOTHING (no "not yet available" placeholder).
    expect(p).not.toMatch(/leaverReference\s*\?/);
    // exactly one leaver-reference render on the tab (no dead duplicate / fallback branch)
    expect(p.match(/<LeaverReference\b/g)?.length ?? 0).toBe(1);
  });

  it("the card carries NO status pill / date-lock stamp / PDF / draft chrome (owner #6)", () => {
    const c = readCode(CARD);
    for (const bad of ["Locked", "Draft", "PDF", "Download", "download", "status", "auto-generated", "auto-drafted"]) {
      expect(c, `card must not render "${bad}"`).not.toContain(bad);
    }
    // the FM's body is rendered verbatim, whitespace-preserved
    expect(c).toContain("whitespace-pre-wrap");
    expect(c).toMatch(/\{body\}/);
  });
});

// ── VLC46-7 / R361 · SCOPE FENCE — exactly one vlc table opens; the staff readers are distinct ───────
describe("🔴 VLC46-7 · scope fence — only vlc_pastoral_paragraph gains parent_scope; staff boundary distinct", () => {
  it("policies.sql: vlc_pastoral_paragraph is the ONLY vlc_* table with an explicit parent_scope", () => {
    const sql = raw(POLICIES);
    const vlcScopes = [...sql.matchAll(/CREATE POLICY parent_scope ON (vlc_\w+)/g)].map((m) => m[1]);
    expect(vlcScopes).toEqual(["vlc_pastoral_paragraph"]);
  });

  it("policies.sql keeps the catalog-driven parent_deny loop that re-affirms every OTHER tenant table", () => {
    // The loop auto-denies every FORCE-RLS + school_id table lacking parent_scope — i.e. every other vlc_*.
    const sql = raw(POLICIES);
    expect(sql).toMatch(/FOR tbl IN[\s\S]*NOT EXISTS[\s\S]*polname = 'parent_scope'/);
    expect(sql).toMatch(/CREATE POLICY parent_deny ON %I/);
  });

  it("the staff paragraph reader stays a DISTINCT withSchool file (parent reader does not import it)", () => {
    // Parent boundary = withParentScope (this reader); staff boundary = withSchool (paragraph-data.ts).
    expect(readCode("lib/vlc/paragraph-data.ts")).toContain("withSchool");
    expect(reader()).not.toContain("canReadPastoralParagraph");
    expect(reader()).not.toContain("VLC_PARAGRAPH_READ_ROLES");
  });
});

// ── VLC46-1 · the own-child finalised read shape (name + body, limit 1) ─────────────────────────────
describe("🔴 VLC46-1 · own-child finalised read — student name + FM author + body, single row", () => {
  it("selects the student name, school name, FM author name, and body; limit 1", () => {
    const s = reader();
    expect(s).toMatch(/studentFirstName:\s*students\.firstName/);
    expect(s).toMatch(/schoolName:\s*schools\.name/);
    expect(s).toMatch(/authorName:\s*users\.fullName/);
    expect(s).toMatch(/\.limit\(1\)/);
  });

  it("the reader file exists exactly once (the sole parent-facing VLC path)", () => {
    expect(filesUnder("lib/parent", /^parent-reference-data\.ts$/)).toEqual([
      "lib/parent/parent-reference-data.ts",
    ]);
  });
});
