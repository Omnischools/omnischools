/**
 * Staff qualification levels — a coarse ladder used for the staff list's "average
 * qualification" card, sorting, and the import. `rank` is the ordinal (higher = more
 * advanced) used to average across staff. Pure + client-safe.
 */
export const QUALIFICATION_LEVELS = [
  { code: "DOCTORATE", label: "Doctorate (PhD/EdD)", rank: 7 },
  { code: "MASTERS", label: "Master's (MEd/MSc/MA/MBA)", rank: 6 },
  { code: "BACHELORS", label: "Bachelor's (BEd/BSc/BA/BCom)", rank: 5 },
  { code: "HND", label: "HND", rank: 4 },
  { code: "DIPLOMA", label: "Diploma", rank: 3 },
  { code: "CERTIFICATE", label: "Certificate (Cert A)", rank: 2 },
  { code: "SHS", label: "SHS / WASSCE", rank: 1 },
  { code: "OTHER", label: "Other", rank: 0 },
] as const;

export type QualificationCode = (typeof QUALIFICATION_LEVELS)[number]["code"];

const BY_CODE = new Map<string, (typeof QUALIFICATION_LEVELS)[number]>(
  QUALIFICATION_LEVELS.map((q) => [q.code, q]),
);
const BY_KEY = new Map<string, (typeof QUALIFICATION_LEVELS)[number]>();
for (const q of QUALIFICATION_LEVELS) {
  BY_KEY.set(q.code.toLowerCase(), q);
  BY_KEY.set(q.label.toLowerCase(), q);
}
// Common spellings that map onto a level (for the importer).
for (const [alias, code] of [
  ["phd", "DOCTORATE"],
  ["doctorate", "DOCTORATE"],
  ["masters", "MASTERS"],
  ["master's", "MASTERS"],
  ["med", "MASTERS"],
  ["msc", "MASTERS"],
  ["ma", "MASTERS"],
  ["mba", "MASTERS"],
  ["mphil", "MASTERS"],
  ["bachelors", "BACHELORS"],
  ["bachelor's", "BACHELORS"],
  ["degree", "BACHELORS"],
  ["bed", "BACHELORS"],
  ["bsc", "BACHELORS"],
  ["ba", "BACHELORS"],
  ["bcom", "BACHELORS"],
  ["hnd", "HND"],
  ["diploma", "DIPLOMA"],
  ["certificate", "CERTIFICATE"],
  ["cert", "CERTIFICATE"],
  ["cert a", "CERTIFICATE"],
  ["shs", "SHS"],
  ["wassce", "SHS"],
  ["sshs", "SHS"],
] as const) {
  const q = BY_CODE.get(code);
  if (q) BY_KEY.set(alias, q);
}

export const qualificationLabel = (code: string | null | undefined): string =>
  (code && BY_CODE.get(code)?.label) || "—";

export const qualificationRank = (code: string | null | undefined): number | null => {
  if (!code) return null;
  const q = BY_CODE.get(code);
  return q ? q.rank : null;
};

/** Resolve free import text ("B.Ed.", "Masters", "HND") to a level code, or null. */
export function resolveQualification(input: string | null | undefined): string | null {
  if (!input) return null;
  const key = input.trim().toLowerCase();
  if (!key) return null;
  return BY_KEY.get(key)?.code ?? null;
}

/** Given a set of staff level codes, the nearest level label to the mean rank. */
export function averageQualificationLabel(codes: (string | null | undefined)[]): {
  label: string;
  captured: number;
} {
  const ranks = codes.map(qualificationRank).filter((r): r is number => r !== null);
  if (ranks.length === 0) return { label: "—", captured: 0 };
  const mean = ranks.reduce((s, r) => s + r, 0) / ranks.length;
  // Nearest defined level to the mean rank.
  let best: (typeof QUALIFICATION_LEVELS)[number] = QUALIFICATION_LEVELS[0];
  let bestDist = Infinity;
  for (const q of QUALIFICATION_LEVELS) {
    const d = Math.abs(q.rank - mean);
    if (d < bestDist) {
      bestDist = d;
      best = q;
    }
  }
  return { label: best.label, captured: ranks.length };
}
