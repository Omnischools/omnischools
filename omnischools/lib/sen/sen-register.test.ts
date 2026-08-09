import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { SEN_REGISTER_ROLES } from "@/lib/access";
import {
  SHOWN_AUDIT_ENTITIES,
  REDACTED_AUDIT_ENTITIES,
  isRedactedAuditEntity,
} from "@/lib/audit/redaction";

/**
 * GOV-10 · SEN register — the CONFIDENTIAL invariants (AC GOV10-03/04/05/06/15/17/18). Mirrors
 * vlc-pastoral.test.ts: static source reads + the sole-content-path sweep + role-set/audit assertions. The
 * behavioural DB proofs (PENDING counted-in-census-but-excluded-from-records, the pending_no_detail CHECK,
 * the UNIQUE one-per-student, cross-tenant RLS = 0) are the rolled-back DB round-trip in
 * scripts/verify-sen-register.ts + `pnpm db:rls-test` (Quinn ran both live). Here we prove every invariant a
 * static read + a pure function can.
 */
const src = (rel: string) => readFileSync(resolve(cwd(), rel), "utf8");
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const schema = stripComments(src("db/schema/sen-register.ts"));
const reader = stripComments(src("lib/sen/register-data.ts"));
const senData = stripComments(src("lib/reports/census/sen-data.ts"));
const actions = stripComments(src("lib/actions/sen.ts"));
const generate = stripComments(src("lib/reports/census/generate.ts"));
const page = src("app/(app)/students/special-needs/page.tsx");
const exportRoute = src("app/api/sen/census-export/route.ts");

// The seven CONFIDENTIAL detail columns — the diagnosis cluster + operational detail. `category` (the census
// dimension) and the consent metadata (consentState / consentOnFileAt) are DELIBERATELY not here.
const DETAIL_RE =
  /senRegister\.(severity|supportNotes|accommodations|diagnosisSource|diagnosingClinician|diagnosingInstitution|diagnosisYear)/;

// ── GOV10-18 · THE SOLE-CONTENT-PATH SWEEP ──────────────────────────────────────────────────────────
describe("GOV10-18 · lib/sen/register-data.ts is the SOLE lib projecting a confidential SEN detail column", () => {
  it("no OTHER lib file selects severity/diagnosis*/support/accommodations off sen_register", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(resolve(cwd(), dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          if (DETAIL_RE.test(readFileSync(resolve(cwd(), p), "utf8"))) offenders.push(p);
        }
      }
    };
    walk("lib");
    expect(offenders).toEqual(["lib/sen/register-data.ts"]);
  });

  it("the census reader (sen-data.ts) reads ONLY the census dimension `category` — never a detail column", () => {
    expect(senData).toMatch(/category:\s*senRegister\.category/);
    expect(DETAIL_RE.test(senData)).toBe(false);
    expect(senData).toMatch(/^import "server-only";/m);
  });
});

// ── GOV10-03/15 · access split ──────────────────────────────────────────────────────────────────────
describe("GOV10-03/15 · SEN_REGISTER_ROLES = [ADMIN, HEADMASTER] — admin-only, deliberately not STAFF_ADMIN", () => {
  it("the gate is exactly the ADMIN + HEADMASTER pair", () => {
    expect([...SEN_REGISTER_ROLES].sort()).toEqual(["ADMIN", "HEADMASTER"]);
  });
  it("a TEACHER / PROPRIETOR / any other role is NOT a SEN register role", () => {
    for (const barred of [
      "TEACHER",
      "PROPRIETOR",
      "ACCOUNTANT",
      "BURSAR",
      "VICE_HEADMASTER_ACADEMIC",
      "HOUSEMASTER",
      "MATRON",
      "DEAN_OF_STUDENTS",
      "BOARD_MEMBER",
      "PARENT",
      "STUDENT",
    ]) {
      expect(SEN_REGISTER_ROLES, `${barred} must not reach the SEN register`).not.toContain(barred);
    }
  });
  it("the surface + the anonymised export both gate on requireSchoolRole(SEN_REGISTER_ROLES)", () => {
    expect(page).toMatch(/requireSchoolRole\(SEN_REGISTER_ROLES\)/);
    expect(exportRoute).toMatch(/requireSchoolRole\(SEN_REGISTER_ROLES\)/);
  });
  it("BOTH write actions re-check assertAnyRole(SEN_REGISTER_ROLES) server-side before any DB work", () => {
    expect((actions.match(/assertAnyRole\(SEN_REGISTER_ROLES\)/g) ?? []).length).toBe(2);
    for (const name of ["enableSenRegister", "recordSupportNeed"]) {
      const start = actions.indexOf(`export async function ${name}`);
      expect(start, `${name} exported`).toBeGreaterThan(-1);
      const next = actions.indexOf("export async function ", start + 1);
      const body = actions.slice(start, next === -1 ? undefined : next);
      expect(body, `${name} gates on the role set`).toMatch(/assertAnyRole\(SEN_REGISTER_ROLES\)/);
    }
  });
  it("GOV10-15 · the census generator reaches ONLY the de-id aggregate — never the admin content reader", () => {
    expect(generate).toContain("getCensusSpecialNeeds");
    expect(generate).not.toContain("getSenRegister");
    expect(generate).not.toContain("register-data");
    // the anonymised export is the de-id aggregate too (counts-only leaves the instance, GOV10-18)
    expect(exportRoute).toContain("getCensusSpecialNeeds");
    expect(exportRoute).not.toContain("getSenRegister");
  });
});

// ── GOV10-04/05/06 · the consent model (structural; behaviour proven in verify-sen-register.ts) ──────
describe("GOV10-04/05/06 · consent gates the DETAIL, not the census COUNT", () => {
  it("GOV10-04 · the census counts every ACTIVE row — no consentState filter (GRANTED + PENDING alike)", () => {
    // sen-data's de-id reader never even references consent — it counts all rows.
    expect(senData).not.toContain("consentState");
    // the admin reader's row query is scoped to school + ACTIVE only; the GRANTED/PENDING split is in JS.
    expect(reader).not.toMatch(/where\([^)]*consentState/);
    expect(reader).toMatch(/aggregateCensusSpecialNeeds\(/);
  });
  it("GOV10-04 · a PENDING row is COUNTED but never shaped into a detail record (excluded from the table)", () => {
    expect(reader).toMatch(/if \(r\.consentState === "PENDING"\)\s*\{[\s\S]*?pendingCount\+\+;[\s\S]*?continue;/);
    // records is the GRANTED detail table; pendingCount + census.total carry the pending child.
    expect(reader).toMatch(/records:\s*SenRecord\[\]/);
  });
  it("GOV10-05 · a GRANTED record REQUIRES a consent-on-file date (app-layer precondition)", () => {
    expect(actions).toMatch(/granted && !d\.consentOnFileAt/);
  });
  it("GOV10-05/06 · PENDING nulls the ENTIRE detail cluster before insert (defense-in-depth vs the CHECK)", () => {
    for (const col of [
      "severity",
      "supportNotes",
      "accommodations",
      "diagnosisSource",
      "diagnosingClinician",
      "diagnosingInstitution",
      "diagnosisYear",
      "consentOnFileAt",
    ]) {
      expect(actions, `${col} is withheld unless GRANTED`).toMatch(
        new RegExp(`${col}:\\s*granted \\? `),
      );
    }
  });
  it("GOV10-06 · one row per (school, student) — a second record is refused via ON CONFLICT on the unique", () => {
    expect(actions).toMatch(
      /onConflictDoNothing\(\{\s*target:\s*\[senRegister\.schoolId,\s*senRegister\.studentId\]/,
    );
  });
});

// ── GOV10-05/17 · the schema fence ──────────────────────────────────────────────────────────────────
describe("GOV10-05/17 · the sen_register schema — consent CHECK, one-per-student, no sex, scope fence", () => {
  it("R415 · UNIQUE(school_id, student_id) + the composite intra-tenant student FK", () => {
    expect(schema).toMatch(/unique\("uniq_sen_register_student"\)\.on\(t\.schoolId,\s*t\.studentId\)/);
    expect(schema).toMatch(/foreignColumns:\s*\[students\.schoolId,\s*students\.id\]/);
  });
  it("R409 · category is NOT NULL (a pending row still buckets); severity is nullable/operational", () => {
    expect(schema).toMatch(/category:\s*senCategoryEnum\("category"\)\.notNull\(\)/);
    expect(schema).toMatch(/severity:\s*senSeverityEnum\("severity"\)(?!\.notNull)/);
  });
  it("R410 · the pending_no_detail CHECK nulls the whole detail cluster on a PENDING row", () => {
    expect(schema).toContain("sen_register_pending_no_detail");
    expect(schema).toMatch(/consentState\} = 'GRANTED' OR/);
    for (const col of [
      "severity",
      "diagnosisSource",
      "diagnosingClinician",
      "diagnosingInstitution",
      "diagnosisYear",
      "supportNotes",
      "accommodations",
    ]) {
      expect(schema, `${col} must be NULL on a pending row`).toMatch(
        new RegExp(`\\$\\{t\\.${col}\\}\\s+IS NULL`),
      );
    }
    // consent_on_file_at is consent METADATA, not detail — deliberately NOT in the sensitivity gate.
    expect(schema).not.toMatch(/\$\{t\.consentOnFileAt\}\s+IS NULL/);
  });
  it("R414 · NO sex column — gender is the students.sex join, never duplicated", () => {
    expect(schema).not.toMatch(/\bsex:/);
  });
  it("R417 · scope fence — no IEP / medication / behavioural-log / clinical-history construct", () => {
    for (const code of [schema, reader, senData, actions]) {
      for (const token of ["medication", "iep", "behaviou", "behavio", "clinical_history"]) {
        expect(code.toLowerCase()).not.toContain(token);
      }
    }
  });
});

// ── GOV10-18 · audit posture ─────────────────────────────────────────────────────────────────────────
describe("GOV10-18 · sen_register audit is REDACTED; the sibling adoption marker is SHOWN", () => {
  it("sen_register is redacted (confidential), sen_module_adoption is shown (config flag)", () => {
    expect(isRedactedAuditEntity("sen_register")).toBe(true);
    expect(REDACTED_AUDIT_ENTITIES.has("sen_register")).toBe(true);
    expect(isRedactedAuditEntity("sen_module_adoption")).toBe(false);
    expect(SHOWN_AUDIT_ENTITIES.has("sen_module_adoption")).toBe(true);
    // a bare `sen_` prefix would wrongly redact the config flag — SEN is classified explicitly, not by prefix.
    expect(SHOWN_AUDIT_ENTITIES.has("sen_register")).toBe(false);
  });
  it("the record-created audit carries ONLY the consent state — never a detail value or student id/name", () => {
    const recordCalls = actions.match(/recordAudit\(tx,\s*\{[\s\S]*?\}\)/g) ?? [];
    expect(recordCalls.length).toBeGreaterThan(0);
    for (const call of recordCalls) {
      for (const leaky of ["severity", "diagnos", "supportNotes", "accommodations", "studentId", "firstName", "lastName", "before:"]) {
        expect(call, `audit payload must not carry ${leaky}`).not.toContain(leaky);
      }
    }
  });
});
