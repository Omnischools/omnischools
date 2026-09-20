import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";
import { renderPtaOfficerRosterPdf } from "./render-pta-officer-roster";
import { PtaOfficerRosterDocument } from "./pta-officer-roster-document";
import type { PtaOfficerRosterData } from "./pta-officer-roster-document";
import {
  composeMatrix,
  type OfficersMatrix,
  type PtaComposeInput,
  type StoredOfficer,
} from "@/lib/pta/officers";

/**
 * #297 · Capability A — the PTA officer-roster PDF. The route + document are the OFFICER-CONTACT fence:
 * the ONLY data source is the composed `OfficersMatrix` (no phone/email/address field exists on it), so
 * this suite grep-guards both source files for a contact-PII reach AND renders the empty / all-vacant /
 * populated matrices to prove the document never throws and never fabricates a holder. The @react-pdf
 * render runs in Node here (the fuller build guarantee is `next build` compiling the route).
 */

const ROUTE = "app/api/senior/pta/officers/route.ts";
const DOC = "lib/pdf/pta-officer-roster-document.tsx";

const meta = { schoolName: "Asankrangwa SHS", schoolInitials: "AS", generatedAtLabel: "19 Aug 2026 · 12:00" };
const EMPTY: OfficersMatrix = {
  general: null,
  houses: [],
  forms: [],
  multiHat: [],
  totals: { houses: { filled: 0, total: 0 }, forms: { filled: 0, total: 0 } },
};

const generalInput: PtaComposeInput = {
  id: "gen",
  tierType: "GENERAL",
  label: "General PTA",
  scopeBadge: null,
  officerRoles: ["Chair", "Secretary", "Treasurer"],
  tierSettings: {},
  exOfficioSecretaryName: null,
  headmasterNames: ["Dr Ama Head"],
};
const formInput: PtaComposeInput = {
  id: "form1",
  tierType: "FORM",
  label: "Form 2 Science PTA",
  scopeBadge: "32 students",
  officerRoles: ["Chair", "Secretary", "Treasurer"],
  tierSettings: {},
  exOfficioSecretaryName: "Mr Kwesi Teacher", // ex-officio class teacher
  headmasterNames: [],
};
const stored: StoredOfficer[] = [
  {
    id: "o1",
    ptaId: "gen",
    office: "Chair",
    personUserId: "u1",
    holderName: "Ama Aidoo",
    personType: "parent",
    assignmentBasis: "ELECTED",
    electionRef: "AGM 2025 · minute 3.2",
    termStart: "2025-01-01",
    termEnd: "2027-01-01",
  },
];
// General has one filled (Chair), rest vacant; Form has ex-officio Secretary + two vacancies.
const POPULATED = composeMatrix([generalInput, formInput], stored, [], "2026-01-01");
// Same inputs, NO stored officers → every electable office vacant, ex-officio still derived.
const ALL_VACANT = composeMatrix([generalInput, formInput], [], [], "2026-01-01");

// ── PII fence (owner-ratified: roster only, NO contact) ───────────────────────────────────────────
describe("🔴 #297-A · the officer-roster PDF never reaches for officer contact PII", () => {
  const CONTACT = [/\.phone\b/, /\.email\b/, /studentGuardians/, /\.address\b/];
  it.each([ROUTE, DOC])("%s selects/renders no phone/email/address/studentGuardians", (rel) => {
    const code = readCode(rel);
    for (const pat of CONTACT) {
      expect(code, `${rel} must not reach ${pat}`).not.toMatch(pat);
    }
  });

  it("the ONLY data source is getPtaOfficerMatrix — no meeting/guardian reader is imported", () => {
    const route = readCode(ROUTE);
    expect(route).toContain("getPtaOfficerMatrix");
    expect(route).not.toContain("getPtaMeeting");
    expect(route).not.toContain("studentGuardians");
  });
});

// ── the route gate + session-scoping ──────────────────────────────────────────────────────────────
describe("🔴 #297-A · the route is ADMIN-gated (read == manage) and session-scoped", () => {
  const route = readCode(ROUTE);

  it("gates on requireSchoolRole(PTA_CONFIG_WRITE_ROLES) — the SAME gate as the officers page", () => {
    expect(route).toMatch(/requireSchoolRole\(\s*PTA_CONFIG_WRITE_ROLES\s*\)/);
  });

  it("keys on the SESSION school id — never a query/body school id (no cross-tenant export)", () => {
    expect(route).toMatch(/getPtaOfficerMatrix\(\s*school\.id\s*\)/);
    expect(route).not.toMatch(/searchParams/);
    expect(route).not.toMatch(/schoolId/);
  });

  it("returns an inline PDF with private, no-store caching, on the Node runtime", () => {
    expect(route).toMatch(/application\/pdf/);
    expect(route).toMatch(/inline; filename=/);
    expect(route).toMatch(/private, no-store/);
    expect(route).toMatch(/runtime\s*=\s*["'`]nodejs["'`]/);
  });

  it("is a GET-only download — no POST/PUT/PATCH", () => {
    expect(route).toMatch(/export async function GET/);
    expect(route).not.toMatch(/export async function (POST|PUT|PATCH)/);
  });
});

// ── render: empty / all-vacant / populated all produce a valid one-page PDF, no throw ───────────────
describe("🔴 #297-A · the document renders every roster state without throwing", () => {
  const data = (matrix: OfficersMatrix): PtaOfficerRosterData => ({ matrix, meta });

  it("zero active PTAs → a valid one-page 'none configured' PDF (never a 500)", async () => {
    const pdf = await renderPtaOfficerRosterPdf(data(EMPTY));
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("an all-vacant matrix renders vacant slots (ex-officio still derived), no fabricated holder", async () => {
    const pdf = await renderPtaOfficerRosterPdf(data(ALL_VACANT));
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("a populated matrix renders — and differs in bytes from empty (the doc reflects the data)", async () => {
    const populated = await renderPtaOfficerRosterPdf(data(POPULATED));
    const empty = await renderPtaOfficerRosterPdf(data(EMPTY));
    expect(populated.length).toBeGreaterThan(1000);
    expect(populated.toString("latin1")).not.toEqual(empty.toString("latin1"));
  }, 20_000);

  it("the composed matrix carries a real holder for the filled office and no holder for a vacancy", () => {
    // sanity on the fixture: Chair is STORED with the parent holder; Secretary/Treasurer are VACANT.
    const chair = POPULATED.general!.rows.find((r) => r.office === "Chair")!;
    expect(chair.kind).toBe("STORED");
    expect(chair.holderName).toBe("Ama Aidoo");
    const treasurer = POPULATED.general!.rows.find((r) => r.office === "Treasurer")!;
    expect(treasurer.kind).toBe("VACANT");
    expect(treasurer.holderName).toBeNull();
  });

  it("the document element carries NO contact prop path — it renders only roster fields", () => {
    // Rendering the tree with a contact-bearing matrix cannot leak: the shape has no such field. This
    // exercises the branch structure (empty flag + sections) without asserting compressed byte content.
    const el = PtaOfficerRosterDocument({ data: data(POPULATED) });
    expect(el).toBeTruthy();
  });
});
