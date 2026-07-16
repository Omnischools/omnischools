/**
 * Score Ledger Item 7 (INCR-6) — the versioned-write path for senior_score_ledger.
 *
 * Split like compute.ts / scan-diff.ts: the DECISIONS are pure + unit-tested (nextVersion,
 * grainHasChange); the DB side (resolve prior latest, insert snapshot, prune closed periods)
 * is a thin layer taking a Tx. Path B (`commitScanLedger`) is the only caller today (Kofi Q7b).
 *
 * Every commit that accepts ≥1 cell change for a grain appends ONE immutable snapshot of the
 * senior_score_ledger row, self-FKed to the grain's prior latest version (supersedes chain).
 * Snapshots are never UPDATE/DELETEd except the period-scoped prune below. NEVER a DB trigger
 * (portability — Dex).
 */
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { seniorScoreLedgerVersion } from "@/db/schema/score-ledger";
import { academicPeriod } from "@/db/schema/periods";
import type { CategoryScores } from "./compute";

// ---------------------------------------------------------------- pure decisions

/** The prior latest version for a grain (the row a new version supersedes). */
export interface PriorVersionRef {
  id: string;
  versionNumber: number;
}

/**
 * The version number + supersedes pointer for the next snapshot of a grain (AC B1/B2).
 * Genesis (no prior version) → v1, supersedes NULL. Otherwise vN+1, supersedes the prior id.
 */
export function nextVersion(prior: PriorVersionRef | null | undefined): {
  versionNumber: number;
  supersedesId: string | null;
} {
  if (prior == null) return { versionNumber: 1, supersedesId: null };
  return { versionNumber: prior.versionNumber + 1, supersedesId: prior.id };
}

const CELL_KEYS = ["asgn", "midSem", "endSem", "project", "portfolio"] as const;

/**
 * Does this commit change the grain? (AC B6.) A grain mints a new version ONLY when at least
 * one of the five category cells differs new-vs-latest — a no-op commit (payload == latest)
 * writes nothing, so a re-upload of an unchanged page mints no empty churn. `before` is the
 * live senior_score_ledger cells (null when the grain has no ledger row yet = genesis with data).
 */
export function grainHasChange(
  before: CategoryScores | null | undefined,
  after: CategoryScores,
): boolean {
  return CELL_KEYS.some((k) => (before?.[k] ?? null) !== after[k]);
}

// ---------------------------------------------------------------- thin DB layer

export interface LedgerVersionGrain {
  schoolId: string;
  studentId: string;
  subjectId: string;
  periodId: string;
}

/** The snapshot cells + provenance to persist (five cells + total already numeric-stringified). */
export interface LedgerVersionSnapshot {
  asgnScore: string | null;
  midSemScore: string | null;
  endSemScore: string | null;
  projectScore: string | null;
  portfolioScore: string | null;
  weightedTotal: string | null;
  status: "DRAFT" | "COMPLETE" | "STPSHS_READY";
  pathUsed: "AUTO_COMPILE" | "SCAN_EXTRACT" | "DIRECT_ENTRY";
  committedByUserId?: string;
  batchId: string;
}

/** Resolve a grain's prior latest version — the supersedes target — or null (genesis). */
async function resolvePriorLatestVersion(
  tx: Tx,
  grain: LedgerVersionGrain,
): Promise<PriorVersionRef | null> {
  const [prior] = await tx
    .select({
      id: seniorScoreLedgerVersion.id,
      versionNumber: seniorScoreLedgerVersion.versionNumber,
    })
    .from(seniorScoreLedgerVersion)
    .where(
      and(
        eq(seniorScoreLedgerVersion.schoolId, grain.schoolId),
        eq(seniorScoreLedgerVersion.studentId, grain.studentId),
        eq(seniorScoreLedgerVersion.subjectId, grain.subjectId),
        eq(seniorScoreLedgerVersion.periodId, grain.periodId),
      ),
    )
    .orderBy(desc(seniorScoreLedgerVersion.versionNumber))
    .limit(1);
  return prior ?? null;
}

const MAX_VERSION_ATTEMPTS = 3;

/**
 * Append one immutable version snapshot for a grain, self-FKed to its prior latest (AC A1/B2).
 *
 * Concurrency (AC I1): two commits racing the same grain both resolve vN, both try to insert
 * (grain, vN+1). `onConflictDoNothing` on uniq_ledger_version_grain_number lets the loser's
 * insert skip WITHOUT poisoning the transaction (a raw unique violation would abort the whole
 * tx); the loop then re-reads the now-committed winner and mints vN+2. Exactly one row per
 * (grain, version_number) persists; senior_score_ledger is a full-row upsert so it never loses
 * an update either.
 *
 * ponytail: bounded 3-try optimistic loop on the grain-number unique. A single grain hammered by
 * >3 truly-simultaneous scan commits fails the 4th cleanly (the whole commit tx rolls back and
 * the teacher re-commits) — no corruption, no dup. Upgrade to a per-grain advisory lock only if
 * scan-commit contention on one class×subject×period ever becomes real (it is one teacher today).
 */
export async function writeLedgerVersion(
  tx: Tx,
  grain: LedgerVersionGrain,
  snapshot: LedgerVersionSnapshot,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_VERSION_ATTEMPTS; attempt++) {
    const prior = await resolvePriorLatestVersion(tx, grain);
    const { versionNumber, supersedesId } = nextVersion(prior);
    const inserted = await tx
      .insert(seniorScoreLedgerVersion)
      .values({
        schoolId: grain.schoolId,
        studentId: grain.studentId,
        subjectId: grain.subjectId,
        periodId: grain.periodId,
        versionNumber,
        supersedesId,
        batchId: snapshot.batchId,
        asgnScore: snapshot.asgnScore,
        midSemScore: snapshot.midSemScore,
        endSemScore: snapshot.endSemScore,
        projectScore: snapshot.projectScore,
        portfolioScore: snapshot.portfolioScore,
        weightedTotal: snapshot.weightedTotal,
        status: snapshot.status,
        pathUsed: snapshot.pathUsed,
        committedByUserId: snapshot.committedByUserId,
      })
      .onConflictDoNothing({
        target: [
          seniorScoreLedgerVersion.schoolId,
          seniorScoreLedgerVersion.studentId,
          seniorScoreLedgerVersion.subjectId,
          seniorScoreLedgerVersion.periodId,
          seniorScoreLedgerVersion.versionNumber,
        ],
      })
      .returning({ id: seniorScoreLedgerVersion.id });
    if (inserted.length > 0) return;
  }
  throw new Error("ledger version write lost the concurrency race after retries");
}

/**
 * Period-scoped prune (AC F, Kofi Q6). Lazy prune-on-write keyed off academic_period.closedAt:
 * delete every version whose period is CLOSED. Runs inside the versioned-write tx, so a commit
 * into an open period sweeps the prior closed period's snapshots. Tenant-scoped. NEVER touches
 * senior_score_ledger (F2). A REOPENED period (closedAt → NULL) is spared (F3). supersedes is
 * co-periodic, so a whole closed chain is deleted in one statement — NO ACTION is satisfied at
 * statement end, no dangling FK (Trap 3).
 *
 * ponytail: a school that never closes a period never prunes — acceptable (no corruption, just
 * retained history). Upgrade path is a period-close hook, but closeTerm is reversible so keying
 * off closedAt on write is the safe trigger (a destructive prune-on-close would lose history on
 * a close→reopen).
 */
export async function prunePriorPeriodVersions(tx: Tx, schoolId: string): Promise<void> {
  await tx.delete(seniorScoreLedgerVersion).where(
    and(
      eq(seniorScoreLedgerVersion.schoolId, schoolId),
      inArray(
        seniorScoreLedgerVersion.periodId,
        tx
          .select({ periodId: academicPeriod.periodId })
          .from(academicPeriod)
          .where(
            and(eq(academicPeriod.schoolId, schoolId), isNotNull(academicPeriod.closedAt)),
          ),
      ),
    ),
  );
}
