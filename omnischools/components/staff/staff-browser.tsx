"use client";
import { useMemo, useState } from "react";
import { StaffTable } from "./staff-table";
import { isTeachingStaff } from "@/lib/staff-roles";
import { QUALIFICATION_LEVELS, averageQualificationLabel } from "@/lib/staff-qualifications";

export type StaffBrowserMember = {
  userId: string;
  name: string | null;
  phone: string;
  email: string | null;
  roles: { assignmentId: string; code: string; label: string | null }[];
  qualificationLevel: string | null;
};

const selectCls =
  "rounded-lg border border-border-2 bg-surface px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold";

/**
 * Staff list shell — owns the summary cards (# teachers · teacher : student ratio ·
 * average qualification), the search + role/qualification filters, and the filtered
 * table. The cards recompute with the filters; the ratio's student denominator is the
 * school-wide active-student count (fixed). The table keeps its inline quick-actions.
 */
export function StaffBrowser({
  staff,
  activeStudents,
  roleOptions,
}: {
  staff: StaffBrowserMember[];
  activeStudents: number;
  roleOptions: { code: string; label: string }[];
}) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [qualFilter, setQualFilter] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staff.filter((m) => {
      if (roleFilter && !m.roles.some((r) => r.code === roleFilter)) return false;
      if (qualFilter && m.qualificationLevel !== qualFilter) return false;
      if (q) {
        const hay = `${m.name ?? ""} ${m.phone} ${m.email ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [staff, search, roleFilter, qualFilter]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const teachers = filtered.filter((m) => isTeachingStaff(m.roles.map((r) => r.code))).length;
    const ratio = teachers > 0 ? activeStudents / teachers : null;
    const qual = averageQualificationLabel(filtered.map((m) => m.qualificationLevel));
    return { total, teachers, ratio, qual };
  }, [filtered, activeStudents]);

  const hasFilters = !!(search || roleFilter || qualFilter);
  const clearAll = () => {
    setSearch("");
    setRoleFilter("");
    setQualFilter("");
  };

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-navy bg-navy p-5 text-bg">
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-gold-soft">
            Teachers
          </div>
          <div className="mt-1 font-display text-4xl font-semibold">{stats.teachers}</div>
          <div className="mt-0.5 text-[11px] text-gold-soft">
            of {stats.total} staff
            {stats.total - stats.teachers > 0
              ? ` · ${stats.total - stats.teachers} non-teaching`
              : ""}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3">
            Teacher : student ratio
          </div>
          <div className="mt-1 font-display text-4xl font-semibold text-navy">
            {stats.ratio === null ? "—" : `1 : ${Math.round(stats.ratio)}`}
          </div>
          <div className="mt-0.5 text-[11px] text-navy-3">
            {stats.teachers} {stats.teachers === 1 ? "teacher" : "teachers"} ·{" "}
            {activeStudents} students
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3">
            Average qualification
          </div>
          <div className="mt-1 font-display text-2xl font-semibold leading-tight text-navy">
            {stats.qual.label}
          </div>
          <div className="mt-0.5 text-[11px] text-navy-3">
            {stats.qual.captured} of {stats.total} captured
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone or email…"
          className="min-w-[200px] flex-1 rounded-lg border border-border-2 bg-surface px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold"
          aria-label="Search staff"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className={selectCls}
          aria-label="Filter by role"
        >
          <option value="">All roles</option>
          {roleOptions.map((r) => (
            <option key={r.code} value={r.code}>
              {r.label}
            </option>
          ))}
        </select>
        <select
          value={qualFilter}
          onChange={(e) => setQualFilter(e.target.value)}
          className={selectCls}
          aria-label="Filter by qualification"
        >
          <option value="">All qualifications</option>
          {QUALIFICATION_LEVELS.map((q) => (
            <option key={q.code} value={q.code}>
              {q.label}
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
        {staff.length} staff
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-2 bg-surface p-8 text-center text-sm text-navy-3">
          No staff match these filters.
        </p>
      ) : (
        <StaffTable staff={filtered} />
      )}
    </div>
  );
}
