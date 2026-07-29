import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isRedactedAuditEntity,
  REDACTED_AUDIT_ENTITIES,
  REDACTED_MARKER,
  REDACTED_REASON,
} from "./redaction";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const FEED = read("../../components/settings/audit-activity-feed.tsx");
const PAGE = read("../../app/(app)/settings/audit/page.tsx");
const DISCIPLINE = read("../../lib/boarding/discipline-core.ts");
const BOARD_DISC = read("../../lib/actions/boarding-discipline.ts");
const BOARDING = read("../../lib/actions/boarding.ts");

describe("INCR-30 predicate — the one source of truth", () => {
  it("redacts every enumerated non-namespaced entity (pay / health-id / discipline triad)", () => {
    for (const e of REDACTED_AUDIT_ENTITIES) expect(isRedactedAuditEntity(e)).toBe(true);
    // AC5 input: the disciplinary narrative rides boarding_infractions
    expect(isRedactedAuditEntity("boarding_infractions")).toBe(true);
    // AC4 input: the med-admin drug name rides sickbay_med_admin (prefix)
    expect(isRedactedAuditEntity("sickbay_med_admin")).toBe(true);
    // AC3 input: the live chronic-entry leak
    expect(isRedactedAuditEntity("sickbay_chronic_entry")).toBe(true);
  });

  it("AC6 fail-safe — a synthetic future sickbay_* entity redacts with NO code change", () => {
    expect(isRedactedAuditEntity("sickbay_future_thing")).toBe(true);
    expect(isRedactedAuditEntity("sickbay_")).toBe(true);
  });

  it("AC7 no over-redaction — operational entities are NOT redacted", () => {
    for (const e of [
      "student",
      "class",
      "school",
      "academic_period",
      "invoice_batch",
      "attendance_record",
    ]) {
      expect(isRedactedAuditEntity(e)).toBe(false);
    }
  });

  it("academic per-student MARKS are redacted (owner-confirmed audience correction); assessment/column CONFIG is not", () => {
    // readiness_statement's `after` carries a projected aggregate+band (mark-adjacent) — redacted with the marks (Sarah).
    for (const e of ["senior_score_ledger", "mock_result", "mock_result_moderation", "readiness_statement"]) {
      expect(isRedactedAuditEntity(e), `${e} carries a per-student mark/band → redact`).toBe(true);
    }
    // The definition/config siblings carry no student mark (title/maxMark/column name) → stay shown.
    for (const e of ["senior_assessment", "gradebook_column", "mock_exam"]) {
      expect(isRedactedAuditEntity(e), `${e} is config, not a per-student mark → shown`).toBe(false);
    }
  });

  it("null / undefined / empty entity types are never redacted", () => {
    expect(isRedactedAuditEntity(null)).toBe(false);
    expect(isRedactedAuditEntity(undefined)).toBe(false);
    expect(isRedactedAuditEntity("")).toBe(false);
  });

  it("AC8 — the predicate keys on entityType alone (no before/after arg → not before-presence)", () => {
    // A `created` redacted event (before absent) still classifies as redacted purely from its type.
    expect(isRedactedAuditEntity.length).toBe(1);
    expect(isRedactedAuditEntity("sickbay_chronic_entry")).toBe(true);
  });
});

describe("INCR-30 AC9 — ONE shared predicate imported by BOTH render sites", () => {
  it("§01 (component) and §02 (page) both import isRedactedAuditEntity from the predicate module", () => {
    for (const src of [FEED, PAGE]) {
      expect(src).toMatch(/from "@\/lib\/audit\/redaction"/);
      expect(src).toContain("isRedactedAuditEntity");
    }
  });

  it("neither render site re-declares its own redact set (no drift)", () => {
    // The literal Set of entities lives ONLY in the predicate module.
    expect(FEED).not.toContain("student_nhis_card");
    expect(PAGE).not.toContain("student_nhis_card");
  });
});

describe("INCR-30 §02 (full-log table) — the reason cell is guarded", () => {
  it("page.tsx renders REDACTED_REASON for a redacted row instead of the raw reason", () => {
    expect(PAGE).toContain("isRedactedAuditEntity(r.entityType)");
    expect(PAGE).toContain("REDACTED_REASON");
    expect(REDACTED_REASON).toBe("Details restricted");
  });
});

describe("INCR-30 R240 — pastoral-bypass reason neutralized at the write site", () => {
  it("the confidential pastoral reason is gone and replaced by a neutral string", () => {
    expect(DISCIPLINE).not.toContain("Pastoral case active");
    expect(DISCIPLINE).toContain("Discipline routing — details restricted");
  });

  it("the fact still lands in `after` (severity + routedTo) — routing behaviour unchanged", () => {
    expect(DISCIPLINE).toContain("routedTo: \"Dean of Students · VLC pastoral\"");
    expect(DISCIPLINE).toMatch(/after: \{ severity, sourceKind, routedTo/);
  });
});

describe("INCR-30 R245 — reason-channel siblings under entityType:\"student\"", () => {
  it("AC10 — REINSTATED neutralizes the free-text Board narrative (kept on the redacted deboardinization_records)", () => {
    expect(BOARD_DISC).not.toContain("reason: boardDecisionText.slice");
    expect(BOARD_DISC).toContain("Reinstated to boarding by Board decision — details restricted");
  });

  it("AC10 — BUNK_REASSIGNED neutralizes the free-text operator reason (kept on the BOARDING_ROLES-gated bunk_allocation.reason)", () => {
    expect(BOARDING).toContain('reason: "Bunk reassigned"');
  });

  it("AC11 — DEBOARDINIZED is LEFT operational (not over-redacted): student is not a redacted entity, and the residency flip + fixed reason stay", () => {
    expect(isRedactedAuditEntity("student")).toBe(false);
    expect(BOARD_DISC).toContain("Deboardinization effected"); // the fixed detail-free reason stays
    expect(BOARD_DISC).toContain('residency: "DEBOARDINIZED"'); // the operational flip staff need stays
  });
});

describe("INCR-30 markers", () => {
  it("the §01 marker discloses nothing about the record class", () => {
    expect(REDACTED_MARKER).toBe("Details restricted — sensitive record.");
    expect(REDACTED_MARKER.toLowerCase()).not.toContain("clinical");
    expect(REDACTED_MARKER.toLowerCase()).not.toContain("health");
  });
});
