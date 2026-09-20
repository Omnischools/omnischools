"use client";
import { useMemo, useState } from "react";
import { StudentsTable, type StudentRow } from "./students-table";

const STATUS_OPTIONS = [
  "ACTIVE",
  "INACTIVE",
  "GRADUATED",
  "WITHDRAWN",
  "TRANSFERRED",
] as const;

const cap = (s: string) =>
  s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replaceAll("_", " ");

/** Whole-year age from a YYYY-MM-DD date of birth, or null if unparseable. */
function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 120 ? age : null;
}

const selectCls =
  "rounded-lg border border-border-2 bg-surface px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold";

/**
 * Students list shell — black & gold header lives in the page; this owns the summary
 * cards (total · gender ratio · average age), the search + dropdown filters, and the
 * filtered table. Filtering recomputes the cards too, so the numbers always reflect the
 * current view.
 */
export function StudentsBrowser({
  rows,
  classOptions,
  readOnly = false,
}: {
  rows: StudentRow[];
  classOptions: string[];
  readOnly?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [genderFilter, setGenderFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (classFilter && r.currentClassLabel !== classFilter) return false;
      if (genderFilter && r.sex !== genderFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (q) {
        const hay =
          `${r.firstName} ${r.lastName} ${r.otherNames ?? ""} ${r.studentCode}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, classFilter, genderFilter, statusFilter]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const active = filtered.filter((r) => r.status === "ACTIVE").length;
    const boys = filtered.filter((r) => r.sex === "MALE").length;
    const girls = filtered.filter((r) => r.sex === "FEMALE").length;
    const known = boys + girls;
    const ages = filtered.map((r) => ageFromDob(r.dateOfBirth)).filter((a): a is number => a !== null);
    const avgAge = ages.length ? ages.reduce((s, a) => s + a, 0) / ages.length : null;
    return {
      total,
      active,
      boys,
      girls,
      boysPct: known ? Math.round((boys / known) * 100) : 0,
      girlsPct: known ? Math.round((girls / known) * 100) : 0,
      avgAge,
      withDob: ages.length,
    };
  }, [filtered]);

  const hasFilters = !!(search || classFilter || genderFilter || statusFilter);
  const clearAll = () => {
    setSearch("");
    setClassFilter("");
    setGenderFilter("");
    setStatusFilter("");
  };

  return (
    <div>
      {/* Summary cards — recompute with the filters */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-navy bg-navy p-5 text-bg">
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-gold-soft">
            Total students
          </div>
          <div className="mt-1 font-display text-4xl font-semibold">{stats.total}</div>
          <div className="mt-0.5 text-[11px] text-gold-soft">
            {stats.active} active
            {stats.total - stats.active > 0 ? ` · ${stats.total - stats.active} other` : ""}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3">
            Gender ratio · boys : girls
          </div>
          <div className="mt-1 font-display text-4xl font-semibold text-navy">
            {stats.boys} <span className="text-navy-3">:</span> {stats.girls}
          </div>
          <div className="mt-0.5 text-[11px] text-navy-3">
            {stats.boysPct}% boys · {stats.girlsPct}% girls
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3">
            Average age
          </div>
          <div className="mt-1 font-display text-4xl font-semibold text-navy">
            {stats.avgAge === null ? "—" : stats.avgAge.toFixed(1)}
            {stats.avgAge !== null && (
              <span className="ml-1 text-lg font-medium text-navy-3">yrs</span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-navy-3">
            {stats.withDob} of {stats.total} with date of birth
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or code…"
          className="min-w-[200px] flex-1 rounded-lg border border-border-2 bg-surface px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold"
          aria-label="Search students"
        />
        <select
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className={selectCls}
          aria-label="Filter by class"
        >
          <option value="">All classes</option>
          {classOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={genderFilter}
          onChange={(e) => setGenderFilter(e.target.value)}
          className={selectCls}
          aria-label="Filter by gender"
        >
          <option value="">All genders</option>
          <option value="MALE">Boys</option>
          <option value="FEMALE">Girls</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={selectCls}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {cap(s)}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button
            type="button"
            onClick={clearAll}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-navy-3 transition-colors hover:text-terra"
          >
            Clear
          </button>
        )}
      </div>

      <p className="mb-3 mt-3 text-xs text-navy-3">
        Showing <span className="font-semibold text-navy">{filtered.length}</span> of{" "}
        {rows.length} students
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-2 bg-surface p-8 text-center text-sm text-navy-3">
          No students match these filters.
        </p>
      ) : (
        <StudentsTable rows={filtered} readOnly={readOnly} />
      )}
    </div>
  );
}
