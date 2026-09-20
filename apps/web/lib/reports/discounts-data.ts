import { and, asc, desc, eq, gte, lt, ne, sql } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import {
  invoices,
  students,
  classes,
  discounts,
  invoiceDiscountApplications,
  academicPeriod,
} from "@/db/schema";
import { ghs, num } from "@/lib/reports/finance-data";

/**
 * Discounts report aggregates — powered by `invoice_discount_application`, the
 * attribution table that links each invoice discount to the scheme that granted
 * it. The table is empty until invoices are issued with a scheme after this
 * change (no historical backfill), so every consumer must handle empty states.
 */

/** Deterministic scheme-colour palette, cycled by sorted index. Solid tokens only. */
export const SCHEME_COLOR_KEYS = ["gold", "green", "warn", "terra", "navy-3"] as const;
export type SchemeColorKey = (typeof SCHEME_COLOR_KEYS)[number];
const colorForIndex = (i: number): SchemeColorKey =>
  SCHEME_COLOR_KEYS[i % SCHEME_COLOR_KEYS.length];

const dateLabel = (d: Date | string | null) =>
  d
    ? new Date(typeof d === "string" ? d : d.toISOString()).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";

type AppRow = {
  id: string;
  discountId: string;
  schemeName: string;
  kind: "FIXED" | "PERCENT" | null;
  value: number; // scheme's configured value (for the "Rate" column)
  isTiered: boolean;
  amount: number;
  rank: number | null;
  appliedAt: Date | null;
  studentId: string;
  studentName: string;
  className: string;
};

export async function getDiscountsReport(
  schoolId: string,
  /** Date window from the PERIOD filter; scopes billed (issue date) + applications (applied date). */
  period?: { start: Date; end: Date } | null,
) {
  return withSchool(schoolId, async (tx) => {
    const win = period ?? null;
    // 1. Current term: window containing today, else latest started, else last.
    const periods = await tx
      .select({
        academicYear: academicPeriod.academicYear,
        periodLabel: academicPeriod.periodLabel,
        startsOn: academicPeriod.startsOn,
        endsOn: academicPeriod.endsOn,
      })
      .from(academicPeriod)
      // Exclude the non-instructional SENIOR_F3 pseudo-period (migration 0048, boarding F3-vacation).
      .where(and(eq(academicPeriod.schoolId, schoolId), ne(academicPeriod.productLine, "SENIOR_F3")))
      .orderBy(asc(academicPeriod.startsOn));

    const todayIso = new Date().toISOString().slice(0, 10);
    let currentTerm: (typeof periods)[number] | null = null;
    if (periods.length) {
      currentTerm =
        periods.find((p) => p.startsOn <= todayIso && p.endsOn >= todayIso) ??
        [...periods].reverse().find((p) => p.startsOn <= todayIso) ??
        periods[periods.length - 1];
    }
    const reportYear = currentTerm?.academicYear ?? null;
    const hasTerm = currentTerm !== null;

    // 2. Total billed (scoped to the report year when known).
    const [billedRow] = await tx
      .select({ total: sql<string>`coalesce(sum(${invoices.billedAmount}), 0)` })
      .from(invoices)
      .where(
        and(
          eq(invoices.schoolId, schoolId),
          ne(invoices.status, "VOIDED"),
          win
            ? and(gte(invoices.issuedAt, win.start), lt(invoices.issuedAt, win.end))
            : reportYear
              ? eq(invoices.academicYear, reportYear)
              : undefined,
        ),
      );
    const totalBilled = num(billedRow?.total);

    // 3. Application rows — join scheme + student + class + invoice (for year scope).
    const raw = await tx
      .select({
        id: invoiceDiscountApplications.id,
        discountId: invoiceDiscountApplications.discountId,
        schemeName: discounts.name,
        kind: discounts.kind,
        value: discounts.value,
        isTiered: discounts.isTiered,
        amount: invoiceDiscountApplications.amount,
        rank: invoiceDiscountApplications.rank,
        appliedAt: invoiceDiscountApplications.appliedAt,
        studentId: invoiceDiscountApplications.studentId,
        firstName: students.firstName,
        lastName: students.lastName,
        className: classes.name,
        academicYear: invoices.academicYear,
      })
      .from(invoiceDiscountApplications)
      .innerJoin(discounts, eq(invoiceDiscountApplications.discountId, discounts.id))
      .innerJoin(students, eq(invoiceDiscountApplications.studentId, students.id))
      .leftJoin(classes, eq(students.classId, classes.id))
      .innerJoin(invoices, eq(invoiceDiscountApplications.invoiceId, invoices.id))
      .where(
        and(
          eq(invoiceDiscountApplications.schoolId, schoolId),
          ne(invoices.status, "VOIDED"),
          win
            ? and(
                gte(invoiceDiscountApplications.appliedAt, win.start),
                lt(invoiceDiscountApplications.appliedAt, win.end),
              )
            : reportYear
              ? eq(invoices.academicYear, reportYear)
              : undefined,
        ),
      )
      .orderBy(desc(invoiceDiscountApplications.appliedAt));

    const apps: AppRow[] = raw.map((r) => ({
      id: r.id,
      discountId: r.discountId,
      schemeName: r.schemeName,
      kind: r.kind,
      value: num(r.value),
      isTiered: r.isTiered,
      amount: num(r.amount),
      rank: r.rank,
      appliedAt: r.appliedAt,
      studentId: r.studentId,
      studentName: `${r.firstName} ${r.lastName}`.trim(),
      className: r.className ?? "— Unassigned —",
    }));

    // 4. Headline aggregates.
    const totalDiscounted = apps.reduce((s, a) => s + a.amount, 0);
    const discountPctOfBilled =
      totalBilled > 0 ? Math.round((totalDiscounted / totalBilled) * 1000) / 10 : 0;
    const applicationCount = apps.length;

    const appsByStudent = new Map<string, AppRow[]>();
    for (const a of apps) {
      const arr = appsByStudent.get(a.studentId) ?? [];
      arr.push(a);
      appsByStudent.set(a.studentId, arr);
    }
    const studentCount = appsByStudent.size;
    const stackedStudentCount = Array.from(appsByStudent.values()).filter((l) => l.length >= 2)
      .length;

    // 5. By scheme (sorted by amount desc → assigns the deterministic colour key).
    type SchemeAgg = {
      discountId: string;
      name: string;
      kind: "FIXED" | "PERCENT" | null;
      amount: number;
      applicationCount: number;
      students: Set<string>;
    };
    const schemeMap = new Map<string, SchemeAgg>();
    for (const a of apps) {
      const s = schemeMap.get(a.discountId) ?? {
        discountId: a.discountId,
        name: a.schemeName,
        kind: a.kind,
        amount: 0,
        applicationCount: 0,
        students: new Set<string>(),
      };
      s.amount += a.amount;
      s.applicationCount += 1;
      s.students.add(a.studentId);
      schemeMap.set(a.discountId, s);
    }
    const byScheme = Array.from(schemeMap.values())
      .sort((a, b) => b.amount - a.amount)
      .map((s, i) => ({
        discountId: s.discountId,
        name: s.name,
        kind: s.kind,
        amount: s.amount,
        applicationCount: s.applicationCount,
        studentCount: s.students.size,
        sharePct: totalDiscounted > 0 ? Math.round((s.amount / totalDiscounted) * 1000) / 10 : 0,
        colorKey: colorForIndex(i),
      }));

    const colorByDiscount = new Map(byScheme.map((s) => [s.discountId, s.colorKey]));
    const schemeColor: { discountId: string; colorKey: SchemeColorKey; name: string }[] =
      byScheme.map((s) => ({ discountId: s.discountId, colorKey: s.colorKey, name: s.name }));

    // Most-used scheme (by application count); share is % of all applications.
    const mostUsedScheme =
      byScheme.length > 0
        ? (() => {
            const top = [...byScheme].sort((a, b) => b.applicationCount - a.applicationCount)[0];
            return {
              name: top.name,
              applicationCount: top.applicationCount,
              sharePct:
                applicationCount > 0
                  ? Math.round((top.applicationCount / applicationCount) * 100)
                  : 0,
            };
          })()
        : null;

    // 6. New this term: applications applied within the current term window.
    let newThisTerm = 0;
    let newBreakdown = "";
    if (currentTerm) {
      const start = currentTerm.startsOn;
      const end = currentTerm.endsOn;
      const inWindow = apps.filter((a) => {
        if (!a.appliedAt) return false;
        const iso = new Date(a.appliedAt).toISOString().slice(0, 10);
        return iso >= start && iso <= end;
      });
      newThisTerm = inWindow.length;
      const byName = new Map<string, number>();
      for (const a of inWindow) byName.set(a.schemeName, (byName.get(a.schemeName) ?? 0) + 1);
      newBreakdown = Array.from(byName.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, n]) => `${n} ${name}`)
        .join(" · ");
    }

    // 7. Timeline — weekly buckets across the active window (≤ 20 weeks), else
    //    calendar months. Each bucket carries a per-scheme amount map for stacking.
    const MS_WEEK = 7 * 24 * 60 * 60 * 1000;
    const tlStartMs = win ? +win.start : currentTerm ? +new Date(`${currentTerm.startsOn}T00:00:00Z`) : null;
    const tlEndMs = win ? +win.end : currentTerm ? +new Date(`${currentTerm.endsOn}T00:00:00Z`) : null;
    const tlWeekly = tlStartMs != null && tlEndMs != null && tlEndMs - tlStartMs <= 20 * MS_WEEK;
    let timelineWeeks: { label: string; segments: Record<string, number> }[] = [];
    if (tlStartMs != null && tlEndMs != null && tlWeekly) {
      const start = tlStartMs;
      const end = tlEndMs;
      const weekCount = Math.max(1, Math.ceil((end - start) / MS_WEEK) + 1);
      timelineWeeks = Array.from({ length: weekCount }, (_, i) => ({
        label: `W${i + 1}`,
        segments: {} as Record<string, number>,
      }));
      for (const a of apps) {
        if (!a.appliedAt) continue;
        const t = new Date(a.appliedAt).getTime();
        if (t < start || t > end + MS_WEEK) continue;
        const idx = Math.min(weekCount - 1, Math.max(0, Math.floor((t - start) / MS_WEEK)));
        timelineWeeks[idx].segments[a.discountId] =
          (timelineWeeks[idx].segments[a.discountId] ?? 0) + a.amount;
      }
    } else {
      const monthMap = new Map<string, Record<string, number>>();
      for (const a of apps) {
        if (!a.appliedAt) continue;
        const d = new Date(a.appliedAt);
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        const seg = monthMap.get(key) ?? {};
        seg[a.discountId] = (seg[a.discountId] ?? 0) + a.amount;
        monthMap.set(key, seg);
      }
      timelineWeeks = Array.from(monthMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, segments]) => {
          const [y, m] = key.split("-").map(Number);
          const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
            month: "short",
            year: "numeric",
            timeZone: "UTC",
          });
          return { label, segments };
        });
    }
    const yMax = Math.max(
      1,
      ...timelineWeeks.map((w) => Object.values(w.segments).reduce((s, v) => s + v, 0)),
    );
    const timeline = {
      weeks: timelineWeeks,
      schemes: byScheme.map((s) => ({ discountId: s.discountId, name: s.name, colorKey: s.colorKey })),
      yMax,
    };

    // 8. Top recipients — by total amount, top 8.
    const topRecipients = Array.from(appsByStudent.values())
      .map((list) => {
        const seen = new Set<string>();
        const schemeNames: string[] = [];
        for (const a of list)
          if (!seen.has(a.schemeName)) {
            seen.add(a.schemeName);
            schemeNames.push(a.schemeName);
          }
        return {
          studentName: list[0].studentName,
          className: list[0].className,
          total: list.reduce((s, a) => s + a.amount, 0),
          schemes: schemeNames,
        };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    // 9. Table rows — one per application.
    const rateText = (a: AppRow) =>
      a.isTiered ? "tiered" : a.kind === "PERCENT" ? `${a.value}%` : `GHS ${a.value.toFixed(2)}`;
    const rows = apps.map((a) => ({
      id: a.id,
      studentName: a.studentName,
      className: a.className,
      schemeName: a.schemeName,
      kind: a.kind,
      rate: rateText(a),
      amount: a.amount,
      amountLabel: ghs(a.amount),
      appliedLabel: dateLabel(a.appliedAt),
      colorKey: colorByDiscount.get(a.discountId) ?? "navy-3",
      discountId: a.discountId,
    }));

    return {
      hasTerm,
      reportYear,
      currentTerm: currentTerm
        ? {
            academicYear: currentTerm.academicYear,
            periodLabel: currentTerm.periodLabel,
            startsOn: currentTerm.startsOn,
            endsOn: currentTerm.endsOn,
          }
        : null,
      totalBilled,
      totalDiscounted,
      discountPctOfBilled,
      applicationCount,
      studentCount,
      stackedStudentCount,
      byScheme,
      schemesInUse: byScheme.length,
      mostUsedScheme,
      newThisTerm,
      newBreakdown,
      timeline,
      topRecipients,
      rows,
      schemeColor,
    };
  });
}

export type DiscountsReport = Awaited<ReturnType<typeof getDiscountsReport>>;
