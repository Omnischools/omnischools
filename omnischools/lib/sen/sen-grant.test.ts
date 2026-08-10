import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import type { SenAccommodationRecord } from "@/lib/sen/register-data";

/**
 * GOV-10b · SEN follow-ups (teacher accommodation-grant + editing/lifecycle) — AC GOV10-19..40.
 * The BEHAVIOURAL proofs (grant liveness, the grantee reader's GRANTED-only/granted-students-only
 * filtering, the composite-FK/cascade fences, PENDING→GRANTED count-unchanged, withdrawal
 * purge+cascade+still-counted) are the rolled-in/teardown DB round-trip in scripts/verify-sen-grant.ts
 * (`pnpm db:verify-sen-grant`, 30/30) + cross-school SELECT=0 via `pnpm db:rls-test`. Here we pin every
 * invariant a static source read + the TYPE SYSTEM can — including the KEY R436 compile-fence: the
 * accommodation record structurally cannot carry a diagnosis field (a widening breaks `tsc`, not vitest).
 *
 * The GOV10-18 audit-sweep + the sole-content-path DETAIL_RE sweep + the 7-action gate already live in
 * the sibling lib/sen/sen-register.test.ts (they auto-cover the new actions/reader); this file adds the
 * GOV-10b-specific assertions on top.
 */
const src = (rel: string) => readFileSync(resolve(cwd(), rel), "utf8");
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const schema = stripComments(src("db/schema/sen-register.ts"));
const grants = stripComments(src("lib/sen/grants.ts"));
const reader = stripComments(src("lib/sen/register-data.ts"));
const actions = stripComments(src("lib/actions/sen.ts"));
const senData = stripComments(src("lib/reports/census/sen-data.ts"));
const page = src("app/(app)/students/special-needs/page.tsx");

// The confidential diagnosis/consent cluster a GRANTEE must never see (R436).
const DIAGNOSIS_TOKENS = [
  "diagnosisSource",
  "diagnosingClinician",
  "diagnosingInstitution",
  "diagnosisYear",
];

/** Slice one exported function body out of a stripped source file. */
const fnBody = (source: string, name: string): string => {
  const start = source.indexOf(`export async function ${name}`);
  if (start < 0) return "";
  const next = source.indexOf("export async function ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
};

// ── GOV10-26 (KEY) · the grantee record structurally has NO diagnosis field — a COMPILE fence ─────────
// These are validated by `tsc --noEmit`, not vitest: adding a diagnosis/consent key to
// `SenAccommodationRecord` makes each `@ts-expect-error` unused (or the key-fence resolve to `false`),
// which FAILS the typecheck. Wrapped in a never-called fn so vitest never dereferences at runtime.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _accommodationTypeFence(rec: SenAccommodationRecord) {
  // @ts-expect-error — R436: the grantee record has NO diagnosis source
  void rec.diagnosisSource;
  // @ts-expect-error — nor the diagnosing clinician
  void rec.diagnosingClinician;
  // @ts-expect-error — nor the diagnosing institution
  void rec.diagnosingInstitution;
  // @ts-expect-error — nor the diagnosis year
  void rec.diagnosisYear;
  // @ts-expect-error — nor the consent metadata (consent gates the DETAIL, a teacher plans support)
  void rec.consentOnFileAt;
  // @ts-expect-error — nor the consent state
  void rec.consentState;
}
// Exact-key fence: resolves to `false` (a compile error on `: true`) the moment a key outside the
// accommodation set is added to the record.
type _AccKeys = keyof SenAccommodationRecord;
const _accKeyFence: Exclude<
  _AccKeys,
  "studentName" | "className" | "level" | "category" | "severity" | "supportNotes" | "accommodations"
> extends never
  ? true
  : false = true;
void _accKeyFence;

describe("GOV10-26 · the GRANTEE accommodation record excludes the diagnosis cluster (R436)", () => {
  it("the SenAccommodationRecord type block names NO diagnosis / consent field", () => {
    const typeBlock =
      reader.slice(reader.indexOf("export type SenAccommodationRecord"), reader.indexOf("};", reader.indexOf("export type SenAccommodationRecord")));
    for (const tok of [...DIAGNOSIS_TOKENS, "consentOnFileAt", "consentState"]) {
      expect(typeBlock, `SenAccommodationRecord must not carry ${tok}`).not.toContain(tok);
    }
    // it DOES carry the accommodation-planning fields (positive control — the fence isn't vacuous).
    for (const keep of ["accommodations", "severity", "supportNotes", "category"]) {
      expect(typeBlock).toContain(keep);
    }
  });

  it("the grantee reader's SELECT projects NO diagnosis column (GOV10-26/28)", () => {
    const body = fnBody(reader, "getSenAccommodationsForGrantee");
    expect(body, "the grantee reader exists").not.toBe("");
    for (const tok of DIAGNOSIS_TOKENS) {
      expect(body, `the grantee projection must not select ${tok}`).not.toContain(tok);
    }
    // consentOnFileAt is consent metadata the teacher must not see either.
    expect(body).not.toContain("consentOnFileAt");
  });
});

// ── GOV10-27/28 · GRANTED-only, granted-students-only ────────────────────────────────────────────────
describe("GOV10-27/28 · the grantee sees GRANTED-only, and only their granted students", () => {
  it("filters to GRANTED rows AND the LIVE-granted student set (never the whole register)", () => {
    const body = fnBody(reader, "getSenAccommodationsForGrantee");
    expect(body).toContain("liveSenGrantStudentIds");
    expect(body).toMatch(/eq\(senRegister\.consentState,\s*"GRANTED"\)/);
    expect(body).toMatch(/inArray\(senRegister\.studentId,\s*\[\.\.\.studentIds\]\)/);
    // an empty grant set short-circuits to [] — never a bare register read.
    expect(body).toMatch(/studentIds\.size === 0/);
  });
});

// ── GOV10-29/30 · the sole-content-path stays exactly ONE file ───────────────────────────────────────
describe("GOV10-29/30 · sole-content-path — the grantee reader is INSIDE register-data.ts; grants.ts is not an offender", () => {
  // The DETAIL_RE from the GOV10-18 sweep (lib/sen/sen-register.test.ts).
  const DETAIL_RE =
    /senRegister\.(severity|supportNotes|accommodations|diagnosisSource|diagnosingClinician|diagnosingInstitution|diagnosisYear)/;
  it("the grantee reader lives in lib/sen/register-data.ts (R437) — not a new file", () => {
    expect(reader).toContain("export async function getSenAccommodationsForGrantee");
    expect(DETAIL_RE.test(reader)).toBe(true); // it DOES project detail → correctly inside the sole path
  });
  it("lib/sen/grants.ts projects ONLY grant columns → NOT a sole-content-path offender", () => {
    expect(DETAIL_RE.test(grants)).toBe(false);
    expect(grants).toContain("senSupportGrant");
    expect(grants).not.toContain("senRegister.");
  });
});

// ── GOV10-19 · the sen_support_grant schema fence ────────────────────────────────────────────────────
describe("GOV10-19 · sen_support_grant — composite intra-tenant FK, NOT-NULL grantee CASCADE, append-only, no one-live unique", () => {
  const block = schema.slice(schema.indexOf("export const senSupportGrant"));
  it("composite (school_id, student_id) → students FK, CASCADE (a cross-tenant grant is impossible)", () => {
    expect(block).toMatch(/foreignColumns:\s*\[students\.schoolId,\s*students\.id\]/);
    expect(block).toMatch(/\}\)\.onDelete\("cascade"\)/);
  });
  it("grantee_user_id is NOT NULL and CASCADE (a grant with no grantee is not a grant)", () => {
    expect(block).toMatch(/granteeUserId:\s*uuid\("grantee_user_id"\)[\s\S]*?\.notNull\(\)[\s\S]*?onDelete:\s*"cascade"/);
  });
  it("append-only revoke columns (revoked_at / revoked_by) — the row is stamped, never deleted", () => {
    expect(block).toMatch(/revokedAt:\s*timestamp\("revoked_at"/);
    expect(block).toMatch(/revokedByUserId:\s*uuid\("revoked_by_user_id"\)/);
  });
  it("the hot-path (school_id, grantee_user_id) index + the per-student index exist", () => {
    expect(block).toMatch(/index\("sen_support_grant_grantee_idx"\)\.on\(t\.schoolId,\s*t\.granteeUserId\)/);
    expect(block).toMatch(/index\("sen_support_grant_student_idx"\)\.on\(t\.schoolId,\s*t\.studentId\)/);
  });
  it("deliberately NO 'one live grant' unique index (live depends on now())", () => {
    expect(block).not.toMatch(/unique\(/);
  });
});

// ── GOV10-22/23/24/25 · liveness in SQL + the 3-way gate ─────────────────────────────────────────────
describe("GOV10-22/23/24/25 · grant liveness is evaluated in SQL in-tx; the page routes 3-way", () => {
  it("grantIsLive = revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) — DB now(), not a session claim", () => {
    expect(grants).toMatch(/revokedAt\}\s*is null and \(/);
    expect(grants).toMatch(/expiresAt\}\s*is null or\s*\$\{[^}]*expiresAt\}\s*>\s*now\(\)\)/);
    // both helpers apply the SAME liveness predicate.
    expect(grants).toContain("export async function hasAnyLiveSenGrant");
    expect(grants).toContain("export async function liveSenGrantStudentIds");
    expect((grants.match(/grantIsLive/g) ?? []).length).toBeGreaterThanOrEqual(3); // def + 2 uses
    // the helpers read the GRANT table only (never a session cache / middleware claim).
    expect(grants).toContain("from(senSupportGrant)");
  });
  it("the page is a 3-way gate: role→admin view, else live-grant→grantee view, else notFound (in that ORDER)", () => {
    // Slice past the imports so indexOf finds the USAGE in the function body, not the import lines.
    const body = page.slice(page.indexOf("export default async function"));
    const iRole = body.indexOf("hasAnyRole(user.roles, SEN_REGISTER_ROLES)");
    const iGrant = body.indexOf("hasAnyLiveSenGrant");
    const iNotFound = body.indexOf("notFound()");
    const iGrantee = body.indexOf("getSenAccommodationsForGrantee");
    const iAdmin = body.indexOf("getSenRegister(school.id)");
    expect(iRole).toBeGreaterThan(-1);
    // the role check gates first; only a non-admin falls through to the grant lookup + notFound.
    expect(iRole).toBeLessThan(iGrant);
    expect(iGrant).toBeLessThan(iNotFound);
    expect(iNotFound).toBeLessThan(iGrantee); // notFound BEFORE the grantee reader is ever called
    // the admin content reader is reached only AFTER the non-admin arm has returned.
    expect(iGrantee).toBeLessThan(iAdmin);
  });
});

// ── GOV10-31 · the banner drift fix ──────────────────────────────────────────────────────────────────
describe("GOV10-31 · the privacy banner restores the 'unless an administrator explicitly grants access' clause", () => {
  it("the surface's grant caveat is present verbatim (else the banner asserts a falsehood now grants exist)", () => {
    expect(page).toContain("unless an administrator explicitly grants access for accommodation planning");
  });
});

// ── GOV10-32/33 · grant/revoke gates ─────────────────────────────────────────────────────────────────
describe("GOV10-32/33 · grant & revoke are admin-gated; the grantee must be in-school STAFF", () => {
  for (const name of ["grantSenAccess", "revokeSenAccess"]) {
    it(`${name} re-checks assertAnyRole(SEN_REGISTER_ROLES) BEFORE any DB work (a teacher can't self-grant)`, () => {
      const body = fnBody(actions, name);
      const gate = body.indexOf("assertAnyRole(SEN_REGISTER_ROLES)");
      const firstDb = Math.min(
        ...["withSchool", ".insert(", ".update(", ".select("].map((t) => {
          const i = body.indexOf(t);
          return i === -1 ? Number.MAX_SAFE_INTEGER : i;
        }),
      );
      expect(gate, `${name} gates on the role set`).toBeGreaterThan(-1);
      expect(gate, `${name} gate precedes any DB access`).toBeLessThan(firstDb);
    });
  }
  it("grantSenAccess refuses a STUDENT/PARENT grantee — the grantee must hold a non-STUDENT/PARENT role", () => {
    const body = fnBody(actions, "grantSenAccess");
    expect(body).toMatch(/r\.code !== "STUDENT" && r\.code !== "PARENT"/);
    expect(body).toContain("bad_grantee");
    // and the student must be an ACTIVE student of THIS school.
    expect(body).toMatch(/eq\(students\.status,\s*"ACTIVE"\)/);
    expect(body).toContain("bad_student");
  });
});

// ── GOV10-34 · revoke is append-only ─────────────────────────────────────────────────────────────────
describe("GOV10-34 · revoke is append-only — stamp revoked_at, never DELETE; a second revoke is refused", () => {
  it("revokeSenAccess UPDATEs revoked_at guarded by isNull(revoked_at); no grant row is ever deleted", () => {
    const body = fnBody(actions, "revokeSenAccess");
    expect(body).toMatch(/\.update\(senSupportGrant\)/);
    expect(body).toMatch(/revokedAt:\s*new Date\(\)/);
    expect(body).toMatch(/isNull\(senSupportGrant\.revokedAt\)/); // an already-revoked grant matches 0 rows
    expect(body).toMatch(/already revoked or does not exist/);
    // no path in the whole actions file DELETEs a grant (append-only).
    expect(actions).not.toMatch(/\.delete\(senSupportGrant\)/);
  });
});

// ── GOV10-35 · the grant/revoke/edit/consent audit is VALUES-FREE ────────────────────────────────────
describe("GOV10-35 · the GOV-10b audit payloads carry NO student-id/name/before/detail (only granteeUserId/consentState)", () => {
  const NEW_ACTIONS = ["grantSenAccess", "revokeSenAccess", "editSenRecord", "grantSenConsent", "withdrawSenConsent"];
  for (const name of NEW_ACTIONS) {
    it(`${name}'s recordAudit is values-free`, () => {
      const body = fnBody(actions, name);
      const call = body.slice(body.indexOf("recordAudit(tx,"));
      expect(call, `${name} records an audit row`).toContain("entityType");
      for (const leaky of ["severity", "diagnos", "supportNotes", "accommodations", "studentId", "firstName", "lastName", "before:"]) {
        expect(call, `${name} audit must not carry ${leaky}`).not.toContain(leaky);
      }
      // the ONLY permitted `after` keys are granteeUserId (grant) or consentState (record lifecycle).
      const after = call.match(/after:\s*\{([^}]*)\}/);
      if (after) {
        const keys = after[1].split(",").map((s) => s.split(":")[0].trim()).filter(Boolean);
        for (const k of keys) {
          expect(["granteeUserId", "consentState"], `${name} after-key ${k}`).toContain(k);
        }
      }
    });
  }
});

// ── GOV10-36/37 · editing is GRANTED-only, shares senDetailBag, advances updatedAt, keeps NO history ──
describe("GOV10-36/37 · editSenRecord — GRANTED-only, shared detail bag, updatedAt advances, no before/history", () => {
  const body = fnBody(actions, "editSenRecord");
  it("only a GRANTED record is editable (WHERE consentState='GRANTED')", () => {
    expect(body).toMatch(/eq\(senRegister\.consentState,\s*"GRANTED"\)/);
    expect(body).toMatch(/No granted record to edit/);
  });
  it("it shares senDetailBag(d, true) with create and advances updatedAt", () => {
    expect(body).toMatch(/senDetailBag\(d,\s*true\)/);
    expect(body).toMatch(/updatedAt:\s*new Date\(\)/);
  });
  it("the audit keeps NO history — after:{consentState} only, no before-snapshot (GOV10-18)", () => {
    expect(body).toMatch(/after:\s*\{\s*consentState:\s*"GRANTED"\s*\}/);
    expect(body).not.toContain("before:");
  });
});

// ── GOV10-38 · PENDING→GRANTED leaves the census total UNCHANGED ─────────────────────────────────────
describe("GOV10-38 · grantSenConsent (PENDING→GRANTED) requires the consent date and never touches the census dimension", () => {
  const body = fnBody(actions, "grantSenConsent");
  it("flips PENDING→GRANTED, requires consentOnFileAt, and does NOT alter category (so the count is unchanged)", () => {
    expect(body).toMatch(/eq\(senRegister\.consentState,\s*"PENDING"\)/);
    expect(body).toMatch(/consentState:\s*"GRANTED"/);
    // the UPDATE .set(...) must not write `category` — that's the census bucket; touching it would move a cell.
    const set = body.match(/\.set\(\{([\s\S]*?)\}\)/);
    expect(set, "the update sets something").not.toBeNull();
    expect(set?.[1] ?? "", "grantSenConsent must not rewrite the census dimension `category`").not.toMatch(/\bcategory:/);
    // consentOnFileAt is REQUIRED here (a GRANTED record proves consent is filed).
    expect(actions).toMatch(/consentOnFileAt:\s*z\.string\(\)\.regex\([^)]*\)\.nullable\(\)\.optional\(\),/); // the optional DETAIL_FIELDS one
    expect(body).toContain("No pending record to grant consent for");
  });
});

// ── GOV10-39 · the de-id census reader is UNTOUCHED by grants/edits (R442) ────────────────────────────
describe("GOV10-39 · the census de-id reader (sen-data.ts) is undisturbed by GOV-10b", () => {
  it("getCensusSpecialNeeds reads (category, sex) only — no grant, no liveness, no detail", () => {
    expect(senData).toContain("export async function getCensusSpecialNeeds");
    expect(senData).not.toContain("senSupportGrant");
    expect(senData).not.toContain("hasAnyLiveSenGrant");
    expect(senData).not.toContain("grants");
    expect(senData).toMatch(/category:\s*senRegister\.category,\s*sex:\s*students\.sex/);
  });
});

// ── GOV10-40 · withdrawal purges detail, keeps the count, cascade-revokes grants ─────────────────────
describe("GOV10-40 · withdrawSenConsent (GRANTED→PENDING) purges detail, retains the census bucket, cascade-revokes", () => {
  const body = fnBody(actions, "withdrawSenConsent");
  it("NULLs the WHOLE detail cluster + consentOnFileAt (the CHECK passes on PENDING)", () => {
    for (const col of ["severity", "supportNotes", "accommodations", "diagnosisSource", "diagnosingClinician", "diagnosingInstitution", "diagnosisYear", "consentOnFileAt"]) {
      expect(body, `${col} is nulled on withdrawal`).toMatch(new RegExp(`${col}:\\s*null`));
    }
  });
  it("demotes to PENDING but does NOT touch category → the child stays census-counted", () => {
    expect(body).toMatch(/consentState:\s*"PENDING"/);
    const set = body.match(/\.set\(\{([\s\S]*?)\}\)/);
    expect(set?.[1] ?? "").not.toMatch(/\bcategory:/);
  });
  it("cascade-revokes every LIVE grant for that student (append-only stamp, guarded by isNull(revoked_at))", () => {
    expect(body).toMatch(/\.update\(senSupportGrant\)/);
    expect(body).toMatch(/revokedAt:\s*new Date\(\)/);
    expect(body).toMatch(/eq\(senSupportGrant\.studentId,\s*rows\[0\]\.studentId\)/);
    expect(body).toMatch(/isNull\(senSupportGrant\.revokedAt\)/);
  });
});
