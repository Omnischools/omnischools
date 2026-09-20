/**
 * SERVER-ONLY read for the OUTBREAK MONITOR (today §05 / §O5, SHS module 4.4 / INCR-27). Imports the
 * DB driver via withSchool — must NEVER be imported by a client component. The page fetches through
 * here and passes pre-shaped, serialisable props down.
 *
 * 🔴 COUNTS-ONLY, BY CONSTRUCTION (R216/R223, A9 — the single most important PII fact of the whole
 * increment). This reader selects `surveillance_category` + `presented_at` and NOTHING student-
 * identifying: no student_id, no name, no complaint. There is no student column to leak because the
 * projection carries none. The temptation to add "view the N cases" is refused at the shape.
 *
 * NO SCHEDULER, NO STORED FLAG (R216): every count, trend and status is DERIVED at read over the
 * rolling window. The full category set always renders — a category at 0 is a measured baseline.
 */
import "server-only";
import { and, eq, gte, isNotNull, isNull, min } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { sickbayVisit } from "@/db/schema";
import {
  OUTBREAK_CATEGORY_ORDER,
  OUTBREAK_WINDOW_DAYS,
  SURVEILLANCE_CATEGORY_META,
  outbreakLede,
  outbreakStatus,
  outbreakTrend,
  topOutbreakStatus,
  type OutbreakStatus,
  type OutbreakTrend,
  type SurveillanceCategory,
} from "./surveillance";

export interface OutbreakCategoryRow {
  key: SurveillanceCategory;
  label: string;
  sub: string;
  count: number;
  /** Null until a prior 7-day window exists (the first 14 days of operation). Never a fake arrow. */
  trend: OutbreakTrend | null;
  status: OutbreakStatus;
}

export interface OutbreakMonitor {
  asOf: Date;
  windowDays: number;
  /** The count of categories the monitor tracks — derived, never the hardcoded "Six". */
  conditionCount: number;
  categories: OutbreakCategoryRow[];
  totalCases: number;
  monitorCount: number;
  amberCount: number;
  topStatus: OutbreakStatus;
  priorWindowExists: boolean;
  /** DERIVED lede (`**bold**` fragments) — split with splitBold. */
  lede: string;
}

const DAY_MS = 86_400_000;

/**
 * getOutbreakMonitor → §O5. `now` is threaded so every window boundary belongs to one request instant.
 * ONE statement fetches the categorised visits across BOTH windows (14 days); a second reads the
 * school's earliest visit to decide whether a prior window even exists. No per-category N+1.
 */
export async function getOutbreakMonitor(schoolId: string, now: Date): Promise<OutbreakMonitor> {
  const windowStart = new Date(now.getTime() - OUTBREAK_WINDOW_DAYS * DAY_MS);
  const priorStart = new Date(now.getTime() - 2 * OUTBREAK_WINDOW_DAYS * DAY_MS);

  return withSchool(schoolId, async (tx) => {
    // Counts-only: category + timestamp, nothing student-identifying. Non-voided, categorised visits
    // presented within the two-window span.
    const rows = await tx
      .select({
        category: sickbayVisit.surveillanceCategory,
        presentedAt: sickbayVisit.presentedAt,
      })
      .from(sickbayVisit)
      .where(
        and(
          eq(sickbayVisit.schoolId, schoolId),
          isNull(sickbayVisit.voidedAt),
          isNotNull(sickbayVisit.surveillanceCategory),
          gte(sickbayVisit.presentedAt, priorStart),
        ),
      );

    // A prior window "exists" only once the school has ≥14 days of history — otherwise the trend is
    // blank (§9). The earliest non-voided visit predating the prior-window start is that signal.
    const [{ earliest } = { earliest: null }] = await tx
      .select({ earliest: min(sickbayVisit.presentedAt) })
      .from(sickbayVisit)
      .where(and(eq(sickbayVisit.schoolId, schoolId), isNull(sickbayVisit.voidedAt)));
    const priorWindowExists =
      earliest !== null && new Date(earliest).getTime() <= priorStart.getTime();

    const current = new Map<SurveillanceCategory, number>();
    const prior = new Map<SurveillanceCategory, number>();
    for (const r of rows) {
      if (!r.category) continue;
      const map = r.presentedAt.getTime() >= windowStart.getTime() ? current : prior;
      map.set(r.category, (map.get(r.category) ?? 0) + 1);
    }

    const categories: OutbreakCategoryRow[] = OUTBREAK_CATEGORY_ORDER.map((key) => {
      const count = current.get(key) ?? 0;
      const priorCount = prior.get(key) ?? 0;
      const meta = SURVEILLANCE_CATEGORY_META[key];
      return {
        key,
        label: meta.label,
        sub: meta.sub,
        count,
        trend: outbreakTrend(count, priorCount, priorWindowExists),
        status: outbreakStatus(count, priorWindowExists ? priorCount : null),
      };
    });

    const totalCases = categories.reduce((s, c) => s + c.count, 0);
    return {
      asOf: now,
      windowDays: OUTBREAK_WINDOW_DAYS,
      conditionCount: categories.length,
      categories,
      totalCases,
      monitorCount: categories.filter((c) => c.status === "MONITOR").length,
      amberCount: categories.filter((c) => c.status === "AMBER").length,
      topStatus: topOutbreakStatus(categories.map((c) => c.status)),
      priorWindowExists,
      lede: outbreakLede(categories),
    };
  });
}
