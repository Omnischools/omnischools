/**
 * PTA officer-matrix compose (SHS module 4.7 / INCR-51) — PURE, DB-free, unit-tested
 * (officers.test.ts). The lib/plc/points.ts analogue for the officer matrix: `officers-data.ts`
 * loads the tenant-scoped rows and calls these functions; nothing here touches the DB, so the
 * ex-officio derivation and matrix-compose rules are testable without a database.
 *
 * The rules it encodes (Kofi R424/R425):
 *   • Ex-officio holders are DERIVED, NEVER stored: General → the Headmaster (an APPENDED member,
 *     not an elected slot); Form/House Secretary (the `ex_officio_office`, coalesce "Secretary") is
 *     the class teacher / housemaster and OCCUPIES its officer_roles slot (not electable).
 *   • Per office → ex-officio holder ∥ current stored row ∥ VACANT. NEVER fabricate a holder — a PTA
 *     with 0 stored officers shows an honest all-vacant matrix (the ex-officio slot still derives).
 *   • Completion denominator = officer_roles.length × active instances; an ex-officio-OCCUPIED office
 *     counts as FILLED when its derived holder exists (the D1 fix — "N offices, M filled").
 *   • Multi-hat = a person holding ≥2 current stored offices (the "+N other PTA roles" tag).
 *   • The <30d term-ending warning and the previous-holder text are derived here too.
 */
import { type PtaTierType } from "./defaults";

/** The ex-officio / term keys the spine seeds as `{}` — coalesced to these frozen defaults (R424). */
export const EX_OFFICIO_DEFAULTS = {
  headmasterRole: "HEADMASTER",
  exOfficioOffice: "Secretary",
  officerTermYears: 2,
} as const;

export interface ExOfficioConfig {
  headmasterRole: string;
  exOfficioOffice: string;
  officerTermYears: number;
}

/** Coalesce the three ex-officio/term keys off an opaque tier_settings bag (spine seeds it `{}`). */
export function coalesceExOfficio(tierSettings: Record<string, string> | null | undefined): ExOfficioConfig {
  const s = tierSettings ?? {};
  const years = Number.parseInt(s.officer_term_years ?? "", 10);
  return {
    headmasterRole: s.headmaster_role?.trim() || EX_OFFICIO_DEFAULTS.headmasterRole,
    exOfficioOffice: s.ex_officio_office?.trim() || EX_OFFICIO_DEFAULTS.exOfficioOffice,
    officerTermYears: Number.isFinite(years) && years > 0 ? years : EX_OFFICIO_DEFAULTS.officerTermYears,
  };
}

/**
 * The office name that is EX-OFFICIO-OCCUPIED (not electable) for this tier — the `ex_officio_office`
 * for FORM/HOUSE (the class teacher / housemaster Secretary), and NONE for GENERAL (its ex-officio is
 * the appended Headmaster, so its "Secretary" stays electable) or EMERGENCY (no officers, R414).
 */
export function exOfficioSlotOffice(
  tierType: PtaTierType,
  tierSettings: Record<string, string> | null | undefined,
): string | null {
  if (tierType === "FORM" || tierType === "HOUSE") return coalesceExOfficio(tierSettings).exOfficioOffice;
  return null;
}

// ── Inputs (already tenant-scoped + name-resolved by officers-data.ts) ──────────────────────────

export type PersonType = "parent" | "staff" | "external";

export interface StoredOfficer {
  id: string;
  ptaId: string;
  office: string;
  personUserId: string | null;
  holderName: string; // resolved user full name OR external_name
  personType: PersonType;
  assignmentBasis: "ELECTED" | "APPOINTED";
  electionRef: string;
  termStart: string; // ISO yyyy-mm-dd
  termEnd: string | null; // ISO yyyy-mm-dd (null = holdover, R422)
}

export interface EndedOfficer {
  ptaId: string;
  office: string;
  holderName: string;
  endedAt: string; // ISO date
  endReason: string | null;
}

export interface PtaComposeInput {
  id: string;
  tierType: PtaTierType;
  label: string; // "Form 2 GA A PTA" (derived from the class/House join)
  scopeBadge: string | null; // "BOYS · 245" / "32 students" — display only
  officerRoles: string[];
  tierSettings: Record<string, string>;
  /** FORM: the class teacher's name; HOUSE: the housemaster's name; null when the slot is unfilled. */
  exOfficioSecretaryName: string | null;
  /** GENERAL only: the holder(s) of the coalesced `headmaster_role` (appended, read-only). */
  headmasterNames: string[];
}

// ── Outputs (plain primitives the client renders) ───────────────────────────────────────────────

export type OfficeRowKind = "STORED" | "EX_OFFICIO" | "EX_OFFICIO_VACANT" | "VACANT" | "APPENDED_EX";

export interface OfficeRow {
  office: string;
  kind: OfficeRowKind;
  /** stored `pta_officer.id` — present ONLY for a STORED row (drives Edit / End). */
  officerId: string | null;
  holderName: string | null;
  personType: PersonType | null;
  assignmentBasis: "ELECTED" | "APPOINTED" | null;
  basisLabel: string | null; // "Elected" / "Appointed"
  termLabel: string | null; // "14 Oct 2025 → 12 Oct 2027" / "Auto — while in post"
  termStartISO: string | null; // raw yyyy-mm-dd (STORED only — the Edit dialog reads it back)
  termEndISO: string | null;
  electionRef: string | null;
  termEndingSoon: boolean; // <30d (R422)
  /** "+N other PTA roles" — N other current stored offices this person holds (0 ⇒ null). */
  otherHatCount: number;
  /** VACANT electable offices only: the most-recent ended holder + when. */
  previousHolder: string | null;
  vacantSince: string | null;
  vacantReason: string | null;
  assignable: boolean; // false for every ex-officio / appended row (derived, read-only)
}

export interface PtaCard {
  id: string;
  tierType: PtaTierType;
  label: string;
  scopeBadge: string | null;
  rows: OfficeRow[];
  filled: number; // offices in officer_roles with a holder (ex-officio-occupied counts when derived)
  total: number; // officer_roles.length
  /** electable offices (officer_roles minus the ex-officio slot) — the assign drawer's office picker. */
  assignableOffices: string[];
}

export interface MultiHatPerson {
  userId: string;
  name: string;
  personType: PersonType;
  hats: { label: string; office: string }[]; // one per current stored office
}

export interface OfficersMatrix {
  general: PtaCard | null;
  houses: PtaCard[];
  forms: PtaCard[];
  multiHat: MultiHatPerson[];
  totals: {
    houses: { filled: number; total: number };
    forms: { filled: number; total: number };
  };
}

// ── Derivation helpers ──────────────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2025-10-14" → "14 Oct 2025". Pure — no locale/tz surprises (Ghana is UTC+0). */
export function fmtISODate(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? "?"} ${m[1]}`;
}

/** Whole days from `today` to `iso` (negative = already past). Both ISO yyyy-mm-dd. */
function daysUntil(iso: string, today: string): number {
  const a = Date.parse(`${iso}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.round((a - b) / 86_400_000);
}

const basisLabel = (b: "ELECTED" | "APPOINTED") => (b === "ELECTED" ? "Elected" : "Appointed");

// ── Assign-time validators (PURE — the action wires them after loading the tier config, R420/R424) ──

/**
 * Why the office is NOT assignable, or null when it is. `office` must be one of the tier's
 * `officer_roles` (R420, drift-tolerant — validated at WRITE only), and MUST NOT be the ex-officio
 * slot (R424 — the Form/House Secretary is derived from the class teacher / housemaster, never stored).
 */
export function assignmentOfficeError(args: {
  office: string;
  officerRoles: string[];
  exOfficioSlot: string | null;
}): string | null {
  if (!args.officerRoles.includes(args.office)) return "That office isn't one of this PTA's roles.";
  if (args.exOfficioSlot && args.office === args.exOfficioSlot) {
    return "The Secretary is filled ex-officio (the Form Master / Housemaster) — it can't be assigned.";
  }
  return null;
}

/** Exactly-one holder (R419): a `person_user_id` XOR a non-empty `external_name`. Null when valid. */
export function holderError(
  personUserId: string | null | undefined,
  externalName: string | null | undefined,
): string | null {
  const hasUser = !!personUserId;
  const hasExternal = !!externalName && externalName.trim() !== "";
  if (hasUser === hasExternal) return "Pick exactly one holder — a person or an external name.";
  return null;
}

/** "2026-05-15" + 2 years → "2028-05-15" (ELECTED term auto-calc, R422). Pure, UTC-safe. */
export function addYearsISO(iso: string, years: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const y = String(Number(m[1]) + years).padStart(4, "0");
  return `${y}-${m[2]}-${m[3]}`;
}

// ── The compose entry point ─────────────────────────────────────────────────────────────────────

/**
 * Compose the whole matrix from the tenant-scoped rows. `today` is injected (ISO) for a deterministic
 * <30d term-ending derivation. Stored/ended rows may span every PTA; they are bucketed by pta_id here.
 */
export function composeMatrix(
  ptas: PtaComposeInput[],
  stored: StoredOfficer[],
  ended: EndedOfficer[],
  today: string,
): OfficersMatrix {
  // multi-hat: current stored offices per person (used for the "+N other roles" tag + the spotlight).
  const byPerson = new Map<string, StoredOfficer[]>();
  for (const s of stored) {
    if (!s.personUserId) continue; // external holders never multi-hat (no stable identity)
    const list = byPerson.get(s.personUserId) ?? [];
    list.push(s);
    byPerson.set(s.personUserId, list);
  }
  const labelOf = new Map(ptas.map((p) => [p.id, p.label]));

  const cards = ptas.map((p) => composeCard(p, stored, ended, byPerson, today));
  const cardById = new Map(cards.map((c) => [c.id, c]));

  const general = cards.find((c) => c.tierType === "GENERAL") ?? null;
  const houses = cards.filter((c) => c.tierType === "HOUSE");
  const forms = cards.filter((c) => c.tierType === "FORM");

  const sum = (cs: PtaCard[]) => ({
    filled: cs.reduce((n, c) => n + c.filled, 0),
    total: cs.reduce((n, c) => n + c.total, 0),
  });

  // The multi-hat spotlight — only people with ≥2 current stored offices (omit-card-when-empty, D-copy).
  const multiHat: MultiHatPerson[] = [];
  for (const [userId, list] of byPerson) {
    if (list.length < 2) continue;
    multiHat.push({
      userId,
      name: list[0].holderName,
      personType: list[0].personType,
      hats: list.map((s) => ({ office: s.office, label: `${labelOf.get(s.ptaId) ?? "PTA"} · ${s.office}` })),
    });
  }
  multiHat.sort((a, b) => b.hats.length - a.hats.length);

  // stable order: General handled separately; Houses/Forms alphabetical by label.
  houses.sort((a, b) => a.label.localeCompare(b.label));
  forms.sort((a, b) => a.label.localeCompare(b.label));

  void cardById;
  return { general, houses, forms, multiHat, totals: { houses: sum(houses), forms: sum(forms) } };
}

function composeCard(
  p: PtaComposeInput,
  allStored: StoredOfficer[],
  allEnded: EndedOfficer[],
  byPerson: Map<string, StoredOfficer[]>,
  today: string,
): PtaCard {
  const exSlot = exOfficioSlotOffice(p.tierType, p.tierSettings);
  const storedHere = allStored.filter((s) => s.ptaId === p.id);
  const storedByOffice = new Map(storedHere.map((s) => [s.office, s]));

  // most-recent ended row per office (for the previous-holder text on a vacancy).
  const endedByOffice = new Map<string, EndedOfficer>();
  for (const e of allEnded.filter((e) => e.ptaId === p.id)) {
    const cur = endedByOffice.get(e.office);
    if (!cur || e.endedAt > cur.endedAt) endedByOffice.set(e.office, e);
  }

  const otherHats = (s: StoredOfficer) =>
    s.personUserId ? Math.max(0, (byPerson.get(s.personUserId)?.length ?? 1) - 1) : 0;

  const storedRow = (s: StoredOfficer): OfficeRow => ({
    office: s.office,
    kind: "STORED",
    officerId: s.id,
    holderName: s.holderName,
    personType: s.personType,
    assignmentBasis: s.assignmentBasis,
    basisLabel: basisLabel(s.assignmentBasis),
    termLabel:
      s.termEnd != null
        ? `${fmtISODate(s.termStart)} → ${fmtISODate(s.termEnd)}`
        : `${fmtISODate(s.termStart)} → holdover`,
    termStartISO: s.termStart,
    termEndISO: s.termEnd,
    electionRef: s.electionRef,
    termEndingSoon: s.termEnd != null && daysUntil(s.termEnd, today) < 30,
    otherHatCount: otherHats(s),
    previousHolder: null,
    vacantSince: null,
    vacantReason: null,
    assignable: false, // held ⇒ Edit/End, never Assign
  });

  const vacantRow = (office: string): OfficeRow => {
    const prev = endedByOffice.get(office);
    return {
      office,
      kind: "VACANT",
      officerId: null,
      holderName: null,
      personType: null,
      assignmentBasis: null,
      basisLabel: null,
      termLabel: null,
      termStartISO: null,
      termEndISO: null,
      electionRef: null,
      termEndingSoon: false,
      otherHatCount: 0,
      previousHolder: prev ? prev.holderName : null,
      vacantSince: prev ? fmtISODate(prev.endedAt) : null,
      vacantReason: prev?.endReason ?? null,
      assignable: true,
    };
  };

  const exOfficioRow = (office: string, holderName: string | null): OfficeRow => ({
    office,
    kind: holderName ? "EX_OFFICIO" : "EX_OFFICIO_VACANT",
    officerId: null,
    holderName,
    personType: holderName ? "staff" : null,
    assignmentBasis: null,
    basisLabel: null,
    termLabel: holderName ? "Auto — while in post" : null,
    termStartISO: null,
    termEndISO: null,
    electionRef: null,
    termEndingSoon: false,
    otherHatCount: 0,
    previousHolder: null,
    vacantSince: null,
    vacantReason: null,
    assignable: false, // ex-officio is DERIVED, never assignable (R424/R425)
  });

  const rows: OfficeRow[] = [];
  for (const office of p.officerRoles) {
    if (exSlot && office === exSlot) rows.push(exOfficioRow(office, p.exOfficioSecretaryName));
    else {
      const s = storedByOffice.get(office);
      rows.push(s ? storedRow(s) : vacantRow(office));
    }
  }

  // General appends the Headmaster ex-officio (NOT an officer_roles slot; excluded from completion).
  if (p.tierType === "GENERAL") {
    if (p.headmasterNames.length === 0) rows.push({ ...exOfficioRow("Headmaster", null), kind: "APPENDED_EX" });
    else for (const name of p.headmasterNames) rows.push({ ...exOfficioRow("Headmaster", name), kind: "APPENDED_EX" });
  }

  // completion — over officer_roles only; an ex-officio-occupied office counts as filled when derived.
  const filled = rows.filter(
    (r) => p.officerRoles.includes(r.office) && (r.kind === "STORED" || r.kind === "EX_OFFICIO"),
  ).length;

  const assignableOffices = p.officerRoles.filter((o) => !(exSlot && o === exSlot));

  return {
    id: p.id,
    tierType: p.tierType,
    label: p.label,
    scopeBadge: p.scopeBadge,
    rows,
    filled,
    total: p.officerRoles.length,
    assignableOffices,
  };
}
