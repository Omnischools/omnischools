"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateDuesInvoices } from "@/lib/actions/pta-dues";
import type { DuesGenerateOptions } from "@/lib/pta/dues-data";

/**
 * Admin-only generate-dues affordance (INCR-54a · R464), mirroring the IssueInvoicesCard pattern. The
 * admin picks a dues-enabled tier + (a term for per-term dues, or a year for per-year dues); the server
 * re-checks PTA_CONFIG_WRITE_ROLES, reads the forward-only rate in force, and issues one dedicated dues
 * invoice per active student (Form) / per household (General). Idempotent — a re-run reports 0 new.
 */
export function GenerateDuesCard({ options }: { options: DuesGenerateOptions }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tierType, setTierType] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [academicYear, setAcademicYear] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const selected = useMemo(
    () => options.tiers.find((t) => t.tierType === tierType) ?? null,
    [options.tiers, tierType],
  );
  const perTerm = selected?.cadence === "PER_TERM";

  if (options.tiers.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-5 text-sm text-navy-3">
        No tier collects dues yet. Enable dues on a tier in{" "}
        <a href="/senior/pta/setup" className="font-semibold text-gold hover:underline">
          Setup
        </a>{" "}
        first.
      </div>
    );
  }

  const blocked = !selected || (perTerm ? !periodId : !academicYear);

  function run() {
    if (blocked) return;
    setMsg(null);
    startTransition(async () => {
      const res = await generateDuesInvoices({
        tierType,
        periodId: perTerm ? periodId : "",
        academicYear: perTerm ? "" : academicYear,
      });
      setIsError(!res.ok);
      if (res.ok) {
        setMsg(res.note ?? `Done · ${res.created} issued · ${res.skipped} already billed.`);
        router.refresh();
      } else {
        setMsg(res.error);
      }
    });
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
        Issue dues · admin only
      </div>
      <h3 className="mt-2 font-display text-xl font-semibold text-navy">
        Generate <em className="not-italic text-gold">PTA dues invoices</em>
      </h3>
      <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-navy-2">
        Issues one dedicated dues invoice per student (Form) or per family (General), at the rate in force
        for the period. Forward-only · re-running never double-bills.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-navy-2">Tier</span>
          <select
            value={tierType}
            onChange={(e) => {
              setTierType(e.target.value);
              setPeriodId("");
              setAcademicYear("");
            }}
            className="w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none focus:border-gold focus:bg-surface"
          >
            <option value="" disabled>
              Choose a tier
            </option>
            {options.tiers.map((t) => (
              <option key={t.tierType} value={t.tierType}>
                {t.label} ({t.cadence === "PER_TERM" ? "per term" : t.cadence === "PER_YEAR" ? "per year" : "one-off"})
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-navy-2">
            {perTerm ? "Term" : "Academic year"}
          </span>
          {perTerm ? (
            <select
              value={periodId}
              onChange={(e) => setPeriodId(e.target.value)}
              disabled={!selected}
              className="w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none focus:border-gold focus:bg-surface disabled:opacity-60"
            >
              <option value="" disabled>
                Choose a term
              </option>
              {options.terms.map((t) => (
                <option key={t.periodId} value={t.periodId}>
                  {t.label}
                </option>
              ))}
            </select>
          ) : (
            <select
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              disabled={!selected}
              className="w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none focus:border-gold focus:bg-surface disabled:opacity-60"
            >
              <option value="" disabled>
                Choose a year
              </option>
              {options.years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
        </label>

        <button
          onClick={run}
          disabled={pending || blocked}
          className="rounded-md bg-navy px-5 py-2.5 text-sm font-bold text-bg hover:bg-navy-deep disabled:opacity-50"
        >
          {pending ? "Issuing…" : "Issue dues"}
        </button>
      </div>

      {msg && (
        <p className={`mt-3 text-sm font-semibold ${isError ? "text-terra" : "text-green"}`}>{msg}</p>
      )}
    </section>
  );
}
