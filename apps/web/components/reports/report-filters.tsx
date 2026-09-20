"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * TERM + CLASS filter for the academic / operational reports. Unlike the finance
 * `PeriodBar` (a date window), these key on a specific `academic_period.periodId`, so
 * each term pill writes `?periodId=<uuid>` and the class select writes `?classId=<uuid>`.
 * Same visual idiom + URL mechanics as PeriodBar.
 */
export type TermOption = { periodId: string; label: string; academicYear: string };
export type ClassOption = { classId: string; name: string };

export function ReportFilters({
  terms,
  activePeriodId,
  classes,
  activeClassId = null,
  showClass = true,
}: {
  terms: TermOption[];
  activePeriodId: string | null;
  classes?: ClassOption[];
  activeClassId?: string | null;
  showClass?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function go(next: Record<string, string | undefined>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === "") sp.delete(k);
      else sp.set(k, v);
    }
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">
          Term
        </span>
        {terms.length === 0 ? (
          <span className="text-xs text-navy-3">No terms configured</span>
        ) : (
          terms.map((t) => {
            const active = t.periodId === activePeriodId;
            return (
              <button
                key={t.periodId}
                onClick={() => go({ periodId: t.periodId })}
                className={cn(
                  "rounded-pill border px-3 py-1 text-xs font-semibold transition-colors",
                  active
                    ? "border-navy bg-navy text-bg"
                    : "border-border-2 bg-surface text-navy-3 hover:border-gold hover:text-navy-2",
                )}
              >
                {t.label} · {t.academicYear}
              </button>
            );
          })
        )}
      </div>

      {showClass && classes && classes.length > 0 && (
        <label className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">Class</span>
          <select
            value={activeClassId ?? ""}
            onChange={(e) => go({ classId: e.target.value || undefined })}
            className="rounded-md border border-border-2 bg-bg px-2 py-1.5 text-xs text-navy outline-none focus:border-gold"
          >
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.classId} value={c.classId}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
