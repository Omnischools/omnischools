import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { readCode } from "@/lib/test-utils/source-shape";
import {
  bestOfficeByHolder,
  officeRank,
  ownerWithOffice,
  ptaNameFor,
} from "@/lib/pta/parent-labels";

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

  it("ParentPtaData = EXACTLY {attendance, dues, memberships, minutes, officers}", () => {
    expect(interfaceKeys("ParentPtaData")).toEqual([
      "attendance",
      "dues",
      "memberships",
      "minutes",
      "officers",
    ]);
  });
});

// ── PTA55b-A · the officer frozen key-set — electionRef/endReason/contact spread REDs a test (R479) ────
describe("🔴 PTA55b-A · ParentPtaOfficer frozen key-set — the reader is the officer column guard", () => {
  it("ParentPtaOfficer = EXACTLY {holderName, isYou, office, ptaName, term, tier} — no id/audit/contact", () => {
    expect(interfaceKeys("ParentPtaOfficer")).toEqual([
      "holderName",
      "isYou",
      "office",
      "ptaName",
      "term",
      "tier",
    ]);
  });

  it("never projects the officer-only audit / holder-id columns (electionRef / endReason / basis)", () => {
    const s = reader();
    for (const col of ["electionRef", "endReason", "assignmentBasis"]) {
      expect(s, `${col} must not appear`).not.toContain(col);
    }
  });

  it("derives isYou from personUserId (read) but the id is NEVER in the projected shape", () => {
    // personUserId is read to compute the boolean; the frozen key-set (above) guarantees it isn't exported.
    const s = reader();
    expect(s).toMatch(/personUserId != null && r\.personUserId === userId/);
  });
});

// ── PTA55b-B · the adopted-minutes frozen key-sets — DRAFT/deadline/aggregate spread REDs a test (R478) ─
describe("🔴 PTA55b-B · adopted-minutes frozen key-sets — public subtree only", () => {
  it("ParentPtaMinutes = EXACTLY {actionItems, agendaItems, meetingDateLabel, meetingLabel, ptaName, quorumMet, resolutions, tier}", () => {
    expect(interfaceKeys("ParentPtaMinutes")).toEqual([
      "actionItems",
      "agendaItems",
      "meetingDateLabel",
      "meetingLabel",
      "ptaName",
      "quorumMet",
      "resolutions",
      "tier",
    ]);
  });

  it("ParentPtaAgendaItem = EXACTLY {classification, narrative, order, title}", () => {
    expect(interfaceKeys("ParentPtaAgendaItem")).toEqual([
      "classification",
      "narrative",
      "order",
      "title",
    ]);
  });

  it("ParentPtaActionItem = EXACTLY {description, owner, status} — NO deadline/countdown/SMS", () => {
    expect(interfaceKeys("ParentPtaActionItem")).toEqual(["description", "owner", "status"]);
  });

  it("ParentPtaResolution = EXACTLY {binding, body, resolutionNo, result, title, votesAbstain, votesAgainst, votesFor}", () => {
    expect(interfaceKeys("ParentPtaResolution")).toEqual([
      "binding",
      "body",
      "resolutionNo",
      "result",
      "title",
      "votesAbstain",
      "votesAgainst",
      "votesFor",
    ]);
  });

  it("touches NONE of the DRAFT / staff-lifecycle / deadline columns of the minutes subtree", () => {
    const s = reader();
    for (const col of ["deadline", "secretaryId", "adoptedByUserId", "distributedAt", "completedAt"]) {
      expect(s, `${col} must not appear`).not.toContain(col);
    }
  });

  it("derives PASSED/NOT_PASSED via the REUSED staff helper, not a re-derived vote comparison", () => {
    const s = reader();
    expect(s).toContain("resolutionOutcome");
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

  it("the meeting reader omits agenda / invited teachers / convener (staff PII, R480)", () => {
    // quorumMet is NO LONGER denied here — R478 makes it PUBLIC in the adopted-MINUTES context (55b reads
    // it). The attendance shape still never carries it — guaranteed by the ParentPtaAttendance key-set.
    const s = reader();
    for (const col of ["agendaJson", "invitedTeacherUserIds", "convenedByUserId"]) {
      expect(s, `${col} must not appear`).not.toContain(col);
    }
  });
});

// ── PTA55-D · name derivation stays parent-reachable — no parent_deny table joined (Lucy Q2/Q4) ───────
describe("🔴 PTA55-D · names derive from parent-readable data only", () => {
  it("touches the participation PTA tables + students (for the class label)", () => {
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

  it("reads the 5 parent-scoped 55b tables (officers + minutes subtree) but NEVER config / dues-history", () => {
    const s = reader();
    // 55b WIDENS the reader onto the officer + adopted-minutes subtree (all parent_scoped by Wells).
    for (const t of [
      "ptaOfficer",
      "ptaMinutes",
      "ptaAgendaItem",
      "ptaActionItem",
      "ptaResolution",
    ]) {
      expect(s, `expected ${t}`).toContain(t);
    }
    // Config + dues-history stay parent_deny — never reachable (tier_settings / officer_roles are staff-only).
    for (const t of ["ptaTiersConfig", "ptaDuesConfigHistory"]) {
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

  it("55b · appends Officers + Adopted minutes, gated on membership, with the honest-empty copy", () => {
    const p = readCode(PAGE);
    expect(p).toContain("<Officers officers={pta.officers} />");
    expect(p).toContain("<AdoptedMinutes minutes={pta.minutes} />");
    // Omitted when the parent belongs to no PTA — the Memberships empty already tells that story.
    expect(p).toMatch(/pta\.memberships\.length > 0 &&/);
    expect(p).toContain("PTA officers");
    expect(p).toContain("No PTA officers have been recorded for your PTAs yet.");
    expect(p).toContain("Adopted minutes");
    expect(p).toContain("No adopted PTA minutes yet.");
  });
});

// ── PTA58-A · Item 1 — the House NAME (R483/R484): relabel via parent_house_names, name-only (PP58-1/2/5/7/9)
describe("🔴 PTA58-A · House PTA relabels to the child's House NAME via parent_house_names (R483)", () => {
  it("HOUSE tier resolves the specific House name → '{house} PTA' (PP58-1)", () => {
    const houses = new Map([["h1", "Aggrey"]]);
    expect(ptaNameFor("HOUSE", null, "h1", new Map(), houses)).toBe("Aggrey PTA");
  });

  it("two boarders in two houses → two DISTINCT House names, each resolved (PP58-2)", () => {
    const houses = new Map([
      ["h1", "Aggrey"],
      ["h2", "Guggisberg"],
    ]);
    expect(ptaNameFor("HOUSE", null, "h1", new Map(), houses)).toBe("Aggrey PTA");
    expect(ptaNameFor("HOUSE", null, "h2", new Map(), houses)).toBe("Guggisberg PTA");
  });

  it("a null houseId (PP58-7) or an unresolved houseId / since-CLOSED House PTA (PP58-9) → generic 'House PTA'", () => {
    const houses = new Map([["h1", "Aggrey"]]);
    expect(ptaNameFor("HOUSE", null, null, new Map(), houses)).toBe("House PTA"); // null houseId
    expect(ptaNameFor("HOUSE", null, "gone", new Map(), houses)).toBe("House PTA"); // not in the active map
  });

  it("FORM + GENERAL naming is unchanged by INCR-58 (only HOUSE gained a name path)", () => {
    const classes = new Map([["c1", "Form 2 Science"]]);
    expect(ptaNameFor("FORM", "c1", null, classes, new Map())).toBe("Form 2 Science PTA");
    expect(ptaNameFor("FORM", null, null, new Map(), new Map())).toBe("Class PTA");
    expect(ptaNameFor("GENERAL", null, null, new Map(), new Map())).toBe("General PTA");
  });

  it("the reader calls parent_house_names, selects ptas.houseId, and builds a name-only house map", () => {
    const s = reader();
    expect(s).toContain("parent_house_names");
    expect(s).toMatch(/houseId:\s*ptas\.houseId/);
    expect(s).toMatch(/houseNameById\.set/);
    // the SQL projection is (house_id, house_name) ONLY — no house-PII column crosses the boundary.
    expect(s).toMatch(/house_id,\s*house_name FROM parent_house_names/);
  });

  it("PP58-5 · never reads a house-PII column, and the House-bearing shapes keep their frozen key-sets", () => {
    const s = reader();
    // `house` STAYS parent_deny (PTA55-D already asserts the table is never joined); a mutation that spread
    // a housemaster/colour/capacity/gender field would have to name one of these — none may appear.
    for (const col of ["hmUserId", "colour", "capacity", "foundedYear", "namedAfter"]) {
      expect(s, `${col} must not appear (house PII is never projected)`).not.toContain(col);
    }
    // The name is a plain string on the EXISTING ptaName field — the shapes are byte-frozen (re-affirm 55a).
    expect(interfaceKeys("ParentPtaMembership")).toEqual(["ptaName", "tier"]);
    expect(interfaceKeys("ParentPtaDue")).toEqual(["amountBilled", "periodLabel", "ptaName", "tier"]);
  });
});

// ── PTA58-B · Item 2 — the action-owner office caption (R485): "· {office}", tie-break, fallbacks (PP58-11..17)
describe("🔴 PTA58-B · action-owner office caption — current office in THAT PTA, name-only fallbacks (R485)", () => {
  it("appends the owner's current office in that PTA → '{owner} · {office}' (PP58-11)", () => {
    const byHolder = new Map([["p1::u1", "Treasurer"]]);
    expect(ownerWithOffice("Ama Aidoo", "p1", "u1", byHolder)).toBe("Ama Aidoo · Treasurer");
  });

  it("external owner / no user id → name-only, NO caption (PP58-12)", () => {
    const byHolder = new Map([["p1::u1", "Treasurer"]]);
    expect(ownerWithOffice("External Person", "p1", null, byHolder)).toBe("External Person");
  });

  it("owner holds no current office in that PTA → name-only (PP58-13)", () => {
    const byHolder = new Map([["p1::u1", "Treasurer"]]);
    expect(ownerWithOffice("Kofi", "p1", "u2", byHolder)).toBe("Kofi");
  });

  it("owner's office is in a DIFFERENT PTA → name-only (PP58-14)", () => {
    const byHolder = new Map([["p1::u1", "Treasurer"]]);
    expect(ownerWithOffice("Ama Aidoo", "p2", "u1", byHolder)).toBe("Ama Aidoo");
  });

  it("an ENDED office is never in the current-holder map → name-only (PP58-15)", () => {
    // bestOfficeByHolder is built ONLY from current holders (endedAt IS NULL) — an ended hat can't caption.
    expect(ownerWithOffice("Yaa", "p1", "u9", new Map())).toBe("Yaa");
  });

  it("multi-hat → the HIGHEST office wins (lowest officeRank), order-independent (PP58-16)", () => {
    expect(officeRank("Chair")).toBeLessThan(officeRank("Treasurer"));
    const a = bestOfficeByHolder([
      { ptaId: "p1", personUserId: "u1", office: "Treasurer" },
      { ptaId: "p1", personUserId: "u1", office: "Chair" },
    ]);
    const b = bestOfficeByHolder([
      { ptaId: "p1", personUserId: "u1", office: "Chair" },
      { ptaId: "p1", personUserId: "u1", office: "Treasurer" },
    ]);
    expect(a.get("p1::u1")).toBe("Chair");
    expect(b.get("p1::u1")).toBe("Chair");
    // same person, DIFFERENT PTAs → keyed separately (never bleeds across PTAs)
    const c = bestOfficeByHolder([
      { ptaId: "p1", personUserId: "u1", office: "Secretary" },
      { ptaId: "p2", personUserId: "u1", office: "Treasurer" },
    ]);
    expect(c.get("p1::u1")).toBe("Secretary");
    expect(c.get("p2::u1")).toBe("Treasurer");
    // external holders (no user id) never land in the map
    expect(bestOfficeByHolder([{ ptaId: "p1", personUserId: null, office: "Chair" }]).size).toBe(0);
  });

  it("both ids null → owner stays '—' with NO caption (PP58-17)", () => {
    const byHolder = new Map([["p1::u1", "Treasurer"]]);
    expect(ownerWithOffice("—", "p1", null, byHolder)).toBe("—");
  });

  it("the reader reads personUserId (to caption) but the ActionItem shape stays {description, owner, status}", () => {
    const s = reader();
    expect(s).toContain("ownerWithOffice");
    expect(s).toMatch(/personUserId:\s*ptaActionItem\.personUserId/);
    expect(interfaceKeys("ParentPtaActionItem")).toEqual(["description", "owner", "status"]);
  });
});
