import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { canWriteSession } from "./authz";
import {
  coalesceVlcProgramme,
  addMinutes,
} from "./defaults";
import {
  derivePhaseWindows,
  derivePhaseClock,
  isSessionWriteLocked,
  deriveAttendanceCounts,
  sessionInstant,
} from "./session-clock";
import { SHOWN_AUDIT_ENTITIES, REDACTED_AUDIT_ENTITIES, isRedactedAuditEntity } from "@/lib/audit/redaction";

/**
 * INCR-42a · VLC Session register — AC VLC42a-1..17. Pure-function unit tests (the phase clock, the
 * auto-lock, the present-by-default counts, the FM-only write scope) + source-shape guards
 * (schema/actions/data/pages/RLS + the scope fence), mirroring vlc-peer-guides.test.ts. Behavioral RLS /
 * tenant-isolation (AC15/16) is Quinn's live-DB gate; here we prove the structural invariants a static
 * read can. OPERATIONAL, SHOWN, NO pastoral PII.
 */
const src = (rel: string) => readFileSync(resolve(cwd(), rel), "utf8");
/** Strip block + `//` comments — the schema/action prose deliberately names omitted columns + INCR-42b. */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const SESSION_ENTITIES = ["vlc_session", "vlc_session_attendance"] as const;

const schema = stripComments(src("db/schema/vlc.ts"));
const sessionBlock = schema.slice(
  schema.indexOf("export const vlcSession ="),
  schema.indexOf("export const vlcSessionAttendance ="),
);
const attendanceBlock = schema.slice(
  schema.indexOf("export const vlcSessionAttendance ="),
  // Bound to the next table so the block never over-captures INCR-42b/43a's siblings (which carry
  // `summary`/`body` and would false-trip the no-derived-scalar guard below).
  schema.indexOf("export const vlcPastoralFlag ="),
);
const actions = src("lib/actions/vlc-sessions.ts");
const data = src("lib/vlc/session-data.ts");

// The frozen Wednesday programme (14:30, 5·25·15·10·5 = 60) → the clock/lock/count derivations.
const programme = coalesceVlcProgramme(null);
const DATE = "2026-05-13";

// ── VLC42a-1 · one session per (class × date) upsert ──────────────────────────────────────────────
describe("VLC42a-1 · one vlc_session per (class × date), upserted", () => {
  it("the schema's natural key is UNIQUE(school_id, class_id, session_date)", () => {
    expect(sessionBlock).toMatch(/unique\("uniq_vlc_session"\)\.on\([\s\S]*schoolId,[\s\S]*classId,[\s\S]*sessionDate/);
  });
  it("openSession upserts on that same conflict target", () => {
    expect(actions).toMatch(
      /target:\s*\[\s*vlcSession\.schoolId,\s*vlcSession\.classId,\s*vlcSession\.sessionDate/,
    );
  });
});

// ── VLC42a-2 · refs the TEMPLATE, not the value; no programme_id / academic_period_id ─────────────
describe("VLC42a-2 · vlc_session references the session_template (value + slot derive through it)", () => {
  it("carries session_template_id and NO value_id / programme_id / academic_period_id", () => {
    expect(sessionBlock).toMatch(/sessionTemplateId:\s*uuid\("session_template_id"\)/);
    for (const forbidden of ["value_id", "valueId", "programme_id", "programmeId", "academic_period_id", "academicPeriodId"]) {
      expect(sessionBlock, `vlc_session must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });
  it("the FK targets the vlc_session_template tenant_uk (composite, intra-tenant)", () => {
    expect(sessionBlock).toMatch(
      /foreignColumns:\s*\[vlcSessionTemplate\.schoolId,\s*vlcSessionTemplate\.id\]/,
    );
  });
});

// ── VLC42a-3 · phase timings DERIVE — no phase / started_at column ─────────────────────────────────
describe("VLC42a-3 · the lifecycle windows derive; nothing per-phase is stored", () => {
  it("vlc_session has NO started_at / phase / duration column", () => {
    for (const forbidden of ["started_at", "startedAt", "opener", "small_group", "plenary", "reflection", "close_min", "phase", "duration"]) {
      expect(sessionBlock, `vlc_session must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });
  it("derivePhaseWindows accumulates the 5 F0 phases from the scheduled start", () => {
    const w = derivePhaseWindows(programme);
    expect(w.map((p) => p.name)).toEqual(["Opener", "Small groups", "Plenary", "Reflection", "Close"]);
    expect(w[0].startHHMM).toBe("14:30");
    expect(w[0].endHHMM).toBe(addMinutes("14:30", 5)); // 14:35
    expect(w[4].endHHMM).toBe("15:30"); // 60 min total
    expect(w[0].windowLabel).toBe("2:30 — 2:35");
  });
});

// ── VLC42a-4 · no stored status/locked/closed on vlc_session ──────────────────────────────────────
describe("VLC42a-4 · vlc_session stores no lifecycle status", () => {
  it("no status / locked / closed column", () => {
    for (const forbidden of ['"status"', "status:", "locked", "closed", "is_open", "isOpen"]) {
      expect(sessionBlock, `vlc_session must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });
});

// ── VLC42a-5 · the auto-lock DERIVES (a write after the window is refused) ─────────────────────────
describe("VLC42a-5 · auto-lock derives from session_date + the F0 close vs now", () => {
  it("isSessionWriteLocked is false during the window, true after the close", () => {
    expect(isSessionWriteLocked(programme, DATE, sessionInstant(DATE, "15:00"))).toBe(false);
    expect(isSessionWriteLocked(programme, DATE, sessionInstant(DATE, "15:30"))).toBe(true);
    expect(isSessionWriteLocked(programme, DATE, sessionInstant(DATE, "16:00"))).toBe(true);
    // a prior date is always past its window → locked
    expect(isSessionWriteLocked(programme, "2020-01-01", new Date())).toBe(true);
  });
  it("markAttendance refuses a write once the derived window has elapsed (no stored `locked`)", () => {
    expect(actions).toMatch(/isSessionWriteLocked\(/);
    expect(actions).toMatch(/auto-locked/);
    // Scoped to the session table: the auto-lock DERIVES, so vlc_session stores no `locked` column. (The
    // whole file legitimately carries `locked_at` since INCR-43b's vlc_pastoral_paragraph — a per-student
    // year-end freeze, unrelated to the session lifecycle — so this guard bounds to the session block, the
    // same block-bounding discipline the attendance block uses above.)
    expect(sessionBlock).not.toContain("locked");
  });
});

// ── VLC42a-6 · present-by-default (a row ONLY for a non-present student) ───────────────────────────
describe("VLC42a-6 · present-by-default (40 enrolled, 2 late + 4 absent = 6 rows)", () => {
  it("PRESENT is the absence of a row: 6 not-present rows for a class of 40", () => {
    const c = deriveAttendanceCounts(40, 2, 4);
    expect(c.present).toBe(36); // 40 − 4 ABSENT (LATE counts present)
    expect(c.late).toBe(2);
    expect(c.absent).toBe(4);
    // the row count is the not-present set only
    expect(c.late + c.absent).toBe(6);
  });
  it("markAttendance deletes the row on PRESENT and upserts otherwise", () => {
    expect(actions).toMatch(/status === "PRESENT"/);
    expect(actions).toMatch(/delete\(vlcSessionAttendance\)/);
    expect(actions).toMatch(/onConflictDoUpdate/);
  });
});

// ── VLC42a-7 · reuses the canonical enum; capture is P / L / A ─────────────────────────────────────
describe("VLC42a-7 · vlc_session_attendance reuses attendance_status (not a forked VLC enum)", () => {
  it("status is the canonical attendanceStatusEnum", () => {
    expect(attendanceBlock).toMatch(/status:\s*attendanceStatusEnum\("status"\)/);
    // no forked VLC status enum / P-L-A CHECK in the schema
    expect(schema).not.toMatch(/pgEnum\("vlc_/);
    expect(schema).not.toMatch(/'P',\s*'L',\s*'A'/);
  });
  it("the capture action surfaces P / L / A only", () => {
    expect(actions).toMatch(/z\.enum\(\["PRESENT",\s*"LATE",\s*"ABSENT"\]\)/);
    expect(actions).not.toMatch(/"MEDICAL"|"EXCUSED"/);
  });
});

// ── VLC42a-8 · attendance composite FKs + UNIQUE(session, student) upsert ──────────────────────────
describe("VLC42a-8 · vlc_session_attendance FKs + upsert key", () => {
  it("composite FKs to vlc_session + students, UNIQUE(school_id, session_id, student_id)", () => {
    expect(attendanceBlock).toMatch(/foreignColumns:\s*\[vlcSession\.schoolId,\s*vlcSession\.id\]/);
    expect(attendanceBlock).toMatch(/foreignColumns:\s*\[students\.schoolId,\s*students\.id\]/);
    expect(attendanceBlock).toMatch(
      /unique\("uniq_vlc_session_attendance"\)\.on\([\s\S]*sessionId,[\s\S]*studentId/,
    );
  });
});

// ── VLC42a-9 · FM-only write (own-class), everyone else refused ────────────────────────────────────
describe("VLC42a-9 · canWriteSession = own-class Form Master ONLY (FM-only, owner d)", () => {
  it("the own-class Form Master writes; a different class's FM does not", () => {
    expect(canWriteSession({ roles: ["FORM_MASTER"], userId: "u1", classTeacherUserId: "u1" })).toBe(true);
    expect(canWriteSession({ roles: ["FORM_MASTER"], userId: "u1", classTeacherUserId: "u2" })).toBe(false);
  });
  it("Dean / Admin do NOT get a school-wide write (owner d = FM-only; they READ, and a break-glass widen is a later opt-in)", () => {
    expect(canWriteSession({ roles: ["DEAN_OF_STUDENTS"], userId: "u1", classTeacherUserId: "u2" })).toBe(false);
    expect(canWriteSession({ roles: ["ADMIN"], userId: "u1", classTeacherUserId: "u2" })).toBe(false);
    // being the class's assigned teacher IS being its FM — a Dean who also holds the class writes that class
    expect(canWriteSession({ roles: ["DEAN_OF_STUDENTS"], userId: "u1", classTeacherUserId: "u1" })).toBe(true);
  });
  it("Headmaster (read-only), a student, a Peer Guide and a null user are refused", () => {
    expect(canWriteSession({ roles: ["HEADMASTER"], userId: "u1", classTeacherUserId: "u2" })).toBe(false);
    expect(canWriteSession({ roles: ["STUDENT"], userId: "u1", classTeacherUserId: "u2" })).toBe(false);
    expect(canWriteSession({ roles: [], userId: "u1", classTeacherUserId: "u2" })).toBe(false);
    expect(canWriteSession({ roles: ["FORM_MASTER"], userId: null, classTeacherUserId: null })).toBe(false);
  });
  it("both actions re-check the write scope server-side (the real boundary)", () => {
    expect(actions).toMatch(/canWriteSession/);
    // openSession + markAttendance each route through the mayWrite gate
    for (const name of ["openSession", "markAttendance"]) {
      const start = actions.indexOf(`export async function ${name}`);
      expect(start, `${name} exported`).toBeGreaterThan(-1);
      const next = actions.indexOf("export async function ", start + 1);
      const body = actions.slice(start, next === -1 ? undefined : next);
      expect(body, `${name} gates the write`).toMatch(/mayWrite\(/);
    }
  });
});

// ── VLC42a-10 · PG-gold DERIVES from the INCR-41 roster (no marked_by_pg column) ──────────────────
describe("VLC42a-10 · the PG-gold marker is derived, never stored", () => {
  it("no marked_by_pg / peer_guide column on vlc_session_attendance", () => {
    for (const forbidden of ["marked_by_pg", "markedByPg", "peer_guide", "peerGuide", "is_pg", "isPg"]) {
      expect(attendanceBlock, `attendance must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });
  it("the reader derives isPeerGuide from the active vlc_peer_guide roster", () => {
    expect(data).toMatch(/isPeerGuide:/);
    expect(data).toMatch(/vlcPeerGuide/);
  });
});

// ── VLC42a-11 · no small-group / project-brief table ──────────────────────────────────────────────
describe("VLC42a-11 · small groups are derived/ephemeral — no table", () => {
  it("no vlc_session_group / member / project table in the schema", () => {
    for (const forbidden of ["vlc_session_group", "vlc_group", "session_group_member", "project_brief", "vlc_project"]) {
      expect(schema, `schema must not build ${forbidden}`).not.toContain(forbidden);
    }
  });
  it("the reader derives the two groups from the 2 PGs + the present roster (no persistence)", () => {
    expect(data).toMatch(/groups:\s*SessionGroup\[\]/);
  });
});

// ── VLC42a-12/13 · rate derives; no derived-scalar columns ────────────────────────────────────────
describe("VLC42a-12/13 · counts derive; no stored present_count / rate / late_count", () => {
  it("the rate reproduces 36 / 90% / 2 late / 4 absent from the rows", () => {
    const c = deriveAttendanceCounts(40, 2, 4);
    expect(c.presentPct).toBe(90);
  });
  it("neither table stores a summary scalar", () => {
    for (const forbidden of [
      "present_count",
      "presentCount",
      "attendance_rate",
      "attendanceRate",
      "late_count",
      "lateCount",
      "absent_count",
      "phase_current",
      "phaseCurrent",
      "summary",
    ]) {
      expect(sessionBlock, `vlc_session must not carry ${forbidden}`).not.toContain(forbidden);
      expect(attendanceBlock, `attendance must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });
});

// ── VLC42a-14 · both entities are SHOWN, classify guard green ──────────────────────────────────────
describe("VLC42a-14 · audit classification (SHOWN, no pastoral prefix)", () => {
  it("both entities are SHOWN and never redacted (operational, no PII)", () => {
    for (const e of SESSION_ENTITIES) {
      expect(SHOWN_AUDIT_ENTITIES.has(e), `${e} SHOWN`).toBe(true);
      expect(REDACTED_AUDIT_ENTITIES.has(e), `${e} not redacted`).toBe(false);
      expect(isRedactedAuditEntity(e), `${e} predicate not redacting`).toBe(false);
      expect(e.startsWith("vlc_pastoral_"), `${e} is not a reserved pastoral entity`).toBe(false);
    }
  });
  it("both actions audit their own SHOWN entities", () => {
    expect(actions).toMatch(/entityType: "vlc_session"/);
    expect(actions).toMatch(/entityType: "vlc_session_attendance"/);
  });
});

// ── VLC42a-15/16 · RLS — FORCE + tenant_isolation + parent_deny on both tables (source-shape) ──────
describe("VLC42a-15/16 · RLS is configured for both tables", () => {
  it("policies.sql + the prod-paste list both in the tenant_isolation array", () => {
    for (const file of ["db/sql/policies.sql", "db/sql/prod-paste-0069-vlc-session-register.sql"]) {
      const sql = src(file);
      for (const t of SESSION_ENTITIES) expect(sql, `${file} lists ${t}`).toContain(t);
    }
  });
  it("the prod-paste FORCE-enables RLS + runs the catalog-driven parent_deny loop", () => {
    const sql = src("db/sql/prod-paste-0069-vlc-session-register.sql");
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/tenant_isolation/);
    expect(sql).toMatch(/parent_deny/);
  });
});

// ── VLC42a-17 · the hard scope fence — NO pastoral / journal / points / PG-write / small-group ─────
describe("VLC42a-17 · scope fence — 42a builds none of the 42b/43 apparatus", () => {
  // NB (INCR-42b): the session register PAGE now legitimately carries the confidential flag-callout
  // wiring (VLC_PASTORAL_READ_ROLES, canAccessPastoralFlag, getPastoralFlags), so it is no longer a
  // 42a-only fence file — that gate moved to vlc-pastoral.test.ts. The 42a operational files below stay
  // fenced: they must NOT reference the pastoral apparatus.
  // db/schema/vlc.ts is intentionally NOT fenced here: it is a SHARED file, and INCR-42b legitimately
  // added vlc_pastoral_flag to it. The 42a-scoped schema guarantee is the migration-0067 check below
  // (0067 builds ONLY the two operational tables). The files below are the 42a OPERATIONAL code paths,
  // which must never reference the pastoral apparatus.
  const FENCE_FILES = [
    "lib/vlc/session-data.ts",
    "lib/vlc/session-clock.ts",
    "lib/actions/vlc-sessions.ts",
    "components/vlc/session-register.tsx",
    "app/(app)/senior/vlc/sessions/page.tsx",
  ];
  const FORBIDDEN = [
    "vlc_pastoral",
    "VLC_PASTORAL",
    "vlc_journal",
    "vlc_reflection",
    "vlc_character",
    "vlc_session_group",
    "pastoral_flag",
    "flag_callout",
    "facilitation_point",
    "pastoral judgement",
    "marked_by_pg",
  ];
  it("no 42a file references a 42b/43 pastoral / journal / points / small-group construct", () => {
    for (const f of FENCE_FILES) {
      const code = stripComments(src(f));
      for (const token of FORBIDDEN) {
        expect(code, `${f} must not reference ${token}`).not.toContain(token);
      }
    }
  });
  it("migration 0067 creates exactly the two INCR-42a tables and no pastoral table", () => {
    const mig = src("db/migrations/0067_chubby_unicorn.sql");
    expect(mig).toMatch(/CREATE TABLE "vlc_session"/);
    expect(mig).toMatch(/CREATE TABLE "vlc_session_attendance"/);
    for (const forbidden of ["vlc_pastoral", "vlc_journal", "vlc_character", "vlc_session_group"]) {
      expect(mig).not.toContain(forbidden);
    }
  });
});

// ── phase-clock state derivation self-check (the lifecycle bar + foot-bar) ─────────────────────────
describe("phase clock · done / active / pending + elapsed / remaining derive", () => {
  it("mid-plenary: 2 done, Plenary active, 2 pending; 35 elapsed, 25 remaining", () => {
    const clock = derivePhaseClock(programme, DATE, sessionInstant(DATE, "15:05"));
    expect(clock.windows.map((w) => w.state)).toEqual(["done", "done", "active", "pending", "pending"]);
    expect(clock.activeIndex).toBe(2);
    expect(clock.phasesComplete).toBe(2);
    expect(clock.elapsedMin).toBe(35);
    expect(clock.remainingMin).toBe(25);
    expect(clock.closeLabel).toBe("3:30 PM");
  });
  it("before the start everything is pending; after the close everything is done", () => {
    const before = derivePhaseClock(programme, DATE, sessionInstant(DATE, "14:00"));
    expect(before.windows.every((w) => w.state === "pending")).toBe(true);
    expect(before.activeIndex).toBe(-1);
    const after = derivePhaseClock(programme, DATE, sessionInstant(DATE, "16:00"));
    expect(after.windows.every((w) => w.state === "done")).toBe(true);
    expect(after.remainingMin).toBe(0);
    expect(after.phasesComplete).toBe(5);
  });
});
