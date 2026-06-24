import { and, asc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { academicPeriod, classes, invoices, payments, students } from "@/db/schema";
import { num } from "./finance-data";

/**
 * Collection-trend aggregates for the Reports → Finance → Collection trend route.
 * Everything here is derived truthfully from real rows. Term windows come from
 * `academic_period`; weekly bucketing is done in JS after fetching the raw
 * payment rows for the relevant date windows (simpler + fine at these volumes).
 */

const WEEK_MS = 7 * 86_400_000;
const DAY_MS = 86_400_000;

type Term = {
  periodId: string;
  academicYear: string;
  periodNumber: number;
  label: string;
  startsOn: Date;
  endsOn: Date;
};

/** Parse a Postgres `date` column ("YYYY-MM-DD") as a UTC midnight Date. */
function parseDate(d: string | Date): Date {
  if (d instanceof Date) return d;
  return new Date(`${d}T00:00:00.000Z`);
}

function totalWeeks(term: Term): number {
  return Math.max(1, Math.ceil((+term.endsOn - +term.startsOn) / WEEK_MS));
}

/** 1-based week index of date `d` within `term` (clamped to >= 1). */
function weekIndexOf(d: Date, term: Term): number {
  return Math.max(1, Math.floor((+d - +term.startsOn) / WEEK_MS) + 1);
}

/** "15-19 Sep" style label for a given week of a term. */
function weekRangeLabels(term: Term, week: number): { startLabel: string; endLabel: string } {
  const start = new Date(+term.startsOn + (week - 1) * WEEK_MS);
  const rawEnd = new Date(+start + 4 * DAY_MS); // Mon–Fri working span
  const end = +rawEnd > +term.endsOn ? term.endsOn : rawEnd;
  const fmt = (dt: Date) =>
    dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return { startLabel: fmt(start), endLabel: fmt(end) };
}

/** Nice rounded-up axis max for a set of cumulative values. */
function niceMax(maxValue: number): number {
  if (maxValue <= 0) return 1000;
  const pow = Math.pow(10, Math.floor(Math.log10(maxValue)));
  const steps = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  for (const s of steps) {
    const candidate = s * pow;
    if (candidate >= maxValue) return candidate;
  }
  return 10 * pow;
}

export type WeeklyRow = {
  week: number;
  amount: number;
  paymentsCount: number;
  studentsCount: number;
  priorAmount: number | null;
  deltaPct: number | null;
  startLabel: string;
  endLabel: string;
};

export type ClassRow = {
  classId: string | null;
  className: string;
  billed: number;
  collected: number;
  outstanding: number;
  rate: number;
};

export type AgingBucket = {
  key: "b1" | "b2" | "b3" | "b4";
  label: string;
  amount: number;
  invoiceCount: number;
  householdCount: number;
  pct: number;
};

export type CollectionTrend = Awaited<ReturnType<typeof getCollectionTrend>>;

export async function getCollectionTrend(schoolId: string) {
  const now = new Date();

  // ---- Academic periods (term windows) ------------------------------------
  const periodRows = await withSchool(schoolId, (tx) =>
    tx
      .select({
        periodId: academicPeriod.periodId,
        academicYear: academicPeriod.academicYear,
        periodNumber: academicPeriod.periodNumber,
        periodLabel: academicPeriod.periodLabel,
        startsOn: academicPeriod.startsOn,
        endsOn: academicPeriod.endsOn,
      })
      .from(academicPeriod)
      .where(eq(academicPeriod.schoolId, schoolId))
      .orderBy(asc(academicPeriod.academicYear), asc(academicPeriod.periodNumber)),
  );

  const terms: Term[] = periodRows.map((r) => ({
    periodId: r.periodId,
    academicYear: r.academicYear,
    periodNumber: r.periodNumber,
    label: r.periodLabel,
    startsOn: parseDate(r.startsOn),
    endsOn: parseDate(r.endsOn),
  }));

  const hasPeriods = terms.length > 0;

  // current term = window containing today; else latest startsOn <= today; else last
  let currentIdx = terms.findIndex((t) => +t.startsOn <= +now && +now <= +t.endsOn);
  if (currentIdx === -1) {
    for (let i = terms.length - 1; i >= 0; i--) {
      if (+terms[i].startsOn <= +now) {
        currentIdx = i;
        break;
      }
    }
  }
  if (currentIdx === -1 && terms.length > 0) currentIdx = terms.length - 1;

  const currentTermObj = currentIdx >= 0 ? terms[currentIdx] : null;
  const priorTermObj = currentIdx > 0 ? terms[currentIdx - 1] : null;
  const hasPrior = !!priorTermObj;

  // The academic year we report invoices against (region 1/4/5).
  const reportYear = currentTermObj?.academicYear ?? null;

  // ---- Weekly collected via raw payment rows ------------------------------
  type PayRow = { paidAt: Date; netAmount: number; studentId: string };

  async function fetchPayments(from: Date, to: Date): Promise<PayRow[]> {
    const rows = await withSchool(schoolId, (tx) =>
      tx
        .select({
          paidAt: payments.paidAt,
          netAmount: payments.netAmount,
          studentId: payments.studentId,
        })
        .from(payments)
        .where(
          and(
            eq(payments.schoolId, schoolId),
            isNull(payments.voidedAt),
            gte(payments.paidAt, from),
            lte(payments.paidAt, to),
          ),
        ),
    );
    return rows.map((r) => ({
      paidAt: r.paidAt as Date,
      netAmount: num(r.netAmount),
      studentId: r.studentId,
    }));
  }

  /** weekly[week] = { amount, payments, students(set) } for weeks 1..totalWeeks */
  function bucketByWeek(rows: PayRow[], term: Term) {
    const tw = totalWeeks(term);
    const buckets = Array.from({ length: tw + 1 }, () => ({
      amount: 0,
      paymentsCount: 0,
      students: new Set<string>(),
    }));
    for (const r of rows) {
      let wk = weekIndexOf(r.paidAt, term);
      if (wk > tw) wk = tw;
      const b = buckets[wk];
      b.amount += r.netAmount;
      b.paymentsCount += 1;
      b.students.add(r.studentId);
    }
    return buckets;
  }

  let currentWeekIndex = 1;
  let currentTotalWeeks = 1;
  let currentBuckets: ReturnType<typeof bucketByWeek> = [];
  let priorBuckets: ReturnType<typeof bucketByWeek> = [];

  if (currentTermObj) {
    currentTotalWeeks = totalWeeks(currentTermObj);
    currentWeekIndex = Math.min(
      Math.max(1, weekIndexOf(now, currentTermObj)),
      currentTotalWeeks,
    );
    const curTo = +now < +currentTermObj.endsOn ? now : currentTermObj.endsOn;
    const curRows = await fetchPayments(currentTermObj.startsOn, curTo);
    currentBuckets = bucketByWeek(curRows, currentTermObj);

    if (priorTermObj) {
      const priorRows = await fetchPayments(priorTermObj.startsOn, priorTermObj.endsOn);
      priorBuckets = bucketByWeek(priorRows, priorTermObj);
    }
  }

  // Cumulative arrays (cedis at week i+1), carried forward over the current
  // term's week axis so current + prior share one x-axis in the overlay.
  const currentCumArr: number[] = [];
  {
    let run = 0;
    for (let w = 1; w <= currentTotalWeeks; w++) {
      run += currentBuckets[w]?.amount ?? 0;
      currentCumArr.push(run);
    }
  }

  let priorCumArr: number[] | null = null;
  if (priorTermObj) {
    priorCumArr = [];
    let run = 0;
    for (let w = 1; w <= currentTotalWeeks; w++) {
      run += priorBuckets[w]?.amount ?? 0;
      priorCumArr.push(run);
    }
  }

  const currentCollected = currentWeekIndex >= 1 ? (currentCumArr[currentWeekIndex - 1] ?? 0) : 0;
  const priorCollectedAtSameWeek =
    priorCumArr && currentWeekIndex >= 1 ? (priorCumArr[currentWeekIndex - 1] ?? 0) : 0;
  const priorFinal = priorCumArr ? (priorCumArr[priorCumArr.length - 1] ?? 0) : 0;

  // ---- Billed per term (by academicYear) ----------------------------------
  async function billedForYear(year: string): Promise<number> {
    const [row] = await withSchool(schoolId, (tx) =>
      tx
        .select({ billed: sql<string>`coalesce(sum(${invoices.billedAmount}), 0)` })
        .from(invoices)
        .where(
          and(
            eq(invoices.schoolId, schoolId),
            eq(invoices.academicYear, year),
            ne(invoices.status, "VOIDED"),
          ),
        ),
    );
    return num(row?.billed);
  }

  const currentBilled = currentTermObj ? await billedForYear(currentTermObj.academicYear) : 0;
  const priorBilled = priorTermObj ? await billedForYear(priorTermObj.academicYear) : 0;

  const currentRate = currentBilled > 0 ? round1((currentCollected / currentBilled) * 100) : 0;
  const priorRateAtSameWeek =
    priorBilled > 0 ? round1((priorCollectedAtSameWeek / priorBilled) * 100) : 0;
  const priorFinalRate = priorBilled > 0 ? round1((priorFinal / priorBilled) * 100) : 0;

  const gapCedis = currentCollected - priorCollectedAtSameWeek;
  const gapPoints = round1(currentRate - priorRateAtSameWeek);

  // Avg weekly (non-cumulative) over last up-to-3 weeks ending at currentWeekIndex
  function weekAmount(buckets: ReturnType<typeof bucketByWeek>, w: number): number {
    return buckets[w]?.amount ?? 0;
  }
  const last3Weeks: number[] = [];
  for (let w = Math.max(1, currentWeekIndex - 2); w <= currentWeekIndex; w++) {
    last3Weeks.push(weekAmount(currentBuckets, w));
  }
  const avgWeeklyLast3 = last3Weeks.length ? mean(last3Weeks) : 0;

  const first3Weeks: number[] = [];
  for (let w = 1; w <= Math.min(3, currentTotalWeeks); w++) {
    first3Weeks.push(weekAmount(currentBuckets, w));
  }
  const avgWeeklyFirst3 = first3Weeks.length ? mean(first3Weeks) : 0;

  // ---- weeklyRows for the grid (week 1..currentWeekIndex) ------------------
  const weeklyRows: WeeklyRow[] = [];
  if (currentTermObj) {
    for (let w = 1; w <= currentWeekIndex; w++) {
      const cur = currentBuckets[w];
      const amount = cur?.amount ?? 0;
      const priorAmount = priorBuckets.length ? (priorBuckets[w]?.amount ?? 0) : null;
      const hasPriorWeek = priorTermObj && priorAmount !== null;
      const deltaPct =
        hasPriorWeek && (priorAmount as number) > 0
          ? round1(((amount - (priorAmount as number)) / (priorAmount as number)) * 100)
          : null;
      const { startLabel, endLabel } = weekRangeLabels(currentTermObj, w);
      weeklyRows.push({
        week: w,
        amount,
        paymentsCount: cur?.paymentsCount ?? 0,
        studentsCount: cur?.students.size ?? 0,
        priorAmount: hasPriorWeek ? (priorAmount as number) : null,
        deltaPct,
        startLabel,
        endLabel,
      });
    }
  }
  const maxWeekly = Math.max(1, ...weeklyRows.map((r) => r.amount));

  // ---- byClass (invoices grouped by class, current academic year) ----------
  const classRowsRaw = await withSchool(schoolId, (tx) =>
    tx
      .select({
        classId: classes.id,
        className: sql<string>`coalesce(${classes.name}, '— Unassigned —')`,
        billed: sql<string>`coalesce(sum(${invoices.billedAmount}), 0)`,
        collected: sql<string>`coalesce(sum(${invoices.paidAmount}), 0)`,
        outstanding: sql<string>`coalesce(sum(${invoices.balanceAmount}), 0)`,
      })
      .from(invoices)
      .innerJoin(students, eq(invoices.studentId, students.id))
      .leftJoin(classes, eq(students.classId, classes.id))
      .where(
        and(
          eq(invoices.schoolId, schoolId),
          ne(invoices.status, "VOIDED"),
          reportYear ? eq(invoices.academicYear, reportYear) : undefined,
        ),
      )
      .groupBy(classes.id, classes.name),
  );

  const byClass: ClassRow[] = classRowsRaw
    .map((c) => {
      const billed = num(c.billed);
      const collected = num(c.collected);
      return {
        classId: c.classId,
        className: c.className,
        billed,
        collected,
        outstanding: num(c.outstanding),
        rate: billed > 0 ? round1((collected / billed) * 100) : 0,
      };
    })
    .sort((a, b) => b.outstanding - a.outstanding);

  // ---- Aging by household (from ISSUE date) -------------------------------
  type AgingInvoiceRow = {
    balance: number;
    issuedAt: Date;
    householdKey: string;
  };
  const agingInvoiceRows = await withSchool(schoolId, (tx) =>
    tx
      .select({
        balance: invoices.balanceAmount,
        issuedAt: invoices.issuedAt,
        householdId: students.householdId,
        studentId: students.id,
      })
      .from(invoices)
      .innerJoin(students, eq(invoices.studentId, students.id))
      .where(
        and(
          eq(invoices.schoolId, schoolId),
          ne(invoices.status, "VOIDED"),
          sql`${invoices.balanceAmount} > 0`,
          reportYear ? eq(invoices.academicYear, reportYear) : undefined,
        ),
      ),
  );

  const agingRows: AgingInvoiceRow[] = agingInvoiceRows.map((r) => ({
    balance: num(r.balance),
    issuedAt: r.issuedAt as Date,
    // NULL household → singleton keyed by studentId
    householdKey: r.householdId ?? `student:${r.studentId}`,
  }));

  const bucketDefs: { key: AgingBucket["key"]; label: string; test: (age: number) => boolean }[] = [
    { key: "b1", label: "1—30 days", test: (a) => a <= 30 },
    { key: "b2", label: "31—60 days", test: (a) => a > 30 && a <= 60 },
    { key: "b3", label: "61—90 days", test: (a) => a > 60 && a <= 90 },
    { key: "b4", label: "90+ days", test: (a) => a > 90 },
  ];

  const bucketAccum = bucketDefs.map((d) => ({
    key: d.key,
    label: d.label,
    amount: 0,
    invoiceCount: 0,
    households: new Set<string>(),
  }));

  let totalOutstanding = 0;
  let totalInvoices = 0;
  const allHouseholds = new Set<string>();
  let oldestIssuedAt: Date | null = null;
  let weightedAgeSum = 0; // sum(balance * age)

  for (const r of agingRows) {
    const age = Math.floor((+now - +r.issuedAt) / DAY_MS);
    totalOutstanding += r.balance;
    totalInvoices += 1;
    allHouseholds.add(r.householdKey);
    weightedAgeSum += r.balance * Math.max(0, age);
    if (!oldestIssuedAt || +r.issuedAt < +oldestIssuedAt) oldestIssuedAt = r.issuedAt;
    const def = bucketDefs.find((d) => d.test(Math.max(0, age)));
    if (def) {
      const acc = bucketAccum.find((a) => a.key === def.key)!;
      acc.amount += r.balance;
      acc.invoiceCount += 1;
      acc.households.add(r.householdKey);
    }
  }

  const agingBuckets: AgingBucket[] = bucketAccum.map((a) => ({
    key: a.key,
    label: a.label,
    amount: a.amount,
    invoiceCount: a.invoiceCount,
    householdCount: a.households.size,
    pct: totalOutstanding > 0 ? round1((a.amount / totalOutstanding) * 100) : 0,
  }));

  const totalHouseholds = allHouseholds.size;
  const avgAgeDays = totalOutstanding > 0 ? Math.round(weightedAgeSum / totalOutstanding) : 0;
  const oldestAgeDays = oldestIssuedAt
    ? Math.floor((+now - +oldestIssuedAt) / DAY_MS)
    : 0;

  // Outstanding headline figures (region 1) — same population as aging.
  const outstandingTotal = totalOutstanding;
  const householdsOutstanding = totalHouseholds;

  // ---- Chart payload ------------------------------------------------------
  const yMaxBasis = Math.max(
    0,
    ...currentCumArr,
    ...(priorCumArr ?? []),
    currentBilled,
  );
  const yMax = niceMax(yMaxBasis);

  const cumulative = {
    current: currentCumArr.slice(0, currentWeekIndex),
    prior: priorCumArr,
    totalWeeks: currentTotalWeeks,
    currentWeekIndex,
    yMax,
  };

  return {
    hasPeriods,
    hasPrior,
    currentTerm: currentTermObj
      ? {
          label: currentTermObj.label,
          academicYear: currentTermObj.academicYear,
          startsOn: currentTermObj.startsOn,
          endsOn: currentTermObj.endsOn,
          totalWeeks: currentTotalWeeks,
        }
      : null,
    priorTerm: priorTermObj
      ? { label: priorTermObj.label, academicYear: priorTermObj.academicYear }
      : null,
    currentWeekIndex,

    // headline
    currentCollected,
    currentBilled,
    currentRate,
    priorCollectedAtSameWeek,
    priorRateAtSameWeek,
    priorFinal,
    priorFinalRate,
    gapCedis,
    gapPoints,
    avgWeeklyLast3,
    avgWeeklyFirst3,
    outstandingTotal,
    householdsOutstanding,

    weeklyRows,
    maxWeekly,

    byClass,

    aging: {
      buckets: agingBuckets,
      totalOutstanding,
      totalInvoices,
      totalHouseholds,
      oldestIssuedAt,
      oldestAgeDays,
      avgAgeDays,
    },

    cumulative,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}
