import type { WassceGrade } from "./mock-grades";
import type { WassceSubjectType, ProjectionReason } from "./projection";

/**
 * PURE view-model types for the WASSCE readiness surface (SHS module 4.3 / INCR-17). Shared by the
 * server-only loader (`readiness-data.ts`, imports the db driver) and the CLIENT write panels. Kept
 * db-free so a client component can import these shapes WITHOUT pulling the server loader (repo memory
 * `reports-data-is-server-only` — only `pnpm build` catches that leak). No runtime, no db import.
 */

/** One row of the §5 aggregate-construction visualizer — a counted or a dropped (greyed) subject. */
export type ProjectionRowView = {
  name: string;
  type: WassceSubjectType;
  grade: WassceGrade;
  projected: boolean; // grade held from Mock 2 through an open SC on a counted subject → "(projected)"
  pointsLabel: string; // "1 pt" / "3 pts"
  counted: boolean;
  statusLabel: string; // "Counted" | "Dropped — 4th core" | "Dropped — lowest"
};

/** The whole §5 + §1 trajectory projection view. */
export type ProjectionView =
  | {
      computable: true;
      aggregate: number;
      band: string;
      cores: ProjectionRowView[];
      electives: ProjectionRowView[];
      mock1Aggregate: number | null;
      mock1BandLabel: string | null;
      mock2Aggregate: number;
      mock2BandLabel: string;
      projectedBandLabel: string;
      deltaLabel: string | null; // "↑ 4 places" | "→ holding" | null
      holding: boolean; // an open SC covers a counted subject → medical-hold narration
    }
  | { computable: false; reason: ProjectionReason };

/** One §3 subject-trajectory card: Mock 1 → Mock 2 → projected. */
export type SubjectTrajectoryView = {
  name: string;
  type: WassceSubjectType;
  typeLabel: string; // "Core" | "Elective" | "Elective · dropped"
  mock1: WassceGrade | null;
  mock2: WassceGrade | null;
  finalGrade: WassceGrade | null; // = effective Mock-2 grade (the projected WASSCE grade)
  dropped: boolean; // out of the best-3 for its pool
};

/** A filed special-consideration form (the §1 banner / §7 xmod / SC panel). */
export type ScFormView = {
  scForm: "SC-3" | "SC-7" | "SC-12";
  scopeLabel: string; // "exam-day medical" etc.
  status: string;
  statusLabel: string; // title-cased
  waecRef: string | null;
  filedAtLabel: string | null;
  makeUpCentre: string | null;
  notes: string | null;
  open: boolean; // status not COMPLETED/REJECTED
};

/** The generated readiness statement + parent-ack state (§7). */
export type StatementView = {
  id: string;
  generatedAtLabel: string;
  projectedAggregate: number | null;
  projectedBand: string | null;
  parentAcknowledged: boolean;
  parentAckTitle: string | null; // "Parent acknowledged Mock 2 readiness statement on 28 Mar 2026"
  parentAckMeta: string | null; // "A. Aidoo · in-person signature · expressed concern about …"
  pdfHref: string; // /api/senior/readiness-statement/{id}
};

/** Everything the candidate readiness page renders (pre-formatted; the page passes slices to clients). */
export type CandidateReadinessData = {
  candidateId: string;
  shortName: string; // "Y. Aidoo"
  fullName: string; // "Yaa Aidoo"
  indexNumber: string;
  programmeLabel: string;
  projection: ProjectionView;
  subjects: SubjectTrajectoryView[];
  scForms: ScFormView[];
  openMedicalSc: ScFormView | null;
  statement: StatementView | null;
  predictorMockName: string;
  markingComplete: boolean;
  canGenerate: boolean; // marking complete AND projection computable
  generateBlockedReason: string | null;
};
