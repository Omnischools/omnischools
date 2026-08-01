import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { readCode } from "@/lib/test-utils/source-shape";

/**
 * 🔴 INCR-55a (Kofi R474–R482) — the PARENT PTA participation read: own memberships + own dues (BILLED
 * only) + own attendance. The reader imports the DB driver (server-only), so — like
 * parent-reference-data.test.ts / parent-sickbay-data.test.ts — these are SOURCE-SHAPE assertions: the
 * disclosure boundary is a structural property of the projection + the tables the reader touches + the
 * RLS predicate, not something a superuser dev DB proves. Sarah's LIVE RLS probe proves the row-access
 * (own N>0, cross-family 0, non-parent 0 incl General, cross-tenant 0, teacher-row 0, money-engine 0,
 * no-GUC no-op). This proves the column + table + import boundary. `readCode` strips comments, so the
 * deny-list tokens named in the docblocks don't self-trip.
 */
const READER = "lib/parent/parent-pta-data.ts";
const PAGE = "app/(parent)/pta/page.tsx";
const CHROME = "app/(parent)/parent-chrome.tsx";
const POLICIES = "db/sql/policies.sql";

const reader = () => readCode(READER);
const raw = (p: string) => readFileSync(resolve(cwd(), p), "utf8");

/** The declared keys of an exported interface body (no nested braces in any of the three shapes). */
const interfaceKeys = (name: string): string[] => {
  const s = reader();
  const from = s.indexOf(`export interface ${name} {`);
  const body = s.slice(from, s.indexOf("}", from));
  return [...body.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]).sort();
};

// ── PTA55-A · the THREE FROZEN key-sets — a confidential field spread onto any shape REDs a test ──────
describe("🔴 PTA55-A · frozen key-sets — the reader is the column guard, not RLS", () => {
  it("ParentPtaMembership = EXACTLY {ptaName, tier} — no ptaId/classId/houseId/status", () => {
    expect(interfaceKeys("ParentPtaMembership")).toEqual(["ptaName", "tier"]);
  });

  it("ParentPtaDue = EXACTLY {amountBilled, periodLabel, ptaName, tier} — Billed only", () => {
    expect(interfaceKeys("ParentPtaDue")).toEqual([
      "amountBilled",
      "periodLabel",
      "ptaName",
      "tier",
    ]);
  });

  it("ParentPtaAttendance = EXACTLY {meetingDateLabel, meetingLabel, ptaName, status}", () => {
    expect(interfaceKeys("ParentPtaAttendance")).toEqual([
      "meetingDateLabel",
      "meetingLabel",
      "ptaName",
      "status",
    ]);
  });

  it("ParentPtaData = EXACTLY {attendance, dues, memberships}", () => {
    expect(interfaceKeys("ParentPtaData")).toEqual(["attendance", "dues", "memberships"]);
  });
});

// ── PTA55-B · dues = BILLED off the bridge; the money engine is never touched (R476, 0-tuition-leak) ──
describe("🔴 PTA55-B · dues read rate_snapshot off the bridge, NEVER invoice/payment", () => {
  it("projects rate_snapshot (the BILLED amount) and labels it 'Billed', with no paid/outstanding", () => {
    const s = reader();
    expect(s).toMatch(/rateSnapshot/);
    expect(s).not.toMatch(/paidAmount|balanceAmount|outstanding/i);
  });

  it("touches NONE of the money-engine tables (invoice / line item / payment / receipt)", () => {
    const s = reader();
    for (const t of ["invoices", "invoiceLineItems", "payments", "paymentAllocations", "receipts"]) {
      expect(s, `must NOT touch ${t}`).not.toContain(t);
    }
  });

  it("never projects the family-identity / billing columns off the dues bridge", () => {
    const s = reader();
    for (const col of ["subjectStudentId", "householdId", "lineItemId", "academicPeriodId"]) {
      expect(s, `${col} must not appear`).not.toContain(col);
    }
  });
});

// ── PTA55-C · own attendance only — teacher register + confidential columns never touched (R477) ──────
describe("🔴 PTA55-C · own attendance only — no teacher register, no confidential column", () => {
  it("projects ONLY {meetingId, status} off pta_meeting_attendance", () => {
    const s = reader();
    expect(s).toMatch(/status:\s*ptaMeetingAttendance\.status/);
    for (const col of ["studentGuardianId", "recordedByUserId", "minutesLate"]) {
      expect(s, `${col} must not appear`).not.toContain(col);
    }
  });

  it("the meeting reader omits agenda / invited teachers / convener / quorum (staff PII, R480)", () => {
    const s = reader();
    for (const col of ["agendaJson", "invitedTeacherUserIds", "convenedByUserId", "quorumMet"]) {
      expect(s, `${col} must not appear`).not.toContain(col);
    }
  });
});

// ── PTA55-D · name derivation stays parent-reachable — no parent_deny table joined (Lucy Q2/Q4) ───────
describe("🔴 PTA55-D · names derive from parent-readable data only", () => {
  it("touches ONLY the 4 parent-scoped PTA tables + students (for the class label)", () => {
    const s = reader();
    for (const t of ["ptas", "ptaMeeting", "ptaDuesCharge", "ptaMeetingAttendance", "students"]) {
      expect(s, `expected ${t}`).toContain(t);
    }
  });

  it("joins NONE of the parent_deny naming tables (classes / houses / academic_period)", () => {
    const s = reader();
    for (const t of ["classes", "houses", "academicPeriod"]) {
      expect(s, `must NOT join ${t}`).not.toContain(t);
    }
  });

  it("touches NONE of the 55b records/directory tables (officers / minutes subtree / config)", () => {
    const s = reader();
    for (const t of [
      "ptaOfficer",
      "ptaMinutes",
      "ptaAgendaItem",
      "ptaActionItem",
      "ptaResolution",
      "ptaTiersConfig",
      "ptaDuesConfigHistory",
    ]) {
      expect(s, `must NOT touch ${t}`).not.toContain(t);
    }
  });
});

// ── PTA55-E · withParentScope ONLY, server-only, read-only ────────────────────────────────────────────
describe("🔴 PTA55-E · withParentScope only (never withSchool / withoutTenantScope), read-only", () => {
  it("is server-only and parent-scoped", () => {
    const s = reader();
    expect(s).toContain('import "server-only"');
    expect(s).toContain("withParentScope");
    expect(s).not.toContain("withSchool");
    expect(s).not.toContain("withoutTenantScope");
  });

  it("has NO write path (SELECT only)", () => {
    const s = reader();
    expect(s).not.toMatch(/\.insert\(/);
    expect(s).not.toMatch(/\.update\(/);
    expect(s).not.toMatch(/\.delete\(/);
  });
});

// ── PTA55-F · the four parent_scope policies exist and are membership/own-scoped (RLS shape) ──────────
describe("🔴 PTA55-F · Wells's four parent_scope policies are present and correctly shaped", () => {
  it("policies.sql carries parent_scope on ptas / pta_meeting / pta_dues_charge / pta_meeting_attendance", () => {
    const sql = raw(POLICIES);
    for (const tbl of ["ptas", "pta_meeting", "pta_dues_charge", "pta_meeting_attendance"]) {
      expect(sql).toContain(`CREATE POLICY parent_scope ON ${tbl}`);
    }
  });

  it("ptas.parent_scope calls parent_in_pta on its OWN row (no cycle), status='ACTIVE'", () => {
    const sql = raw(POLICIES);
    const block = sql.slice(sql.indexOf("CREATE POLICY parent_scope ON ptas"));
    const policy = block.slice(0, block.indexOf(";"));
    expect(policy).toContain("parent_in_pta");
    expect(policy).toContain("status = 'ACTIVE'");
  });

  it("pta_meeting_attendance.parent_scope keys on the parent's OWN guardian row (user_id = pu)", () => {
    const sql = raw(POLICIES);
    const block = sql.slice(sql.indexOf("CREATE POLICY parent_scope ON pta_meeting_attendance"));
    const policy = block.slice(0, block.indexOf(";"));
    expect(policy).toContain("student_guardian");
    expect(policy).toContain("app.current_parent_user");
  });
});

// ── PTA55-G · the page + chrome — session-resolved child, honest empties, live tab ────────────────────
describe("🔴 PTA55-G · the PTA tab is session-scoped and read-only", () => {
  it("the page loads the reader with the session ids, never a params/searchParams id", () => {
    const p = readCode(PAGE);
    expect(p).toMatch(/loadParentPta\(school\.id,\s*user\.id\)/);
    expect(p).not.toMatch(/loadParentPta\([^)]*params/);
    expect(p).toContain('active="PTA"');
    expect(p).toContain("requireParent");
  });

  it("the page mounts NO server action / write affordance (read-only by construction)", () => {
    const p = readCode(PAGE);
    expect(p).not.toContain('"use server"');
    expect(p).not.toMatch(/<form\b/);
    expect(p).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
  });

  it("parent-chrome wires PTA as a live tab (TABS + HREF)", () => {
    const c = readCode(CHROME);
    expect(c).toMatch(/"PTA"/);
    expect(c).toMatch(/PTA:\s*"\/pta"/);
  });
});
