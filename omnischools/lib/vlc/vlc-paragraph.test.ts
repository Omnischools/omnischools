import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { canAccessPastoralFlag, canReadPastoralParagraph, canWritePastoralFlag } from "./authz";
import {
  VLC_PARAGRAPH_READ_ROLES,
  VLC_PASTORAL_READ_ROLES,
  VLC_PASTORAL_WRITE_ROLES,
} from "@/lib/access";
import {
  SHOWN_AUDIT_ENTITIES,
  REDACTED_AUDIT_ENTITIES,
  isRedactedAuditEntity,
} from "@/lib/audit/redaction";

/**
 * 🔴 INCR-43b · VLC Character paragraph — AC VLC43b-1..16. The ONE VLC table with a WIDER read set (+HM,
 * paragraph-only). The write machinery is 43a-cleared and REUSED VERBATIM (`canWritePastoralFlag`); the READ
 * adds a school-wide HEADMASTER arm via a NEW gate (`canReadPastoralParagraph`), a NEW role const
 * (VLC_PARAGRAPH_READ_ROLES), and a SEPARATE reader (`paragraph-data.ts`) behind a SEPARATE route — the 43a
 * casework gate / reader / journal page are UNCHANGED, and the shipped VLC43a-21 fence stays green (43b lives
 * in NEW files + schema the fence doesn't scan). Pure-gate matrices + source-shape guards, mirroring
 * vlc-casework.test.ts. AC-5 (the read matrix) is the crux: the HM is admitted by role but FINALISED-ONLY in
 * the reader; an other-class FM is refused by the own-class identity clause.
 */
const src = (rel: string) => readFileSync(resolve(cwd(), rel), "utf8");
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const schema = stripComments(src("db/schema/vlc.ts"));
const paraBlock = schema.slice(schema.indexOf("export const vlcPastoralParagraph ="));

const reader = stripComments(src("lib/vlc/paragraph-data.ts"));
const writer = stripComments(src("lib/actions/vlc-paragraph.ts"));
const page = stripComments(src("app/(app)/senior/vlc/reference/[studentId]/page.tsx"));
const card = stripComments(src("components/vlc/character-paragraph.tsx"));
const seed = stripComments(src("db/seed/vlc.ts"));
const prodPaste = src("db/sql/prod-paste-0072-vlc-paragraph.sql");
const policies = src("db/sql/policies.sql");

const TABLE = "vlc_pastoral_paragraph";

// The four 43a confidential files the VLC43a-21 fence scans (page = the 43a journal page, NOT this route).
const FENCED_43A = [
  "lib/vlc/pastoral-data.ts",
  "lib/actions/vlc-casework.ts",
  "components/vlc/casework.tsx",
  "app/(app)/senior/vlc/journal/[studentId]/page.tsx",
  "lib/actions/vlc-pastoral.ts",
];

// ── VLC43b-1 · the table shape — per-student, editable-in-place, composite FK ──────────────────────
describe("VLC43b-1 · vlc_pastoral_paragraph — ONE editable row per student, composite FK, caps", () => {
  it("student composite FK (CASCADE) + body ≤3000 + author/updated_by/locked stamps", () => {
    expect(paraBlock).toMatch(/studentId:\s*uuid\("student_id"\)\.notNull\(\)/);
    expect(paraBlock).toMatch(/body:\s*text\("body"\)\.notNull\(\)/);
    expect(paraBlock).toMatch(/authorUserId:\s*uuid\("author_user_id"\)/);
    expect(paraBlock).toMatch(/updatedByUserId:\s*uuid\("updated_by_user_id"\)/);
    expect(paraBlock).toMatch(/lockedAt:\s*timestamp\("locked_at"/);
    expect(paraBlock).toMatch(/lockedByUserId:\s*uuid\("locked_by_user_id"\)/);
    expect(paraBlock).toMatch(/foreignColumns:\s*\[students\.schoolId,\s*students\.id\]/);
    expect(paraBlock).toContain("vlc_pastoral_paragraph_body_len");
    expect(paraBlock).toMatch(/<=\s*3000/);
  });
  it("EDITABLE-in-place (unlike the 43a append-only tables): carries updated_at + is LEAF (no tenant_uk)", () => {
    expect(paraBlock).toMatch(/updatedAt:\s*timestamp\("updated_at"/);
    expect(paraBlock).not.toContain("tenant_uk");
  });
});

// ── VLC43b-2 · auto-redaction via the vlc_pastoral_ prefix (ZERO redaction.ts edit) ────────────────
describe("VLC43b-2 · vlc_pastoral_paragraph REDACTS via the prefix (guard green, zero enumeration edits)", () => {
  it("isRedactedAuditEntity is true via the prefix; not in SHOWN, not enumerated", () => {
    expect(isRedactedAuditEntity(TABLE)).toBe(true);
    expect(SHOWN_AUDIT_ENTITIES.has(TABLE)).toBe(false);
    expect(REDACTED_AUDIT_ENTITIES.has(TABLE)).toBe(false);
  });
});

// ── VLC43b-3 · the role constant — VLC_PASTORAL_READ_ROLES UNCHANGED, a NEW +HM paragraph const ────
describe("VLC43b-3 · VLC_PARAGRAPH_READ_ROLES = [FM, DEAN, HM]; VLC_PASTORAL_READ_ROLES UNCHANGED (HM-free)", () => {
  it("the paragraph read set adds HEADMASTER; the 43a casework set stays FM+DEAN, HM-free", () => {
    expect([...VLC_PARAGRAPH_READ_ROLES].sort()).toEqual([
      "DEAN_OF_STUDENTS",
      "FORM_MASTER",
      "HEADMASTER",
    ]);
    expect(VLC_PARAGRAPH_READ_ROLES).toContain("HEADMASTER");
    // 🔴 the scope fence — the 43a casework read set MUST stay HM-free (VLC43a-21 depends on it).
    expect([...VLC_PASTORAL_READ_ROLES].sort()).toEqual(["DEAN_OF_STUDENTS", "FORM_MASTER"]);
    expect(VLC_PASTORAL_READ_ROLES).not.toContain("HEADMASTER");
    for (const barred of ["ADMIN", "STUDENT", "PARENT", "PEER_GUIDE"]) {
      expect(VLC_PARAGRAPH_READ_ROLES).not.toContain(barred);
    }
  });
});

// ── VLC43b-4 · the read gate helper — 43a gate + a school-wide HM arm, FM stays own-class identity ─
describe("VLC43b-4 · canReadPastoralParagraph = canAccessPastoralFlag || HEADMASTER (FM identity kept)", () => {
  it("Dean + HM are school-wide role arms; FM is the own-class identity (never a bare role check)", () => {
    // own-class FM in → true; a DIFFERENT-class FM → false (the IDOR fence)
    expect(canReadPastoralParagraph({ roles: ["FORM_MASTER"], userId: "fmA", classTeacherUserId: "fmA" })).toBe(true);
    expect(canReadPastoralParagraph({ roles: ["FORM_MASTER"], userId: "fmB", classTeacherUserId: "fmA" })).toBe(false);
    // Dean + HM reach any class (school-wide)
    expect(canReadPastoralParagraph({ roles: ["DEAN_OF_STUDENTS"], userId: "x", classTeacherUserId: "fmA" })).toBe(true);
    expect(canReadPastoralParagraph({ roles: ["HEADMASTER"], userId: "x", classTeacherUserId: "fmA" })).toBe(true);
    // the gate never widens the FM arm to a bare role check
    expect(reader).not.toMatch(/roles\.includes\("FORM_MASTER"\)/);
  });
});

// ── VLC43b-5 · THE CRUX — the read matrix (own-class FM any-state / Dean all / HM FINALISED-only / 0) ─
describe("VLC43b-5 · read matrix: own-class FM + Dean any-state; HM finalised-only; other-class FM/ADMIN/PG/student/parent = 0", () => {
  const rd = (roles: string[], userId: string, ct: string) =>
    canReadPastoralParagraph({ roles, userId, classTeacherUserId: ct });

  it("own-class FM = read (any state); OTHER-class FM = 0 (same role, IDOR fence); Dean = read; HM admitted", () => {
    expect(rd(["FORM_MASTER"], "fmA", "fmA")).toBe(true);
    expect(rd(["FORM_MASTER"], "fmB", "fmA")).toBe(false);
    expect(rd(["DEAN_OF_STUDENTS"], "d", "fmA")).toBe(true);
    expect(rd(["HEADMASTER"], "h", "fmA")).toBe(true);
  });
  it("ADMIN = 0, PG = 0, student = 0, parent = 0 (never admitted to the paragraph)", () => {
    for (const r of ["ADMIN", "PEER_GUIDE", "STUDENT", "PARENT"]) {
      expect(rd([r], "u", "fmA"), `${r} must be 0`).toBe(false);
    }
  });
  it("the reader narrows the HM (a non-author) to FINALISED-only; authors (FM/Dean) read ANY state", () => {
    // finalised derives from locked_at; a non-author with no finalised paragraph gets null (a draft is 0 for HM)
    expect(reader).toMatch(/const finalised = !!row\?\.lockedAt/);
    expect(reader).toMatch(/if \(!canAccess && !finalised\) return null/);
    // canAccess = the AUTHORS (own-class FM / Dean) — they are NOT gated by finalised (read any state)
    expect(reader).toMatch(/const canAccess = canAccessPastoralFlag\(gateInput\)/);
  });
});

// ── VLC43b-6 · HM ONE-TABLE-WIDE — the paragraph reader is a DISTINCT file, never the casework path ─
describe("VLC43b-6 · HM reads the paragraph AND nothing else confidential (distinct reader, casework HM-free)", () => {
  it("getStudentCasework stays HM-free (VLC_PASTORAL_READ_ROLES excludes HM → null for HM, journal notFound)", () => {
    expect(VLC_PASTORAL_READ_ROLES).not.toContain("HEADMASTER");
    expect(VLC_PARAGRAPH_READ_ROLES).toContain("HEADMASTER");
  });
  it("the paragraph reader NEVER imports getStudentCasework and NEVER queries the four casework tables", () => {
    expect(reader).toMatch(/^import "server-only";/m);
    expect(reader).not.toContain("getStudentCasework");
    expect(reader).not.toContain("pastoral-data");
    // no casework table / body projection anywhere in the reader (the projection IS the boundary)
    expect(reader).not.toMatch(/vlcPastoral(Journal|Note|Observation|Case)/);
    expect(reader).not.toContain("vlcPastoralCase.summary");
  });
});

// ── VLC43b-7 · the WRITE gate — reused verbatim; HM refused (read-only) ────────────────────────────
describe("VLC43b-7 · write = canWritePastoralFlag (own-class FM / Dean); HM / ADMIN / other-class FM refused", () => {
  it("write === the 43a gate (never widened); HM never passes it", () => {
    expect(canWritePastoralFlag).toBe(canAccessPastoralFlag);
    expect(canWritePastoralFlag({ roles: ["FORM_MASTER"], userId: "u1", classTeacherUserId: "u1" })).toBe(true);
    expect(canWritePastoralFlag({ roles: ["DEAN_OF_STUDENTS"], userId: "x", classTeacherUserId: "u1" })).toBe(true);
    for (const roles of [["HEADMASTER"], ["ADMIN"], ["FORM_MASTER"], ["PEER_GUIDE"], ["STUDENT"], ["PARENT"]] as const) {
      // classTeacherUserId u2 ≠ userId u1 → the identity arm fails for every non-Dean role (HM read-only)
      expect(canWritePastoralFlag({ roles: [...roles], userId: "u1", classTeacherUserId: "u2" })).toBe(false);
    }
    expect(VLC_PASTORAL_WRITE_ROLES).not.toContain("HEADMASTER");
  });
  it("both actions role-gate (WRITE_ROLES) AND re-run canWritePastoralFlag before the mutation; HM absent", () => {
    expect(writer).toMatch(/hasAnyRole\(roles,\s*VLC_PASTORAL_WRITE_ROLES\)/);
    expect(writer).toMatch(/canWritePastoralFlag\(\{\s*roles,\s*userId:\s*actorId,\s*classTeacherUserId/);
    for (const fn of ["saveCharacterParagraph", "lockCharacterParagraph"]) {
      const start = writer.indexOf(`export async function ${fn}`);
      expect(start, `${fn} exported`).toBeGreaterThan(-1);
      const next = writer.indexOf("export async function ", start + 1);
      const body = writer.slice(start, next === -1 ? undefined : next);
      expect(body, `${fn} gates the write`).toMatch(/mayWriteFor\(/);
    }
    // the page renders the Edit/Lock affordances ONLY for a writer (HM read-only)
    expect(card).toMatch(/canWrite && !locked/);
  });
});

// ── VLC43b-8 · PROVENANCE (#6) — FM-authored, NO machine derivation (writer + reader) ──────────────
describe("VLC43b-8 · FM-authored, NO AI: writer + reader read no 43a body, import no getStudentCasework, no AI", () => {
  it("neither the writer nor the reader reads a 43a casework body or imports getStudentCasework", () => {
    for (const code of [reader, writer]) {
      expect(code).not.toContain("getStudentCasework");
      expect(code).not.toMatch(/vlcPastoral(Journal|Note|Observation|Case)/);
    }
  });
  it("no AI / keyword / sentiment / auto-summary / regenerate construct anywhere in 43b code", () => {
    for (const code of [reader, writer, card, page]) {
      for (const token of ["autoDraft", "auto_draft", "autoGenerate", "regenerate", "keyword", "sentiment", "aiSummar", "summarise", "summarize"]) {
        expect(code, `must not reference ${token}`).not.toContain(token);
      }
    }
    // and the card omits-not-fakes the auto-generation copy the surface carried
    for (const copy of ["Auto-draft", "auto-generated", "Generated from", "regenerates after", "OF 22"]) {
      expect(card).not.toContain(copy);
    }
  });
});

// ── VLC43b-9 · the LOCK is one-way — edit refused after lock, NO unlock action ─────────────────────
describe("VLC43b-9 · lock is one-way: a write after lock is refused; there is NO unlock action", () => {
  it("saveCharacterParagraph refuses a locked paragraph (pre-check + race-safe setWhere)", () => {
    expect(writer).toMatch(/if \(existing\?\.lockedAt\) return \{ ok: false, error: LOCKED \}/);
    expect(writer).toMatch(/setWhere:\s*isNull\(vlcPastoralParagraph\.lockedAt\)/);
  });
  it("lockCharacterParagraph only transitions a DRAFT (locked_at IS NULL); there is NO unlock verb anywhere", () => {
    expect(writer).toContain("export async function lockCharacterParagraph");
    expect(writer).toMatch(/isNull\(vlcPastoralParagraph\.lockedAt\)/); // the one-way WHERE
    // no unlock: never clears locked_at, never exports an unlock action
    expect(writer).not.toContain("unlock");
    expect(writer).not.toContain("Unlock");
    expect(writer).not.toMatch(/lockedAt:\s*null/);
  });
});

// ── VLC43b-10 · audit metadata-only (both writes) ──────────────────────────────────────────────────
describe("VLC43b-10 · every write audits metadata only (vlc_pastoral_paragraph entity, no body)", () => {
  it("both actions record a vlc_pastoral_paragraph audit row with no body in the payload", () => {
    const recordCalls = writer.match(/recordAudit\(tx,\s*\{[\s\S]*?\}\)/g) ?? [];
    expect(recordCalls.length).toBe(2); // save + lock
    for (const call of recordCalls) {
      expect(call).toContain(`entityType: "${TABLE}"`);
      for (const leaky of ["body", "before:", "after:", "afterState"]) {
        expect(call, `audit payload must not carry ${leaky}`).not.toContain(leaky);
      }
    }
  });
});

// ── VLC43b-11 / 12 / 13 · FORCE + parent_deny + UNIQUE-per-student ─────────────────────────────────
describe("VLC43b-11/12/13 · FORCE + tenant_isolation + parent_deny (catalog); UNIQUE(school_id, student_id)", () => {
  it("policies.sql lists the table; the leak-critical prod-paste FORCEs RLS + parent_deny + NO parent_scope", () => {
    expect(policies).toContain(TABLE);
    expect(prodPaste).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(prodPaste).toMatch(/tenant_isolation/);
    expect(prodPaste).toMatch(/parent_deny/);
    expect(prodPaste).not.toMatch(/CREATE POLICY parent_scope/);
    expect(prodPaste).toContain(TABLE);
  });
  it("UNIQUE(school_id, student_id) is the one-per-student invariant + upsert target + INCR-45 read key", () => {
    expect(paraBlock).toMatch(/unique\("uniq_vlc_pastoral_paragraph_student"\)\.on\(t\.schoolId,\s*t\.studentId\)/);
    expect(writer).toMatch(/onConflictDoUpdate\(\{[\s\S]*target:\s*\[vlcPastoralParagraph\.schoolId,\s*vlcPastoralParagraph\.studentId\]/);
  });
});

// ── VLC43b-14 · INCR-45 forward-dep read shape (SELECT body WHERE student_id AND locked_at IS NOT NULL) ─
describe("VLC43b-14 · one row per student + body + locked_at satisfies the INCR-45 leaver read", () => {
  it("the schema carries body + locked_at + the per-student UNIQUE (the leaver point-lookup key)", () => {
    expect(paraBlock).toMatch(/body:\s*text\("body"\)/);
    expect(paraBlock).toMatch(/lockedAt:\s*timestamp\("locked_at"/);
    expect(paraBlock).toContain("uniq_vlc_pastoral_paragraph_student");
  });
});

// ── VLC43b-15 · SCOPE FENCE — the shipped VLC43a-21 stays green (43b lives in NEW files) ────────────
describe("VLC43b-15 · scope fence — the four 43a fenced files carry NO 43b paragraph reference", () => {
  it("no 43a casework file references vlc_pastoral_paragraph / character paragraph / Lock for year-end", () => {
    for (const rel of FENCED_43A) {
      const code = src(rel);
      for (const token of ["vlc_pastoral_paragraph", "characterParagraph", "character paragraph", "Lock for year-end", "CharacterParagraph"]) {
        expect(code, `${rel} must not reference ${token}`).not.toContain(token);
      }
    }
  });
});

// ── VLC43b-16 · seed — ONE FM-authored draft paragraph on Joseph Manu ──────────────────────────────
describe("VLC43b-16 · seed — one draft (locked_at NULL) character paragraph on Joseph, marker-scoped", () => {
  it("marker-scoped delete + a draft insert on the seeded student, FM-authored, NOT locked", () => {
    expect(seed).toContain("delete(vlcPastoralParagraph).where(eq(vlcPastoralParagraph.schoolId");
    expect(seed).toMatch(/insert\(vlcPastoralParagraph\)\.values\(\{[\s\S]*studentId:\s*joseph\.id/);
    expect(seed).toMatch(/insert\(vlcPastoralParagraph\)\.values\(\{[\s\S]*authorUserId:\s*fmUserId/);
    // DRAFT — the seed never sets locked_at (it stays FM+Dean-visible, not yet HM-readable)
    const start = seed.indexOf("insert(vlcPastoralParagraph)");
    const block = seed.slice(start, seed.indexOf("auditLog", start));
    expect(block).not.toContain("lockedAt");
  });
});
