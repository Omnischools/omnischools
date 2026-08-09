import type { SenCategory } from "@/lib/reports/census/sen-data";

/**
 * GOV-10 · SEN category / severity display vocabulary — client-safe (type-only import of `SenCategory`, so
 * no server-only runtime is pulled into a client bundle). Solid pills, NEVER a raw-hex className (the
 * no-alpha-token / INCR-23a rule): Intellectual uses the NAMED `--sen-intellectual` token, distinct from the
 * chronic-condition purples.
 */

export const SEN_CATEGORY_ORDER: readonly SenCategory[] = [
  "VISUAL",
  "HEARING",
  "PHYSICAL",
  "INTELLECTUAL",
  "SPEECH",
  "OTHER",
];

export const SEN_CATEGORY_LABEL: Record<SenCategory, string> = {
  VISUAL: "Visual",
  HEARING: "Hearing",
  PHYSICAL: "Physical",
  INTELLECTUAL: "Intellectual",
  SPEECH: "Speech",
  OTHER: "Other",
};

export const SEN_CATEGORY_PILL: Record<SenCategory, string> = {
  VISUAL: "bg-gold-bg text-gold",
  HEARING: "bg-green-bg text-green",
  PHYSICAL: "bg-terra-bg text-terra",
  INTELLECTUAL: "bg-sen-intellectual-bg text-sen-intellectual",
  SPEECH: "bg-warn-bg text-warn",
  OTHER: "border border-border bg-bg text-navy-3",
};

export type SenSeverityKey = "MILD" | "MODERATE" | "SEVERE";
export const SEN_SEVERITY_LABEL: Record<SenSeverityKey, string> = {
  MILD: "Mild",
  MODERATE: "Moderate",
  SEVERE: "Severe",
};
export const SEN_SEVERITY_PILL: Record<SenSeverityKey, string> = {
  MILD: "bg-green-bg text-green",
  MODERATE: "bg-warn-bg text-warn",
  SEVERE: "bg-terra-bg text-terra",
};

/** Surface vocabulary: a boy / a girl (never "male / female" in the roster). */
export function sexNoun(sex: string): string {
  return sex === "MALE" ? "boy" : sex === "FEMALE" ? "girl" : "—";
}
