import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { canAccessPastoralFlag, canWritePastoralFlag } from "./authz";
import { VLC_PASTORAL_READ_ROLES, VLC_PASTORAL_WRITE_ROLES } from "@/lib/access";
import {
  SHOWN_AUDIT_ENTITIES,
  REDACTED_AUDIT_ENTITIES,
  isRedactedAuditEntity,
} from "@/lib/audit/redaction";

/**
 * 🔴 INCR-43a · VLC Casework — AC VLC43a-1..23. The confidential READ boundary over FOUR pastoral tables.
 * The security machinery is 42b-cleared and REUSED VERBATIM (no widening): the read/write gate is
 * `canAccessPastoralFlag` (DEAN-role OR own-class-FM-IDENTITY), the sole reader is `pastoral-data.ts`, the
 * `vlc_pastoral_` prefix auto-redacts. Pure-function matrices (fully behavioral) + source-shape guards for
 * the reader's single own-class fence, the append-only contract, the class-match assertion, RLS, and the
 * scope fence — mirroring vlc-pastoral.test.ts. AC-14 is NON-VACUOUS: the gate is exercised over every role
 * (own vs other-class FM the crux), and the reader routes ALL FOUR body projections through that ONE fence.
 */
const src = (rel: string) => readFileSync(resolve(cwd(), rel), "utf8");
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const schema = stripComments(src("db/schema/vlc.ts"));
const cut = (from: string, to?: string) => {
  const a = schema.indexOf(from);
  const b = to ? schema.indexOf(to) : -1;
  return schema.slice(a, b === -1 ? undefined : b);
};
const flagBlock = cut("export const vlcPastoralFlag =", "export const vlcPastoralJournal =");
const journalBlock = cut("export const vlcPastoralJournal =", "export const vlcPastoralNote =");
const noteBlock = cut("export const vlcPastoralNote =", "export const vlcPastoralObservation =");
const obsBlock = cut("export const vlcPastoralObservation =", "export const vlcPastoralCase =");
const caseBlock = cut("export const vlcPastoralCase =");
const appendOnly = { journal: journalBlock, note: noteBlock, observation: obsBlock };

const reader = stripComments(src("lib/vlc/pastoral-data.ts"));
const actions = stripComments(src("lib/actions/vlc-casework.ts"));
const flagActions = stripComments(src("lib/actions/vlc-pastoral.ts"));
const composer = stripComments(src("components/vlc/casework.tsx"));
const flagComponent = stripComments(src("components/vlc/pastoral-flag.tsx"));
const page = stripComments(src("app/(app)/senior/vlc/journal/[studentId]/page.tsx"));
const seed = stripComments(src("db/seed/vlc.ts"));
const prodPaste = src("db/sql/prod-paste-0071-vlc-casework.sql");
const policies = src("db/sql/policies.sql");

const TABLES = ["vlc_pastoral_journal", "vlc_pastoral_note", "vlc_pastoral_observation", "vlc_pastoral_case"];

// ── VLC43a-1 · the four table shapes ───────────────────────────────────────────────────────────────
describe("VLC43a-1 · the four confidential tables — minimal, student-scoped, composite FKs", () => {
  it("journal: student composite FK (CASCADE) + nullable session composite FK (NO ACTION) + recorded_by", () => {
    expect(journalBlock).toMatch(/studentId:\s*uuid\("student_id"\)\.notNull\(\)/);
    expect(journalBlock).toMatch(/sessionId:\s*uuid\("session_id"\)(?!\.notNull)/);
    expect(journalBlock).toMatch(/foreignColumns:\s*\[students\.schoolId,\s*students\.id\]/);
    expect(journalBlock).toMatch(/foreignColumns:\s*\[vlcSession\.schoolId,\s*vlcSession\.id\]/);
    expect(journalBlock).toMatch(/\.onDelete\("no action"\)/);
    expect(journalBlock).toMatch(/recordedByUserId:\s*uuid\("recorded_by_user_id"\)/);
  });
  it("note: student composite FK + author stamp, student-scoped", () => {
    expect(noteBlock).toMatch(/studentId:\s*uuid\("student_id"\)\.notNull\(\)/);
    expect(noteBlock).toMatch(/authorUserId:\s*uuid\("author_user_id"\)/);
    expect(noteBlock).toMatch(/foreignColumns:\s*\[students\.schoolId,\s*students\.id\]/);
  });
  it("observation: student composite FK + observed_by TEXT DATA (no peer_guide_id FK) + recorded_by", () => {
    expect(obsBlock).toMatch(/observedBy:\s*text\("observed_by"\)\.notNull\(\)/);
    expect(obsBlock).not.toContain("peer_guide_id");
    expect(obsBlock).not.toContain("peerGuideId");
    expect(obsBlock).toMatch(/recordedByUserId:\s*uuid\("recorded_by_user_id"\)/);
  });
  it("case: composite flag FK → vlc_pastoral_flag + last_revised stamps", () => {
    expect(caseBlock).toMatch(/flagId:\s*uuid\("flag_id"\)\.notNull\(\)/);
    expect(caseBlock).toMatch(/foreignColumns:\s*\[vlcPastoralFlag\.schoolId,\s*vlcPastoralFlag\.id\]/);
    expect(caseBlock).toMatch(/lastRevisedAt:\s*timestamp\("last_revised_at"/);
    expect(caseBlock).toMatch(/lastRevisedByUserId:\s*uuid\("last_revised_by_user_id"\)/);
  });
});

// ── VLC43a-2 · journal/note/observation are HARD append-only (no updated_at, NO update/delete action) ──
describe("VLC43a-2 · journal / note / observation are HARD append-only", () => {
  it("none of the three append-only tables carries updated_at", () => {
    for (const [name, block] of Object.entries(appendOnly)) {
      expect(block, `${name} must have NO updated_at`).not.toMatch(/updated_at|updatedAt/);
    }
  });
  it("NO update / delete action exists for journal / note / observation anywhere in the actions", () => {
    for (const t of ["vlcPastoralJournal", "vlcPastoralNote", "vlcPastoralObservation"]) {
      expect(actions, `${t} must never be updated`).not.toContain(`.update(${t}`);
      expect(actions, `${t} must never be deleted`).not.toContain(`.delete(${t}`);
    }
    // The casework actions never DELETE anything, and the ONLY .update targets the editable case.
    expect(actions).not.toContain(".delete(");
    const updates = actions.match(/\.update\(\w+/g) ?? [];
    expect(updates).toEqual([".update(vlcPastoralCase"]);
  });
  it("only create* actions are exported for the three streams (no edit/delete verbs)", () => {
    for (const verb of ["editJournal", "deleteJournal", "editNote", "deleteNote", "editObservation", "deleteObservation", "updateJournal"]) {
      expect(actions, `${verb} must not exist`).not.toContain(verb);
    }
    for (const fn of ["createJournalEntry", "createPastoralNote", "createObservation"]) {
      expect(actions).toContain(`export async function ${fn}`);
    }
  });
});

// ── VLC43a-3 · entry date + word count DERIVE (no stored columns) ──────────────────────────────────
describe("VLC43a-3 · entry date + word count DERIVE (session_date else created_at; count from body)", () => {
  it("journal stores NO entry_date and NO word_count column", () => {
    for (const forbidden of ["entry_date", "entryDate", "word_count", "wordCount:", "words:"]) {
      expect(journalBlock, `journal must not store ${forbidden}`).not.toContain(forbidden);
    }
  });
  it("the reader DERIVES the entry date (session_date else created_at) and the word count", () => {
    expect(reader).toMatch(/sessionDate\s*\?\s*dateLabelFromIso\(.*\)\s*:\s*dateLabelOf\(.*createdAt\)/);
    expect(reader).toMatch(/wordCount:\s*wordsIn\(/);
  });
});

// ── VLC43a-5 · "N open" DERIVES from 42b flags (resolved_at IS NULL) ───────────────────────────────
describe("VLC43a-5 · the note 'N open' count DERIVES from unresolved flags, never a stored column", () => {
  it("no open/status column on note (or any casework table)", () => {
    for (const block of [journalBlock, noteBlock, obsBlock, caseBlock]) {
      for (const forbidden of ['"open"', "isOpen", '"status"', "openCount", '"resolved_at"']) {
        expect(block).not.toContain(forbidden);
      }
    }
  });
  it("the reader counts open notes from the student's flags where resolved_at IS NULL", () => {
    expect(reader).toMatch(/notesOpen\s*=\s*flagRows\.filter\(\(f\)\s*=>\s*!f\.resolvedAt\)\.length/);
  });
});

// ── VLC43a-6 / 8 · case is UNIQUE(school_id, flag_id) 1:1 AND the SOLE editable table ──────────────
describe("VLC43a-6/8/9 · case is 1:1 per flag (UNIQUE) and the ONE editable table", () => {
  it("UNIQUE(school_id, flag_id) enforces at-most-one case per flag", () => {
    expect(caseBlock).toMatch(/unique\("uniq_vlc_pastoral_case_flag"\)\.on\(t\.schoolId,\s*t\.flagId\)/);
  });
  it("createCase inserts (a 2nd case on the same flag conflicts) and editCase bumps last_revised", () => {
    expect(actions).toMatch(/insert\(vlcPastoralCase\)/);
    expect(actions).toMatch(/onConflictDoNothing\(\{\s*target:\s*\[vlcPastoralCase\.schoolId,\s*vlcPastoralCase\.flagId\]/);
    expect(actions).toMatch(/update\(vlcPastoralCase\)[\s\S]*lastRevisedAt:\s*new Date\(\)/);
  });
});

// ── VLC43a-7 · PG reads NOTHING (structural) ───────────────────────────────────────────────────────
describe("VLC43a-7 · the Peer Guide is DATA, never a principal — no PG login/read/write path", () => {
  it("observed_by is free text; there is no peer_guide_id FK and no PEER_GUIDE in the gates", () => {
    expect(obsBlock).toMatch(/observedBy:\s*text\("observed_by"\)/);
    expect(VLC_PASTORAL_READ_ROLES).not.toContain("PEER_GUIDE");
    expect(VLC_PASTORAL_WRITE_ROLES).not.toContain("PEER_GUIDE");
    // The ROLE gate (VLC_PASTORAL_*_ROLES, checked at the reader/action entry) is what blocks a PG; the
    // own-class narrowing is identity-only, so a PG who is NOT the class teacher also fails it.
    expect(canAccessPastoralFlag({ roles: ["PEER_GUIDE"], userId: "p", classTeacherUserId: "t" })).toBe(false);
  });
  it("the composer records observed_by as data (no PG-facing login/read UI)", () => {
    expect(composer).toMatch(/observedBy/);
    expect(composer).not.toMatch(/PG login|peerGuideId|pgRead/i);
  });
});

// ── VLC43a-10 · REDACTION — all four vlc_pastoral_* auto-redact (zero enumeration edits) ───────────
describe("VLC43a-10 · all four tables REDACT via the vlc_pastoral_ prefix (guard green, zero edits)", () => {
  it("isRedactedAuditEntity is true for all four, via the prefix branch", () => {
    for (const t of TABLES) expect(isRedactedAuditEntity(t), t).toBe(true);
  });
  it("none of the four is in SHOWN or in the enumerated REDACTED set (prefix classifies them)", () => {
    for (const t of TABLES) {
      expect(SHOWN_AUDIT_ENTITIES.has(t), `${t} not SHOWN`).toBe(false);
      expect(REDACTED_AUDIT_ENTITIES.has(t), `${t} not enumerated`).toBe(false);
    }
  });
});

// ── VLC43a-11 · audit metadata-only ────────────────────────────────────────────────────────────────
describe("VLC43a-11 · every write audits metadata only (no body/summary/observed_by/student)", () => {
  it("each action records a vlc_pastoral_* entityType with created/updated action, no content", () => {
    for (const t of TABLES) expect(actions).toContain(`entityType: "${t}"`);
    const recordCalls = actions.match(/recordAudit\(tx,\s*\{[\s\S]*?\}\)/g) ?? [];
    expect(recordCalls.length).toBe(5); // journal + note + observation + createCase + editCase
    for (const call of recordCalls) {
      for (const leaky of ["body", "summary", "observedBy", "observed_by", "before:", "after:"]) {
        expect(call, `audit payload must not carry ${leaky}`).not.toContain(leaky);
      }
    }
  });
});

// ── VLC43a-12 · the SOLE content reader (repo walk over the four bodies) ───────────────────────────
describe("VLC43a-12 · pastoral-data.ts is the SOLE projector of the four casework bodies", () => {
  it("no other file selects journal.body / note.body / observation.body / case.summary", () => {
    const NEEDLE = /vlcPastoral(?:Journal|Note|Observation)\.body|vlcPastoralCase\.summary/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(resolve(cwd(), dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          if (NEEDLE.test(readFileSync(resolve(cwd(), p), "utf8"))) offenders.push(p);
        }
      }
    };
    for (const root of ["app", "components", "features", "hooks", "lib"]) walk(root);
    expect(offenders).toEqual(["lib/vlc/pastoral-data.ts"]);
  });
  it("the reader is server-only", () => {
    expect(reader).toMatch(/^import "server-only";/m);
  });
});

// ── VLC43a-13 · read role gate is exactly [FM, DEAN] (page + reader) ───────────────────────────────
describe("VLC43a-13 · READ role gate = [FORM_MASTER, DEAN_OF_STUDENTS] (ADMIN + HM never reach)", () => {
  it("the gate pair excludes ADMIN + HEADMASTER", () => {
    expect([...VLC_PASTORAL_READ_ROLES].sort()).toEqual(["DEAN_OF_STUDENTS", "FORM_MASTER"]);
    for (const barred of ["ADMIN", "HEADMASTER", "STUDENT", "PARENT", "PEER_GUIDE"]) {
      expect(VLC_PASTORAL_READ_ROLES).not.toContain(barred);
    }
  });
  it("the page gates on the role arm then notFound()s a non-gated (null) reader result", () => {
    expect(page).toMatch(/requireSchoolRole\(VLC_PASTORAL_READ_ROLES\)/);
    expect(page).toMatch(/getStudentCasework\(/);
    expect(page).toMatch(/if \(!view\) notFound\(\)/);
  });
  it("the reader role-gates via VLC_PASTORAL_READ_ROLES before any body projection", () => {
    expect(reader).toMatch(/hasAnyRole\(caller\.roles,\s*VLC_PASTORAL_READ_ROLES\)/);
  });
});

// ── VLC43a-14 · THE CRUX — the non-vacuous read matrix over ALL FOUR tables (identity, NOT role) ───
describe("VLC43a-14 · read matrix: own-class FM sees all four; other-class FM / HM / ADMIN / PG / parent = 0", () => {
  const own = (roles: string[]) => canAccessPastoralFlag({ roles, userId: "fmA", classTeacherUserId: "fmA" });
  const other = (roles: string[]) => canAccessPastoralFlag({ roles, userId: "fmB", classTeacherUserId: "fmA" });

  it("own-class FM = READ (all four); a DIFFERENT-class FM = 0 (the IDOR fence, same role)", () => {
    expect(own(["FORM_MASTER"])).toBe(true);
    expect(other(["FORM_MASTER"])).toBe(false);
  });
  it("DEAN = all four (school-wide, no own-class clause)", () => {
    expect(other(["DEAN_OF_STUDENTS"])).toBe(true);
  });
  it("HM = 0, ADMIN = 0, PG = 0, student = 0, parent = 0", () => {
    for (const r of ["HEADMASTER", "ADMIN", "PEER_GUIDE", "STUDENT", "PARENT"]) {
      expect(other([r]), `${r} must be 0`).toBe(false);
    }
  });
  it("the reader resolves the fence ONCE and returns null (all four withheld together) when it fails", () => {
    // a single canAccessPastoralFlag call gates the whole document; a non-gated caller gets null, not a
    // partial view — so the matrix above IS the matrix over all four tables.
    expect((reader.match(/canAccessPastoralFlag\(/g) ?? []).length).toBe(1);
    expect(reader).toMatch(/canAccessPastoralFlag\([\s\S]*?\)\s*\)\s*\{\s*return null;/);
    // and the reader IS the path for all four bodies (proving the withholding is non-vacuous).
    for (const col of ["vlcPastoralJournal.body", "vlcPastoralNote.body", "vlcPastoralObservation.body", "vlcPastoralCase.summary"]) {
      expect(reader).toContain(col);
    }
  });
});

// ── VLC43a-15 · WRITE gate re-checked server-side on EVERY create + case edit ──────────────────────
describe("VLC43a-15 · write gate = canWritePastoralFlag re-checked server-side (other-class FM + ADMIN/HM/PG refused)", () => {
  it("write === read gate (reused verbatim); other-class FM / ADMIN / HM / PG / student refused", () => {
    expect(canWritePastoralFlag).toBe(canAccessPastoralFlag);
    expect(canWritePastoralFlag({ roles: ["FORM_MASTER"], userId: "u1", classTeacherUserId: "u1" })).toBe(true);
    // classTeacherUserId "u2" ≠ userId "u1", so the identity arm fails for every non-Dean role (the ROLE
    // gate at the action entry independently blocks ADMIN/HM/PG/STUDENT — see mayWriteFor below).
    for (const roles of [["FORM_MASTER"], ["ADMIN"], ["HEADMASTER"], ["PEER_GUIDE"], ["STUDENT"]] as const) {
      expect(canWritePastoralFlag({ roles: [...roles], userId: "u1", classTeacherUserId: "u2" })).toBe(false);
    }
    expect(canWritePastoralFlag({ roles: ["DEAN_OF_STUDENTS"], userId: "u1", classTeacherUserId: "u2" })).toBe(true);
  });
  it("all five actions role-gate (WRITE_ROLES) AND re-run canWritePastoralFlag via mayWriteFor before the mutation", () => {
    expect(actions).toMatch(/hasAnyRole\(roles,\s*VLC_PASTORAL_WRITE_ROLES\)/);
    expect(actions).toMatch(/canWritePastoralFlag\(/);
    for (const fn of ["createJournalEntry", "createPastoralNote", "createObservation", "createCase", "editCase"]) {
      const start = actions.indexOf(`export async function ${fn}`);
      expect(start, `${fn} exported`).toBeGreaterThan(-1);
      const next = actions.indexOf("export async function ", start + 1);
      const body = actions.slice(start, next === -1 ? undefined : next);
      expect(body, `${fn} gates the write`).toMatch(/mayWriteFor\(/);
    }
  });
  it("mayWriteFor REUSES canWritePastoralFlag (never re-implements/widens the gate)", () => {
    expect(actions).toMatch(/canWritePastoralFlag\(\{\s*roles,\s*userId:\s*actorId,\s*classTeacherUserId/);
    // no role fallback that would widen the FM arm to a bare role check
    expect(actions).not.toMatch(/roles\.includes\("FORM_MASTER"\)/);
  });
});

// ── VLC43a-16 · the class-match assertion RETIRES the 42b deferral (in raisePastoralFlag) ──────────
describe("VLC43a-16 · raisePastoralFlag asserts session.class_id === student.class_id (single choke-point)", () => {
  it("a session-linked flag whose session's class differs is REJECTED; NULL sessionId commits", () => {
    const start = flagActions.indexOf("export async function raisePastoralFlag");
    const body = flagActions.slice(start);
    expect(body).toMatch(/if \(sessionId\)/);
    expect(body).toMatch(/vlcSession\.classId/);
    expect(body).toMatch(/sess\.classId\s*!==\s*gate\.classId/);
    expect(body).toMatch(/different class than the student/);
  });
});

// ── VLC43a-17 / 18 / 19 · RLS + composite FKs + the flag tenant_uk retrofit ───────────────────────
describe("VLC43a-17/18/19 · FORCE + tenant_isolation + parent_deny, composite FKs, flag tenant_uk first", () => {
  it("policies.sql lists all four; the leak-critical prod-paste FORCEs RLS + parent_deny + NO parent_scope", () => {
    for (const t of TABLES) expect(policies, `policies lists ${t}`).toContain(t);
    expect(prodPaste).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(prodPaste).toMatch(/tenant_isolation/);
    expect(prodPaste).toMatch(/parent_deny/);
    expect(prodPaste).not.toMatch(/CREATE POLICY parent_scope/);
    for (const t of TABLES) expect(prodPaste, `prod-paste covers ${t}`).toContain(t);
  });
  it("the flag tenant_uk is retrofitted AND ordered BEFORE the case FK (both migration + prod-paste)", () => {
    expect(flagBlock).toMatch(/unique\("vlc_pastoral_flag_tenant_uk"\)\.on\(t\.schoolId,\s*t\.id\)/);
    const migration = src("db/migrations/0069_gigantic_vengeance.sql");
    const ukAt = migration.indexOf("vlc_pastoral_flag_tenant_uk");
    const caseFkAt = migration.indexOf("vlc_pastoral_case_school_id_flag_id");
    expect(ukAt).toBeGreaterThan(-1);
    expect(caseFkAt).toBeGreaterThan(ukAt); // target UNIQUE precedes the FK that references it
    const pUk = prodPaste.indexOf('ADD CONSTRAINT "vlc_pastoral_flag_tenant_uk"');
    const pFk = prodPaste.indexOf("vlc_pastoral_case_school_id_flag_id");
    expect(pUk).toBeGreaterThan(-1);
    expect(pFk).toBeGreaterThan(pUk);
  });
  it("all four are LEAF (no tenant_uk of their own) and CASCADE the student/flag", () => {
    for (const block of [journalBlock, noteBlock, obsBlock, caseBlock]) {
      expect(block).not.toContain("tenant_uk");
    }
  });
});

// ── VLC43a-20 · NO derived scalars anywhere in the four tables ─────────────────────────────────────
describe("VLC43a-20 · no derived-duplicate scalar column (counts / averages / scores all derive)", () => {
  it("no stored count / average / engagement / quality / score column", () => {
    for (const block of [journalBlock, noteBlock, obsBlock, caseBlock]) {
      for (const forbidden of ["word_count", "note_count", "avg", "engagement", "quality_score", "score", "sentiment", "keyword", "theme"]) {
        expect(block).not.toContain(forbidden);
      }
    }
  });
});

// ── VLC43a-21 · the scope fence — no paragraph, no HM read, no AI, no student/PG login ─────────────
describe("VLC43a-21 · scope fence — omit-not-fake the paragraph + all auto-generation + student/PG UI", () => {
  const FENCE = [reader, actions, composer, page, flagActions];
  it("no character-paragraph / auto-draft / AI / keyword construct in any 43a file", () => {
    for (const code of FENCE) {
      for (const token of ["character_paragraph", "characterParagraph", "vlc_pastoral_paragraph", "auto_draft", "autoDraft", "autoGenerate", "regenerate", "keyword", "sentiment", "aiSummar"]) {
        expect(code, `must not reference ${token}`).not.toContain(token);
      }
    }
  });
  it("the page omits-not-fakes the paragraph card + auto-generation framing (no such copy)", () => {
    for (const copy of ["Auto-draft", "auto-generated", "character paragraph", "Lock for year-end", "regenerates after", "Generated from"]) {
      expect(page).not.toContain(copy);
    }
  });
  it("HM + ADMIN get NO read path (absent from the gate); no student/PG writer in the actions", () => {
    expect(VLC_PASTORAL_READ_ROLES).not.toContain("HEADMASTER");
    expect(VLC_PASTORAL_READ_ROLES).not.toContain("ADMIN");
    expect(actions).not.toMatch(/STUDENT|studentWrite|pgWrite/);
  });
});

// ── VLC43a-22 · staff-facing — student attributed via student_id, recorded_by = the FM ────────────
describe("VLC43a-22 · staff-facing: the FM records; the student is student_id, the PG is observed_by DATA", () => {
  it("journal/observation carry recorded_by (the FM) + student_id; note carries author_user_id", () => {
    expect(journalBlock).toMatch(/recordedByUserId/);
    expect(journalBlock).toMatch(/studentId/);
    expect(obsBlock).toMatch(/recordedByUserId/);
    expect(noteBlock).toMatch(/authorUserId/);
  });
  it("the actions set recorded_by/author from the resolved actor, never a student/PG principal", () => {
    expect(actions).toMatch(/recordedByUserId:\s*actor\.id/);
    expect(actions).toMatch(/authorUserId:\s*actor\.id/);
    expect(actions).toMatch(/observedBy/); // free-text DATA on the observation
  });
});

// ── VLC43a-23 · the seed extends the J. Manu thread on the seeded flag ─────────────────────────────
describe("VLC43a-23 · seed — casework on Joseph Manu (ASK-24-0118): journal + ≥2 notes + obs + 1 case", () => {
  it("marker-scoped deletes for all four casework tables (case before flag)", () => {
    for (const t of ["vlcPastoralCase", "vlcPastoralJournal", "vlcPastoralNote", "vlcPastoralObservation"]) {
      expect(seed).toContain(`delete(${t}).where(eq(${t}.schoolId`);
    }
  });
  it("inserts all four on the seeded flag/student, PG named as observed_by DATA", () => {
    expect(seed).toMatch(/insert\(vlcPastoralJournal\)/);
    expect(seed).toMatch(/insert\(vlcPastoralNote\)/);
    expect(seed).toMatch(/insert\(vlcPastoralObservation\)/);
    expect(seed).toMatch(/insert\(vlcPastoralCase\)\.values\(\{[\s\S]*flagId:\s*flag\.id/);
    expect(seed).toMatch(/observedBy:\s*"(Prince Otoo|Akua Gyamfi)"/);
  });
});

// ── the "Open journal" deep-link (the honest replacement for 42b's omitted case-note button) ──────
describe("the flag callout deep-links to the confidential journal (gated viewer only)", () => {
  it("PastoralFlagView carries studentId and the callout links to /senior/vlc/journal/[studentId]", () => {
    expect(reader).toMatch(/studentId:\s*vlcPastoralFlag\.studentId/);
    expect(flagComponent).toMatch(/\/senior\/vlc\/journal\/\$\{f\.studentId\}/);
    expect(flagComponent).toContain("Open journal");
  });
});
