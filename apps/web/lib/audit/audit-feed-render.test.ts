import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuditActivityFeed, type AuditEvent } from "@/components/settings/audit-activity-feed";

/**
 * INCR-30 §01 render tripwires. renderToStaticMarkup runs in node (no jsdom needed) — we assert the
 * SENSITIVE VALUES are absent from the produced HTML and the neutral marker is present. This is the
 * flagship live-leak proof: remove the `sickbay_` prefix check → AC3/AC6 go red; remove the reason
 * suppression → AC2/AC4/AC5 go red.
 */
const render = (e: Partial<AuditEvent>): string => {
  const event: AuditEvent = {
    id: "e1",
    occurredAt: new Date(),
    actorName: "Matron Ama",
    actorRole: "MATRON",
    actionType: "updated",
    entityType: null,
    entityId: "abcd1234",
    reason: null,
    before: null,
    after: null,
    ...e,
  };
  return renderToStaticMarkup(
    createElement(AuditActivityFeed, { events: [event], dayLabel: "Today" }),
  );
};

const MARKER = "Details restricted";

describe("AC1 — redact-set field-diff is absent + marker present", () => {
  it("boarding_infractions before→after diff never renders", () => {
    const html = render({
      entityType: "boarding_infractions",
      before: { status: "OPEN", severity: "NOTE" },
      after: { status: "OPEN", severity: "DEBOARDINIZATION" },
    });
    expect(html).toContain(MARKER);
    expect(html).not.toContain("DEBOARDINIZATION");
    expect(html).not.toContain("NOTE");
  });
});

describe("AC2 — neutral marker replaces the reason, raw reason absent", () => {
  it("a redacted entry's reason never renders in the headline", () => {
    const html = render({
      entityType: "staff_compensation",
      reason: "Salary raised to GHS 4,200 effective January",
    });
    expect(html).toContain(MARKER);
    expect(html).not.toContain("4,200");
    expect(html).not.toContain("Salary raised");
  });
});

describe("AC3 — the LIVE chronic-entry leak: clinical values not in the DOM", () => {
  it("sickbay_chronic_entry condition / careGoals / emergencyProtocol never render", () => {
    const html = render({
      entityType: "sickbay_chronic_entry",
      reason: "Reviewed chronic plan",
      before: {
        condition: "Type-1 diabetes",
        careGoals: "Maintain HbA1c under 7",
        emergencyProtocol: "Glucagon then call parent",
      },
      after: {
        condition: "Type-1 diabetes (brittle)",
        careGoals: "Tighter glucose monitoring q2h",
        emergencyProtocol: "Glucagon, epi-pen, call 999",
      },
    });
    expect(html).toContain(MARKER);
    expect(html).not.toContain("diabetes");
    expect(html).not.toContain("HbA1c");
    expect(html).not.toContain("Glucagon");
    expect(html).not.toContain("Reviewed chronic plan");
  });
});

describe("AC4 — med-admin drug name absent from §01 (in reason AND after)", () => {
  it("sickbay_med_admin drug name renders nowhere in the feed entry", () => {
    const html = render({
      entityType: "sickbay_med_admin",
      reason: "Administered Amoxicillin 500mg",
      after: { drugName: "Amoxicillin", dose: "500mg" },
    });
    expect(html).toContain(MARKER);
    expect(html).not.toContain("Amoxicillin");
    expect(html).not.toContain("500mg");
  });
});

describe("AC5 — infraction narrative reason redacted in §01", () => {
  it("the boarding_infractions reason narrative never renders", () => {
    const html = render({
      entityType: "boarding_infractions",
      reason: "Caught with contraband in dorm, third offence — bond recommended",
    });
    expect(html).toContain(MARKER);
    expect(html).not.toContain("contraband");
    expect(html).not.toContain("third offence");
  });
});

describe("AC6 — fail-safe: a synthetic future sickbay_* entity redacts", () => {
  it("sickbay_future_thing is redacted with no code change", () => {
    const html = render({
      entityType: "sickbay_future_thing",
      reason: "Some future clinical narrative",
      before: { secret: "old-value-xyz" },
      after: { secret: "new-value-abc" },
    });
    expect(html).toContain(MARKER);
    expect(html).not.toContain("old-value-xyz");
    expect(html).not.toContain("new-value-abc");
    expect(html).not.toContain("future clinical narrative");
  });
});

describe("AC7 — NO over-redaction: operational entries render diff + reason unchanged", () => {
  it("a student/class/invoice_batch diff and reason both render", () => {
    for (const entityType of ["student", "class", "invoice_batch", "attendance_record"]) {
      const html = render({
        entityType,
        reason: "Routine correction reason",
        before: { name: "Old Name" },
        after: { name: "New Name" },
      });
      expect(html).not.toContain(MARKER);
      expect(html).toContain("Old Name");
      expect(html).toContain("New Name");
      expect(html).toContain("Routine correction reason");
    }
  });
});

describe("AC8 — keyed on the predicate, not on before-presence", () => {
  it("a redacted `created` event (no before) still suppresses its reason", () => {
    const html = render({
      entityType: "sickbay_chronic_entry",
      actionType: "created",
      before: null,
      after: { condition: "Asthma", emergencyProtocol: "Salbutamol inhaler" },
      reason: "Opened chronic record for asthma",
    });
    expect(html).toContain(MARKER);
    expect(html).not.toContain("Asthma");
    expect(html).not.toContain("Salbutamol");
    expect(html).not.toContain("Opened chronic record");
  });
});
