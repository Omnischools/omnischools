/**
 * PURE view-model types shared by the server loader (`mock-data.ts`, imports the db driver) and the
 * CLIENT mark-entry grid. Kept db-free so the client component can import the row/column shapes
 * WITHOUT pulling the server-only loader (repo memory `reports-data-is-server-only` — only `pnpm build`
 * catches that leak). No runtime, no db import.
 */
import type { WassceGrade, Trajectory } from "./mock-grades";

export type MockColumn = {
  id: string;
  label: string; // "Mock 1", "Mock 2 (Predictor)"
  mockNumber: number;
  isPredictor: boolean;
  /** Marking closed → this column renders read-only (marking_complete_at set — R3b / C.1). */
  locked: boolean;
};

export type MockCell = {
  grade: WassceGrade;
  moderatedGrade: WassceGrade | null;
  effective: WassceGrade;
  rawLabel: string | null; // "96 / 100" or null
};

export type MockCandidateRow = {
  id: string;
  rank: number;
  name: string; // "E. Mensah"
  studentCode: string;
  indexNumber: string;
  house: string | null; // binding gap — INCR-15 synthetic candidates carry no boarding House (em-dash)
  cells: Record<string, MockCell>; // keyed by mock column id
  trajectory: Trajectory;
  predicted: WassceGrade | null; // = effective grade of the predictor mock (R2/AC7)
  teacherNote: string | null;
  isFocus: boolean;
  medFlag: boolean; // reg_flag ON_MEDICAL (cross-ref INCR-15)
};

export type BenchRow = {
  label: string;
  source: string;
  quality: "STRONG" | "MODERATE" | "DIRECTIONAL";
  value: number; // percent
  caveatPp: number | null; // ± percentage points (directional)
};

export type BenchCell = {
  title: string;
  rows: BenchRow[];
};
