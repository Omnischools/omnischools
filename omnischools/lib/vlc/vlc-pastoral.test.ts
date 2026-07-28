import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { canAccessPastoralFlag, canWritePastoralFlag } from "./authz";
import { VLC_PASTORAL_SEVERITY } from "./defaults";
import { VLC_PASTORAL_READ_ROLES, VLC_PASTORAL_WRITE_ROLES } from "@/lib/access";
import {
  SHOWN_AUDIT_ENTITIES,
  REDACTED_AUDIT_ENTITIES,
  isRedactedAuditEntity,
} from "@/lib/audit/redaction";

/**
 * 🔴 INCR-42b · VLC Pastoral flag — AC VLC42b-1..18. The SECURITY increment (Sarah is the star): the
 * confidential read/write gate is DEAN-role OR own-class-FM-IDENTITY (NOT a bare FORM_MASTER role), the
 * REDACTED `vlc_pastoral_` prefix branch, the sole confidential read path, and the non-gated "nothing"
 * contract. Pure-function matrices (the gate is fully behavioral) + source-shape guards for the reader's
 * own-class WHERE, the schema shape, RLS, and the scope fence — mirroring vlc-sessions.test.ts. Behavioral
 * live-DB RLS/tenant-isolation is Quinn/Sarah's gate; here we prove every invariant a static read + a pure
 * function can, and AC-7 is NON-VACUOUS via the gate matrix (other-class FM = false) + the reader WHERE.
 */
const src = (rel: string) => readFileSync(resolve(cwd(), rel), "utf8");
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const schema = stripComments(src("db/schema/vlc.ts"));
const flagBlock = schema.slice(schema.indexOf("export const vlcPastoralFlag ="));
const authz = stripComments(src("lib/vlc/authz.ts"));
const reader = stripComments(src("lib/vlc/pastoral-data.ts"));
const actions = stripComments(src("lib/actions/vlc-pastoral.ts"));
const component = stripComments(src("components/vlc/pastoral-flag.tsx"));
const page = stripComments(
  src("app/(app)/senior/vlc/sessions/[classId]/[date]/page.tsx"),
);
const seed = stripComments(src("db/seed/vlc.ts"));

// ── VLC42b-1 · the flag shape ─────────────────────────────────────────────────────────────────────
describe("VLC42b-1 · vlc_pastoral_flag — minimal confidential row", () => {
  it("student_id is a FIRST-CLASS composite FK (INCR-45 existence-check reads it)", () => {
    expect(flagBlock).toMatch(/studentId:\s*uuid\("student_id"\)\.notNull\(\)/);
    expect(flagBlock).toMatch(/foreignColumns:\s*\[students\.schoolId,\s*students\.id\]/);
  });
  it("session_id is a NULLABLE composite FK → vlc_session (NO ACTION)", () => {
    expect(flagBlock).toMatch(/sessionId:\s*uuid\("session_id"\)(?!\.notNull)/);
    expect(flagBlock).toMatch(/foreignColumns:\s*\[vlcSession\.schoolId,\s*vlcSession\.id\]/);
    expect(flagBlock).toMatch(/\.onDelete\("no action"\)/);
  });
  it("NO narrative / case-file / journal / character-paragraph column (the ≤280 context is the fence)", () => {
    for (const forbidden of [
      "narrative",
      "case_file",
      "caseFile",
      "case_note",
      "journal",
      "note_thread",
      "character_paragraph",
      "body",
    ]) {
      expect(flagBlock, `flag must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });
  it("NO derived scalars — active derives from resolved_at (no is_open/rank/count column)", () => {
    for (const forbidden of ["is_open", "isOpen", "severity_rank", "severityRank", "active_flag", "flag_count"]) {
      expect(flagBlock, `flag must not carry ${forbidden}`).not.toContain(forbidden);
    }
    // The flag has NO boolean column at all — "active" is derived from resolved_at IS NULL, never stored.
    // (The only `active` in the block is the partial index NAME vlc_pastoral_flag_active_idx.)
    expect(flagBlock).not.toMatch(/boolean\(/);
    expect(flagBlock).toMatch(/resolvedAt:\s*timestamp\("resolved_at"/);
  });
});

// ── VLC42b-2 · partial index on active ────────────────────────────────────────────────────────────
describe("VLC42b-2 · partial index on active flags (school_id, student_id) WHERE resolved_at IS NULL", () => {
  it("the active index is partial (indexes the existence-check + the own-class read filter)", () => {
    expect(flagBlock).toMatch(
      /index\("vlc_pastoral_flag_active_idx"\)[\s\S]*schoolId,[\s\S]*studentId[\s\S]*resolvedAt.*IS NULL/,
    );
  });
});

// ── VLC42b-3 · multiple concurrent active flags allowed ───────────────────────────────────────────
describe("VLC42b-3 · no unique-on-active — concurrent open flags per student are allowed", () => {
  it("the active index is NOT unique + there is no tenant_uk (LEAF)", () => {
    expect(flagBlock).not.toMatch(/uniqueIndex\([^)]*active/);
    expect(flagBlock).not.toContain("tenant_uk");
  });
});

// ── VLC42b-4 · context > 280 rejected ─────────────────────────────────────────────────────────────
describe("VLC42b-4 · context is a SHORT ≤280 locator (app-layer + CHECK)", () => {
  it("the raise action caps context at 280", () => {
    expect(actions).toMatch(/\.max\(280/);
  });
  it("the schema CHECK bounds context ≤ 280 (defense-in-depth)", () => {
    expect(flagBlock).toMatch(/char_length\(\$\{t\.context\}\)\s*<=\s*280/);
  });
});

// ── VLC42b-5 · severity out-of-set rejected ───────────────────────────────────────────────────────
describe("VLC42b-5 · severity is the frozen NOTE/CONCERN/CRISIS allow-list", () => {
  it("VLC_PASTORAL_SEVERITY is exactly the 3 levels, matching the CHECK", () => {
    expect([...VLC_PASTORAL_SEVERITY]).toEqual(["NOTE", "CONCERN", "CRISIS"]);
    expect(flagBlock).toMatch(/severity.*IN \('NOTE', 'CONCERN', 'CRISIS'\)/);
  });
  it("the raise action validates severity against the frozen list (not a free string)", () => {
    expect(actions).toMatch(/z\.enum\(VLC_PASTORAL_SEVERITY\)/);
    expect([...VLC_PASTORAL_SEVERITY]).not.toContain("WATCH"); // an out-of-set value is not admitted
  });
});

// ── VLC42b-6 · READ role gate is exactly [FM, DEAN] (ADMIN + HM absent) ────────────────────────────
describe("VLC42b-6 · VLC_PASTORAL_READ_ROLES = [FORM_MASTER, DEAN_OF_STUDENTS], ADMIN + HM absent", () => {
  it("the role gate contains only the FM + Dean pair", () => {
    expect([...VLC_PASTORAL_READ_ROLES].sort()).toEqual(["DEAN_OF_STUDENTS", "FORM_MASTER"]);
    for (const barred of ["ADMIN", "HEADMASTER", "STUDENT", "PARENT"]) {
      expect(VLC_PASTORAL_READ_ROLES, `${barred} must not be a pastoral read role`).not.toContain(barred);
    }
  });
  it("read and write role gates are the same owner-locked pair", () => {
    expect([...VLC_PASTORAL_WRITE_ROLES]).toEqual([...VLC_PASTORAL_READ_ROLES]);
  });
});

// ── VLC42b-7 · THE CRUX — the non-vacuous read/access matrix (identity, NOT role) ─────────────────
describe("VLC42b-7 · canAccessPastoralFlag is DEAN-role OR own-class-FM-IDENTITY (the IDOR fence)", () => {
  const own = (roles: string[]) =>
    canAccessPastoralFlag({ roles, userId: "fmA", classTeacherUserId: "fmA" }); // caller IS the class teacher
  const other = (roles: string[]) =>
    canAccessPastoralFlag({ roles, userId: "fmB", classTeacherUserId: "fmA" }); // a DIFFERENT class's teacher

  it("own-class FM sees it; a DIFFERENT-class FM sees NOTHING (same role, different identity)", () => {
    expect(own(["FORM_MASTER"])).toBe(true);
    expect(other(["FORM_MASTER"])).toBe(false); // 🔴 the IDOR this increment exists to prevent
  });
  it("DEAN sees it school-wide (no own-class clause) — a class they do not teach", () => {
    expect(other(["DEAN_OF_STUDENTS"])).toBe(true);
    expect(canAccessPastoralFlag({ roles: ["DEAN_OF_STUDENTS"], userId: null, classTeacherUserId: null })).toBe(
      true,
    );
  });
  it("HM = 0, ADMIN = 0, a Peer Guide / student = 0, a null user = 0 (NOT the class teacher, NOT Dean)", () => {
    expect(other(["HEADMASTER"])).toBe(false);
    expect(other(["ADMIN"])).toBe(false);
    expect(other(["PEER_GUIDE"])).toBe(false);
    expect(other(["STUDENT"])).toBe(false);
    expect(other(["PARENT"])).toBe(false);
    expect(canAccessPastoralFlag({ roles: ["FORM_MASTER"], userId: null, classTeacherUserId: "fmA" })).toBe(
      false,
    );
  });
  it("the gate is IDENTITY not ROLE — holding FORM_MASTER never alone grants access", () => {
    // Same role, both are form masters; only the one whose id matches the class teacher passes.
    expect(canAccessPastoralFlag({ roles: ["FORM_MASTER"], userId: "x", classTeacherUserId: "y" })).toBe(false);
    expect(canAccessPastoralFlag({ roles: ["FORM_MASTER"], userId: "x", classTeacherUserId: "x" })).toBe(true);
  });

  it("the reader is server-only + the SOLE content path, role-gated, with the own-class WHERE", () => {
    expect(reader).toMatch(/^import "server-only";/m);
    expect(reader).toMatch(/hasAnyRole\(caller\.roles,\s*VLC_PASTORAL_READ_ROLES\)/);
    // DEAN → all; else the own-class fence on the flagged student's class teacher.
    expect(reader).toMatch(/isDean\s*\?\s*undefined\s*:\s*eq\(classes\.classTeacherUserId,\s*caller\.userId/);
    // active only + scoped to the viewed class
    expect(reader).toMatch(/isNull\(vlcPastoralFlag\.resolvedAt\)/);
    expect(reader).toMatch(/eq\(students\.classId,\s*classId\)/);
  });

  it("NO OTHER file projects flag CONTENT — pastoral-data.ts is the sole content read path", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(resolve(cwd(), dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const code = readFileSync(resolve(cwd(), p), "utf8");
          if (/vlcPastoralFlag\.(severity|context|surfacedBy)/.test(code)) offenders.push(p);
        }
      }
    };
    for (const root of ["app", "components", "features", "hooks", "lib"]) walk(root);
    expect(offenders).toEqual(["lib/vlc/pastoral-data.ts"]);
  });
});

// ── VLC42b-8 · WRITE gate — own-class FM / Dean, server re-check on BOTH ───────────────────────────
describe("VLC42b-8 · canWritePastoralFlag mirrors the read gate; both actions re-check server-side", () => {
  it("write === read gate (owner-locked b+c) — other-class FM refused, Dean school-wide", () => {
    expect(canWritePastoralFlag).toBe(canAccessPastoralFlag);
    expect(canWritePastoralFlag({ roles: ["FORM_MASTER"], userId: "u1", classTeacherUserId: "u1" })).toBe(true);
    expect(canWritePastoralFlag({ roles: ["FORM_MASTER"], userId: "u1", classTeacherUserId: "u2" })).toBe(false);
    expect(canWritePastoralFlag({ roles: ["ADMIN"], userId: "u1", classTeacherUserId: "u2" })).toBe(false);
    expect(canWritePastoralFlag({ roles: ["HEADMASTER"], userId: "u1", classTeacherUserId: "u2" })).toBe(false);
    expect(canWritePastoralFlag({ roles: ["DEAN_OF_STUDENTS"], userId: "u1", classTeacherUserId: "u2" })).toBe(
      true,
    );
  });
  it("raise + resolve each role-gate (WRITE_ROLES) AND re-run canWritePastoralFlag before the mutation", () => {
    expect(actions).toMatch(/hasAnyRole\(roles,\s*VLC_PASTORAL_WRITE_ROLES\)/);
    expect(actions).toMatch(/canWritePastoralFlag\(/);
    for (const name of ["raisePastoralFlag", "resolvePastoralFlag"]) {
      const start = actions.indexOf(`export async function ${name}`);
      expect(start, `${name} exported`).toBeGreaterThan(-1);
      const next = actions.indexOf("export async function ", start + 1);
      const body = actions.slice(start, next === -1 ? undefined : next);
      expect(body, `${name} gates the write`).toMatch(/mayWriteFor\(/);
    }
  });
});

// ── VLC42b-9 · surfaced_by is DATA (no PG/student write path) ──────────────────────────────────────
describe("VLC42b-9 · surfaced_by is a DISPLAY attribution, not a PG write", () => {
  it("surfaced_by is free text set by the FM/Dean writer, ≤80 (CHECK)", () => {
    expect(flagBlock).toMatch(/surfacedBy:\s*text\("surfaced_by"\)/);
    expect(flagBlock).toMatch(/char_length\(\$\{t\.surfacedBy\}\)\s*<=\s*80/);
    expect(actions).toMatch(/surfacedBy:\s*z\.string\(\)/);
  });
  it("no PG/student write path — the gate never admits a PEER_GUIDE or STUDENT", () => {
    expect(VLC_PASTORAL_WRITE_ROLES).not.toContain("PEER_GUIDE");
    expect(VLC_PASTORAL_WRITE_ROLES).not.toContain("STUDENT");
    expect(canWritePastoralFlag({ roles: ["PEER_GUIDE"], userId: "p", classTeacherUserId: "t" })).toBe(false);
    expect(canWritePastoralFlag({ roles: ["STUDENT"], userId: "s", classTeacherUserId: "t" })).toBe(false);
  });
});

// ── VLC42b-10 · resolve sets resolved_at, active = NULL, idempotent ────────────────────────────────
describe("VLC42b-10 · resolve stamps resolved_at + is idempotent", () => {
  it("resolvePastoralFlag sets resolvedAt/resolvedByUserId and no-ops if already resolved", () => {
    expect(actions).toMatch(/\.set\(\{\s*resolvedAt:\s*new Date\(\),\s*resolvedByUserId/);
    expect(actions).toMatch(/if \(flag\.resolvedAt\)[\s\S]*return \{ ok: true \}/);
    // race-safe: the UPDATE only transitions an active row
    expect(actions).toMatch(/isNull\(vlcPastoralFlag\.resolvedAt\)/);
  });
});

// ── VLC42b-11/12 · REDACTED via the prefix branch; classify guard stays green ─────────────────────
describe("VLC42b-11/12 · vlc_pastoral_flag is REDACTED (prefix branch), classify guard green", () => {
  it("isRedactedAuditEntity('vlc_pastoral_flag') === true via the vlc_pastoral_ prefix", () => {
    expect(isRedactedAuditEntity("vlc_pastoral_flag")).toBe(true);
    // a FUTURE vlc_pastoral_* entity (INCR-43) redacts with no code change
    expect(isRedactedAuditEntity("vlc_pastoral_note")).toBe(true);
  });
  it("it is NOT in SHOWN and NOT in the enumerated REDACTED set (prefix classifies it redacted-side)", () => {
    expect(SHOWN_AUDIT_ENTITIES.has("vlc_pastoral_flag")).toBe(false);
    expect(REDACTED_AUDIT_ENTITIES.has("vlc_pastoral_flag")).toBe(false);
  });
});

// ── VLC42b-13 · audit metadata-only ────────────────────────────────────────────────────────────────
describe("VLC42b-13 · the audit records metadata only (no confidential content)", () => {
  it("both writes audit entityType vlc_pastoral_flag with actionType raised/resolved", () => {
    expect(actions).toMatch(/actionType:\s*"raised"/);
    expect(actions).toMatch(/actionType:\s*"resolved"/);
    expect(actions).toMatch(/entityType:\s*"vlc_pastoral_flag"/);
  });
  it("NO context/severity/surfaced_by/student is passed into the audit before/after payload", () => {
    // recordAudit calls carry only schoolId/actor/actionType/entityType/entityId/reason.
    const recordCalls = actions.match(/recordAudit\(tx,\s*\{[\s\S]*?\}\)/g) ?? [];
    expect(recordCalls.length).toBeGreaterThan(0);
    for (const call of recordCalls) {
      for (const leaky of ["severity", "context", "surfacedBy", "surfaced_by", "before:", "after:"]) {
        expect(call, `audit payload must not carry ${leaky}`).not.toContain(leaky);
      }
    }
  });
});

// ── VLC42b-14/15 · RLS — FORCE + tenant_isolation + parent_deny, NO parent_scope ──────────────────
describe("VLC42b-14/15 · RLS is configured (FORCE + tenant_isolation + parent_deny, no parent_scope)", () => {
  it("policies.sql + the leak-critical prod-paste both list vlc_pastoral_flag", () => {
    for (const file of ["db/sql/policies.sql", "db/sql/prod-paste-0070-vlc-pastoral-flag.sql"]) {
      expect(src(file), `${file} lists vlc_pastoral_flag`).toContain("vlc_pastoral_flag");
    }
  });
  it("the prod-paste FORCE-enables RLS, sets tenant_isolation + parent_deny, and NO parent_scope", () => {
    const sql = src("db/sql/prod-paste-0070-vlc-pastoral-flag.sql");
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/tenant_isolation/);
    expect(sql).toMatch(/parent_deny/);
    expect(sql).not.toMatch(/CREATE POLICY parent_scope/); // owner #4 — a parent sees NOTHING VLC-wide
  });
});

// ── VLC42b-16 · forward-dep (INCR-45) shape + singular name ────────────────────────────────────────
describe("VLC42b-16 · shape satisfies the INCR-45 existence-check without a confidential read", () => {
  it("student_id first-class + active = resolved_at IS NULL → EXISTS(...) reads no confidential column", () => {
    expect(flagBlock).toMatch(/studentId:\s*uuid\("student_id"\)\.notNull\(\)/);
    expect(flagBlock).toMatch(/resolvedAt:\s*timestamp\("resolved_at"/);
  });
  it("the table name is SINGULAR vlc_pastoral_flag (repo convention)", () => {
    expect(schema).toContain('"vlc_pastoral_flag"');
    expect(schema).not.toContain('"vlc_pastoral_flags"');
  });
});

// ── VLC42b-17 · the scope fence — 42b builds ONLY the flag ────────────────────────────────────────
describe("VLC42b-17 · scope fence — no journal/case-file/points/queue/small-group; buttons omit-not-faked", () => {
  const FENCE_FILES = [
    "db/schema/vlc.ts",
    "lib/vlc/pastoral-data.ts",
    "lib/vlc/authz.ts",
    "lib/actions/vlc-pastoral.ts",
    "components/vlc/pastoral-flag.tsx",
    "app/(app)/senior/vlc/sessions/[classId]/[date]/page.tsx",
  ];
  const FORBIDDEN = [
    "vlc_journal",
    "vlc_case_file",
    "vlc_pastoral_note",
    "case_file",
    "facilitation_point",
    "vlc_character_paragraph",
    "character_paragraph",
    "check_in_queue",
    "checkInQueue",
    "vlc_session_group",
    "small_group_table",
  ];
  it("no 42b file builds a journal / case-file / points / queue / small-group construct", () => {
    for (const f of FENCE_FILES) {
      const code = stripComments(src(f));
      for (const token of FORBIDDEN) {
        expect(code, `${f} must not reference ${token}`).not.toContain(token);
      }
    }
  });
  it("the callout OMITS-not-fakes the INCR-43 buttons (no case-note / queue / escalate control)", () => {
    expect(component).not.toContain("Open private case note");
    expect(component).not.toContain("Add to FM check-in queue");
    expect(component).not.toContain("Escalate to Dean");
    // it DOES render the 42b affordances (raise + resolve) + the confidential badge
    expect(component).toContain("Raise flag");
    expect(component).toContain("Mark resolved");
    expect(component).toContain("FM + DEAN ONLY");
  });
  it("no PG/student write path anywhere in the flag apparatus", () => {
    for (const code of [reader, actions, component]) {
      expect(code).not.toMatch(/PEER_GUIDE.*write|studentWrite|pgRaise/i);
    }
  });
});

// ── VLC42b-18 · seed exactly one active flag (ASK-24-0118) ─────────────────────────────────────────
describe("VLC42b-18 · the seed plants EXACTLY ONE active flag on Joseph Manu (ASK-24-0118)", () => {
  it("marker-scoped delete-first + a single insert on ASK-24-0118, CONCERN, surfaced by a PG", () => {
    expect(seed).toMatch(/delete\(vlcPastoralFlag\)\.where\(eq\(vlcPastoralFlag\.schoolId/);
    expect(seed).toContain("ASK-24-0118");
    expect(seed).toMatch(/severity:\s*"CONCERN"/);
    expect(seed).toMatch(/surfacedBy:\s*"Akua Gyamfi \(PG\)"/);
    // exactly one insert into the flag table
    expect((seed.match(/insert\(vlcPastoralFlag\)/g) ?? []).length).toBe(1);
  });
});

// ── the gated visibility contract — a non-gated viewer's page never reaches the reader ─────────────
describe("the non-gated visibility contract holds in the page (byte-identical to 42a)", () => {
  it("the callout / lede clause / foot-stat are all gated on the SAME canSeeFlags decision", () => {
    expect(page).toMatch(/canSeeFlags\s*=\s*[\s\S]*hasAnyRole\(user\.roles,\s*VLC_PASTORAL_READ_ROLES\)/);
    expect(page).toMatch(/canAccessPastoralFlag\(/);
    // the reader is fired ONLY past the gate
    expect(page).toMatch(/canSeeFlags[\s\S]*getPastoralFlags\(/);
    // callout + lede + foot-stat all behind the gate/showFlags
    expect(page).toMatch(/\{canSeeFlags && \(\s*<PastoralFlagPanel/);
    expect(page).toMatch(/showFlags \? ` · \$\{flags\.length\} pastoral flag/);
    expect(page).toMatch(/showFlags && \(\s*<FootStat lab="Pastoral flags"/);
  });
});
