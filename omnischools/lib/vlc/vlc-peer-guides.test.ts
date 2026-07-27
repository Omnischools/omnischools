import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { classFormNumber, isPeerGuideEligibleForm, classPeerGuideEligibility } from "./eligibility";
import { VLC_NO_PG_BY_POLICY, VLC_VACANCY_PROTOCOL, VLC_TENURE_RULES } from "./defaults";
import { SHOWN_AUDIT_ENTITIES, REDACTED_AUDIT_ENTITIES, isRedactedAuditEntity } from "@/lib/audit/redaction";

/**
 * INCR-41 · VLC Peer Guides — AC VLC41-1..20. Pure-function unit tests (the eligibility rule) + source-
 * shape guards (schema/actions/data/page/RLS), mirroring vlc-f0.test.ts. Behavioral RLS / tenant-isolation
 * (AC17/18) is Quinn's live-DB gate; here we prove the structural invariants a static read can.
 */
const src = (rel: string) => readFileSync(resolve(cwd(), rel), "utf8");
/** Strip block + `//` comments — the schema prose deliberately names omitted columns / the INCR-42 table. */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const PG_ENTITIES = ["vlc_peer_guide", "vlc_training", "vlc_training_absence"] as const;
const INCR41_FILES = [
  "lib/vlc/peer-guides-data.ts",
  "lib/actions/vlc-peer-guides.ts",
  "components/vlc/peer-guide-roster.tsx",
  "components/vlc/training-calendar.tsx",
  "app/(app)/senior/vlc/peer-guides/page.tsx",
];

// ── VLC41-2 · F2/F3 eligibility + the F1 refusal (the ONE rule, unit-tested) ─────────────────────
describe("VLC41-2 · Peer Guide form eligibility (F2/F3 only, F1 refused)", () => {
  it("resolves the class form from level then name, mirroring the senior-tier resolver", () => {
    expect(classFormNumber("Form 2", "Form 2 Science")).toBe(2);
    expect(classFormNumber("Form 3", "Form 3 General Arts")).toBe(3);
    expect(classFormNumber("Form 1", "Form 1 GS")).toBe(1);
    // name-only fallback when level is empty
    expect(classFormNumber(null, "Form 3 GA")).toBe(3);
    // a Basic class carries no Form token → null
    expect(classFormNumber("JHS 1", "JHS 1A")).toBeNull();
    expect(classFormNumber("Primary 6", "Primary 6B")).toBeNull();
  });

  it("only Form 2 and Form 3 are eligible; Form 1 and anything else are not", () => {
    expect(isPeerGuideEligibleForm(2)).toBe(true);
    expect(isPeerGuideEligibleForm(3)).toBe(true);
    expect(isPeerGuideEligibleForm(1)).toBe(false); // F1 receives, it does not lead
    expect(isPeerGuideEligibleForm(null)).toBe(false);
    expect(isPeerGuideEligibleForm(4)).toBe(false);
  });

  it("classPeerGuideEligibility folds resolve + rule for a class row", () => {
    expect(classPeerGuideEligibility("Form 2", "Form 2 Science")).toEqual({ form: 2, eligible: true });
    expect(classPeerGuideEligibility("Form 1", "Form 1 GS")).toEqual({ form: 1, eligible: false });
    expect(classPeerGuideEligibility("JHS 3", "JHS 3A")).toEqual({ form: null, eligible: false });
  });
});

// ── VLC41-1/6/7 · the record shape — a "class" is a classes row; composite FKs; open-row; tenure=period ─
describe("VLC41-1/6/7 · vlc_peer_guide record shape", () => {
  const schema = stripComments(src("db/schema/vlc.ts"));

  it("class_id is the CONSTITUENCY class (composite FK → classes) and student_id → students", () => {
    expect(schema).toMatch(/classId:\s*uuid\("class_id"\)/);
    expect(schema).toMatch(/foreignColumns:\s*\[classes\.schoolId,\s*classes\.id\]/);
    expect(schema).toMatch(/foreignColumns:\s*\[students\.schoolId,\s*students\.id\]/);
  });

  it("tenure is one academic_period (composite FK → academic_period), no expiry job", () => {
    expect(schema).toMatch(/academicPeriodId:\s*uuid\("academic_period_id"\)/);
    expect(schema).toMatch(/foreignColumns:\s*\[academicPeriod\.schoolId,\s*academicPeriod\.periodId\]/);
    // no cron / expiry anywhere in the INCR-41 surface
    for (const f of INCR41_FILES) {
      expect(src(f), `${f} has no expiry job`).not.toMatch(/expire|cron|expiry/i);
    }
  });

  it("ended_at is the open-row marker; tenant_uk is inline", () => {
    expect(schema).toMatch(/endedAt:\s*timestamp\("ended_at"/);
    expect(schema).toMatch(/vlc_peer_guide_tenant_uk/);
  });
});

// ── VLC41-4 · one active appointment per student per period (partial unique) ──────────────────────
describe("VLC41-4 · at most one ACTIVE appointment per (student × period)", () => {
  const schema = stripComments(src("db/schema/vlc.ts"));
  it("a PARTIAL unique index guards it, exempting ended rows", () => {
    expect(schema).toMatch(/uniq_vlc_peer_guide_active/);
    expect(schema).toMatch(/uniqueIndex\("uniq_vlc_peer_guide_active"\)[\s\S]*academicPeriodId[\s\S]*where\(sql`.*endedAt.*IS NULL/);
  });
});

// ── VLC41-3 · hard cap of 2 active per (class × period) — the 3rd is refused ──────────────────────
describe("VLC41-3 · appoint enforces the hard cap of 2 active", () => {
  const actions = src("lib/actions/vlc-peer-guides.ts");
  it("appointPeerGuide counts active PGs in the class×period and refuses at >= 2", () => {
    const start = actions.indexOf("export async function appointPeerGuide");
    const body = actions.slice(start, actions.indexOf("export async function", start + 1));
    expect(body).toMatch(/>=\s*2/);
    expect(body).toMatch(/two active Peer Guides/);
    // it scopes the count to the class AND the current period
    expect(body).toMatch(/vlcPeerGuide\.classId/);
    expect(body).toMatch(/academicPeriodId/);
    expect(body).toMatch(/isNull\(vlcPeerGuide\.endedAt\)/);
  });
});

// ── VLC41-8/9 · vacate = set ended_at, NEVER delete; fill = a new row same period ─────────────────
describe("VLC41-8/9 · append-only vacate + fill", () => {
  const actions = src("lib/actions/vlc-peer-guides.ts");
  it("endPeerGuide sets ended_at and never deletes a peer_guide row", () => {
    expect(actions).toMatch(/endedAt:\s*new Date\(\)/);
    expect(actions).not.toMatch(/delete\(vlcPeerGuide\)/);
  });
  it("appoint inserts scoped to the CURRENT academic_period (fill-vacancy is a fresh row)", () => {
    expect(actions).toMatch(/getCurrentPeriod/);
    expect(actions).toMatch(/academicPeriodId:\s*period\.periodId/);
  });
});

// ── VLC41-5/11 · no derived-duplicate scalars on the roster or the training ──────────────────────
describe("VLC41-5/11 · the schema stores no derivable / status column", () => {
  const schema = stripComments(src("db/schema/vlc.ts"));
  // Scope to the INCR-41 tables only (vlc_peer_guide → the INCR-42a tables that follow). INCR-42a
  // legitimately adds a status-bearing vlc_session_attendance ("attendance"-named, reusing the canonical
  // attendance_status enum, R313) to the SAME file — so this INCR-41 invariant is asserted against the
  // INCR-41 block, not the whole vlc.ts (a scope reconciliation, not a gutting).
  const incr41Schema = schema.slice(
    schema.indexOf("export const vlcPeerGuide ="),
    schema.indexOf("export const vlcSession ="),
  );
  it("no stored status / count / gender-balance / slot-gender / training-complete on the PG table", () => {
    for (const forbidden of [
      "slot_gender",
      "slotGender",
      "rep_gender",
      "repGender",
      "gender_balance",
      "active_count",
      "activeCount",
      "training_completed",
      "trainingCompleted",
      '"status"',
      "status:",
    ]) {
      expect(incr41Schema, `the INCR-41 tables must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });
  it("vlc_training stores no attendance / % / status / count", () => {
    for (const forbidden of ["attendance", "percent", "present_count", "presentCount", "attended"]) {
      expect(incr41Schema, `vlc_training must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });
});

// ── VLC41-10 · vacancy is DERIVED (< 2 active), never a stored row ────────────────────────────────
describe("VLC41-10 · vacancy is derived (< 2 active in an eligible class)", () => {
  const data = src("lib/vlc/peer-guides-data.ts");
  it("the reader derives vacancy from slots.length < 2 on eligible classes", () => {
    expect(data).toMatch(/vacancy:\s*eligible\s*&&\s*slots\.length\s*<\s*2/);
  });
  it("no vacancy / ballot / candidate / vote table exists (OC2 — record outcome only)", () => {
    const schema = stripComments(src("db/schema/vlc.ts"));
    for (const forbidden of ["vlc_vacancy", "vlc_candidate", "vlc_ballot", "vlc_nomination", "vlc_vote", "vote_date"]) {
      expect(schema).not.toContain(forbidden);
    }
  });
});

// ── VLC41-12 · training-absence present-by-default, one row per (training × PG) ───────────────────
describe("VLC41-12 · present-by-default training attendance", () => {
  const schema = stripComments(src("db/schema/vlc.ts"));
  const actions = src("lib/actions/vlc-peer-guides.ts");
  it("UNIQUE(school_id, training_id, peer_guide_id) is the one-row-per-pair conflict target", () => {
    expect(schema).toMatch(/uniq_vlc_training_absence/);
    expect(schema).toMatch(/unique\("uniq_vlc_training_absence"\)\.on\([\s\S]*trainingId,[\s\S]*peerGuideId/);
  });
  it("recordTrainingAbsence upserts an absence; a 'present' marks by DELETING the row", () => {
    expect(actions).toMatch(/onConflictDoUpdate/);
    expect(actions).toMatch(/delete\(vlcTrainingAbsence\)/);
  });
});

// ── VLC41-13 · attendance boundary — INCR-41 introduces NO vlc_session / student P/L/A ────────────
describe("VLC41-13 · the attendance boundary (no vlc_session in INCR-41)", () => {
  it("no INCR-41 file references a vlc_session table (that lands at INCR-42)", () => {
    for (const f of INCR41_FILES) {
      const code = stripComments(src(f));
      expect(code, `${f} must not reference vlc_session`).not.toMatch(/vlc_session|vlcSession/);
    }
  });
  it("migration 0066 creates no vlc_session table", () => {
    const mig = src("db/migrations/0066_silky_jigsaw.sql");
    expect(mig).not.toMatch(/CREATE TABLE.*vlc_session/i);
  });
});

// ── VLC41-14 · every mutation is behind the write gate ───────────────────────────────────────────
describe("VLC41-14 · write gate on all four actions", () => {
  const actions = src("lib/actions/vlc-peer-guides.ts");
  const names = ["appointPeerGuide", "endPeerGuide", "scheduleTraining", "recordTrainingAbsence"] as const;
  it("the shared gate checks VLC_CONFIG_WRITE_ROLES via assertAnyRole", () => {
    expect(actions).toMatch(/assertAnyRole\(VLC_CONFIG_WRITE_ROLES\)/);
  });
  it("each of the four actions routes through authorizeVlcWrite()", () => {
    for (const name of names) {
      const start = actions.indexOf(`export async function ${name}`);
      expect(start, `${name} exported`).toBeGreaterThan(-1);
      const next = actions.indexOf("export async function ", start + 1);
      const body = actions.slice(start, next === -1 ? undefined : next);
      expect(body, `${name} calls the gate`).toMatch(/authorizeVlcWrite\(\)/);
    }
  });
});

// ── VLC41-15 · the page + layout read-gate VLC_CONFIG_READ_ROLES + BASIC redirect ────────────────
describe("VLC41-15 · read gate", () => {
  it("the page requires VLC_CONFIG_READ_ROLES, redirects BASIC, splits canEdit on the write gate", () => {
    const page = src("app/(app)/senior/vlc/peer-guides/page.tsx");
    expect(page).toMatch(/requireSchoolRole\(VLC_CONFIG_READ_ROLES\)/);
    expect(page).toMatch(/schoolType === "BASIC"[\s\S]*redirect\("\/dashboard"\)/);
    expect(page).toMatch(/hasAnyRole\(user\.roles,\s*VLC_CONFIG_WRITE_ROLES\)/);
  });
  it("the VLC layout gates the shared sub-nav to the read group", () => {
    const layout = src("app/(app)/senior/vlc/layout.tsx");
    expect(layout).toMatch(/requireSchoolRole\(VLC_CONFIG_READ_ROLES\)/);
    expect(layout).toMatch(/VlcTabs/);
  });
});

// ── VLC41-16 · the three entities are SHOWN, none `vlc_pastoral_`, classify guard green ───────────
describe("VLC41-16 · audit classification (SHOWN, no pastoral prefix)", () => {
  it("all three entities are SHOWN and never redacted (operational, no PII)", () => {
    for (const e of PG_ENTITIES) {
      expect(SHOWN_AUDIT_ENTITIES.has(e), `${e} SHOWN`).toBe(true);
      expect(REDACTED_AUDIT_ENTITIES.has(e), `${e} not redacted`).toBe(false);
      expect(isRedactedAuditEntity(e), `${e} predicate not redacting`).toBe(false);
      expect(e.startsWith("vlc_pastoral_"), `${e} is not a reserved pastoral entity`).toBe(false);
    }
  });
  it("the four actions audit their own SHOWN entities", () => {
    const actions = src("lib/actions/vlc-peer-guides.ts");
    expect(actions).toMatch(/entityType: "vlc_peer_guide"/);
    expect(actions).toMatch(/entityType: "vlc_training"/);
    expect(actions).toMatch(/entityType: "vlc_training_absence"/);
  });
});

// ── VLC41-17/18 · RLS — the three tables are FORCE + tenant_isolation + parent_deny (source-shape) ─
describe("VLC41-17/18 · RLS is configured for all three tables", () => {
  it("policies.sql + the prod-paste list all three in the tenant_isolation array", () => {
    for (const file of ["db/sql/policies.sql", "db/sql/prod-paste-0068-vlc-peer-guides.sql"]) {
      const sql = src(file);
      for (const t of PG_ENTITIES) expect(sql, `${file} lists ${t}`).toContain(t);
    }
  });
  it("the prod-paste FORCE-enables RLS + runs the catalog-driven parent_deny loop", () => {
    const sql = src("db/sql/prod-paste-0068-vlc-peer-guides.sql");
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/tenant_isolation/);
    expect(sql).toMatch(/parent_deny/);
  });
});

// ── VLC41-19 · gender is ADVISORY — appoint never refuses two same-sex PGs ────────────────────────
describe("VLC41-19 · gender is advisory, not enforced", () => {
  const actions = src("lib/actions/vlc-peer-guides.ts");
  it("appointPeerGuide validates form + cap + one-per-student, but NOT rep gender", () => {
    const start = actions.indexOf("export async function appointPeerGuide");
    const body = actions.slice(start, actions.indexOf("export async function", start + 1));
    // no sex/gender branch in the appoint validation
    expect(body).not.toMatch(/\.sex\b/);
    expect(body).not.toMatch(/same[-\s]?sex/i);
  });
  it("the appoint UI states gender balance is advisory", () => {
    expect(src("components/vlc/peer-guide-roster.tsx")).toMatch(/advisory/i);
  });
});

// ── VLC41-20 · no character-paragraph / pastoral / journal table is built this increment ──────────
describe("VLC41-20 · INCR-42/43 tables are NOT built", () => {
  const schema = stripComments(src("db/schema/vlc.ts"));
  const mig = src("db/migrations/0066_silky_jigsaw.sql");
  it("no character_paragraph / pastoral_flag / journal / session table in schema or migration 0066", () => {
    for (const forbidden of ["character_paragraph", "vlc_pastoral", "vlc_journal", "vlc_reflection"]) {
      expect(schema, `schema must not build ${forbidden}`).not.toContain(forbidden);
      expect(mig, `migration must not build ${forbidden}`).not.toContain(forbidden);
    }
    // migration 0066 creates exactly the three INCR-41 tables
    expect(mig).toMatch(/CREATE TABLE.*vlc_peer_guide/);
    expect(mig).toMatch(/CREATE TABLE.*vlc_training/);
    expect(mig).toMatch(/CREATE TABLE.*vlc_training_absence/);
  });
});

// ── DRY (Lucy #9) · SectionHead / SumCard extracted, warn variant added, setup re-points ──────────
describe("chrome extraction · SectionHead + SumCard (+ warn) shared, setup re-points", () => {
  const chrome = src("components/vlc/chrome.tsx");
  it("chrome.tsx exports both helpers and a warn SumCard variant", () => {
    expect(chrome).toMatch(/export function SectionHead/);
    expect(chrome).toMatch(/export function SumCard/);
    expect(chrome).toMatch(/warn\?:\s*boolean/);
    expect(chrome).toMatch(/bg-warn-bg/);
  });
  it("the setup page imports them from chrome (no second local definition)", () => {
    const setup = src("app/(app)/senior/vlc/setup/page.tsx");
    expect(setup).toMatch(/from "@\/components\/vlc\/chrome"/);
    expect(setup).not.toMatch(/^function SumCard\(/m);
    expect(setup).not.toMatch(/^function SectionHead\(/m);
  });
});

// ── frozen copy self-check — the policy strings are present + non-empty ───────────────────────────
describe("frozen Peer Guide copy", () => {
  it("carries the no-PG-by-policy, vacancy-protocol and tenure-rules editorial", () => {
    expect(VLC_NO_PG_BY_POLICY.title).toMatch(/No Peer Guides by policy/);
    expect(VLC_VACANCY_PROTOCOL.length).toBeGreaterThan(0);
    expect(VLC_TENURE_RULES.length).toBeGreaterThan(0);
    // the vacancy protocol is offline-vote / record-outcome (OC2), never a digital ballot
    expect(VLC_VACANCY_PROTOCOL.join(" ")).toMatch(/offline/i);
  });
});
