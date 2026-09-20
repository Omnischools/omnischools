"use client";

import { useMemo, useState } from "react";
import { PROGRAMME_TRACKS, type WassceProgrammeKey } from "@/lib/wassce/constants";

/**
 * The frozen WASSCE registration roster — "the 240" (surface §4.4/§4.5). CLIENT view-state only:
 * the Show filters (programme / flagged / accommodations) and the Sort pills are non-mutating view
 * controls over already-loaded, PRE-FORMATTED rows. It imports NO data module and NO db driver
 * (repo memory: client tables take pre-formatted strings). Every count on a pill derives from the
 * rows it is handed — nothing is hardcoded.
 *
 * READ-ONLY (AC-B): there is no edit/select/mutate affordance on any row. The `Aggregate` sort is
 * DISABLED — mock/projection is INCR-16/17 and has no data here (AC-G). The Mock-2 column renders
 * the seeded aggregate only; no tier is computed.
 */

export type WassceRosterRow = {
  id: string;
  name: string; // "Y. Aidoo"
  studentCode: string; // "SHS-2023-0817"
  initials: string; // "YA"
  avatarClass: string; // avatar tint utility classes
  programmeKey: WassceProgrammeKey;
  indexNumber: string; // "0184-0817"
  indexSub: string | null; // "SC-12 filed" | null
  regStatusLabel: string; // "Confirmed" | "On medical" | "NHIS issue" | "Fee"
  regStatusClass: string; // pill utility classes
  noteStrong: string | null; // leading bold segment of the note (or null)
  note: string; // remainder of the note
  mock2Agg: string; // seeded aggregate, "10" (or "—")
  isLive: boolean; // Y. Aidoo medical-leave live-row highlight
  isFlagged: boolean;
  hasAccommodation: boolean;
};

type ShowFilter = "all" | "flagged" | "accommodations" | WassceProgrammeKey;
type SortKey = "index" | "class";

const SHOW_ORDER: { key: ShowFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "flagged", label: "Flagged" },
  { key: "accommodations", label: "Accommodations" },
  { key: "GENERAL_SCIENCE", label: "Science" },
  { key: "BUSINESS", label: "Business" },
  { key: "GENERAL_ARTS", label: "Arts" },
  { key: "HOME_ECONOMICS", label: "Home Ec." },
];

// Class-grouping sort proxy — synthetic F3 candidates carry no class row, so "Class" groups by
// programme track (the real available grouping: F3 SCI, F3 BUS, …), then by index number.
const PROG_SORT_RANK: Record<WassceProgrammeKey, number> = {
  GENERAL_SCIENCE: 0,
  BUSINESS: 1,
  GENERAL_ARTS: 2,
  HOME_ECONOMICS: 3,
};

function ProgPill({ programmeKey }: { programmeKey: WassceProgrammeKey }) {
  const t = PROGRAMME_TRACKS[programmeKey];
  const base = "inline-block rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide";
  if (t.pillBgClass) {
    return <span className={`${base} ${t.pillBgClass}`}>{t.shortLabel}</span>;
  }
  // General Arts — bespoke purple, inline rgba tint + solid hex text (no token, no slash-opacity).
  return (
    <span
      className={base}
      style={{ backgroundColor: t.pillBgStyle ?? undefined, color: t.color }}
    >
      {t.shortLabel}
    </span>
  );
}

export function WassceRosterTable({ rows }: { rows: WassceRosterRow[] }) {
  const [show, setShow] = useState<ShowFilter>("all");
  const [sort, setSort] = useState<SortKey>("class");

  // Counts derive from the handed rows — never hardcoded (AC-B).
  const counts = useMemo(() => {
    const byProg = { GENERAL_SCIENCE: 0, BUSINESS: 0, GENERAL_ARTS: 0, HOME_ECONOMICS: 0 } as Record<
      WassceProgrammeKey,
      number
    >;
    let flagged = 0;
    let accommodations = 0;
    for (const r of rows) {
      byProg[r.programmeKey]++;
      if (r.isFlagged) flagged++;
      if (r.hasAccommodation) accommodations++;
    }
    return { all: rows.length, flagged, accommodations, byProg };
  }, [rows]);

  const countFor = (key: ShowFilter): number => {
    if (key === "all") return counts.all;
    if (key === "flagged") return counts.flagged;
    if (key === "accommodations") return counts.accommodations;
    return counts.byProg[key];
  };

  const visible = useMemo(() => {
    const filtered = rows.filter((r) => {
      if (show === "all") return true;
      if (show === "flagged") return r.isFlagged;
      if (show === "accommodations") return r.hasAccommodation;
      return r.programmeKey === show;
    });
    const sorted = [...filtered];
    if (sort === "index") {
      sorted.sort((a, b) => a.indexNumber.localeCompare(b.indexNumber));
    } else {
      sorted.sort(
        (a, b) =>
          PROG_SORT_RANK[a.programmeKey] - PROG_SORT_RANK[b.programmeKey] ||
          a.indexNumber.localeCompare(b.indexNumber),
      );
    }
    return sorted;
  }, [rows, show, sort]);

  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
      active
        ? "border-navy bg-navy text-bg"
        : "border-border-2 bg-surface text-navy-2 hover:bg-gold-bg"
    }`;

  return (
    <div>
      {/* §4.4 filter + sort strip — client view-state, no writes. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">Show</span>
        {SHOW_ORDER.map((f) => (
          <button key={f.key} type="button" onClick={() => setShow(f.key)} className={pill(show === f.key)}>
            {f.label}{" "}
            <span className="ml-0.5 rounded-full bg-[rgba(200,151,91,0.18)] px-1.5 py-0.5 font-mono text-[10px] text-gold">
              {countFor(f.key)}
            </span>
          </button>
        ))}
        <span className="ml-3 text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">Sort</span>
        <button type="button" onClick={() => setSort("index")} className={pill(sort === "index")}>
          Index number
        </button>
        <button type="button" onClick={() => setSort("class")} className={pill(sort === "class")}>
          Class
        </button>
        {/* Aggregate sort DISABLED — mock/projection is INCR-16/17, no data here (AC-G). */}
        <button
          type="button"
          disabled
          title="Mock-2 aggregate sort arrives with the mock cycle (INCR-16/17)"
          className="cursor-not-allowed rounded-full border border-border bg-bg px-3 py-1 text-[11px] font-semibold text-navy-3 opacity-60"
        >
          Aggregate
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full border-collapse">
          <thead className="border-b border-border-2 bg-bg text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
            <tr>
              <th className="px-4 py-3 text-left">Candidate</th>
              <th className="px-3 py-3 text-left">Programme</th>
              <th className="px-3 py-3 text-left">Index number</th>
              <th className="px-3 py-3 text-center">Reg. status</th>
              <th className="px-3 py-3 text-left">Notes / accommodation</th>
              <th className="px-4 py-3 text-right">Mock 2 agg.</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={r.id}
                className="border-b border-border align-middle"
                style={
                  r.isLive
                    ? {
                        background:
                          "linear-gradient(90deg, var(--warn-bg) 0%, rgba(245,233,208,0.2) 100%)",
                      }
                    : undefined
                }
              >
                <td
                  className={`px-4 py-3 ${r.isLive ? "border-l-[3px] border-warn" : ""}`}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full font-display text-[10px] font-semibold ${r.avatarClass}`}
                    >
                      {r.initials}
                    </span>
                    <span>
                      <span className="block font-display text-[12px] font-semibold text-navy">
                        {r.name}
                      </span>
                      <span className="block font-mono text-[9px] text-navy-3">{r.studentCode}</span>
                    </span>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <ProgPill programmeKey={r.programmeKey} />
                </td>
                <td className="px-3 py-3">
                  <span className="font-mono text-[11px] font-semibold text-navy">
                    {r.indexNumber}
                    {r.indexSub && (
                      <span className="ml-1.5 text-[8px] uppercase text-navy-3">{r.indexSub}</span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-3 text-center">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${r.regStatusClass}`}
                  >
                    {r.regStatusLabel}
                  </span>
                </td>
                <td className="px-3 py-3 text-[10px] text-navy-3">
                  {r.noteStrong && <b className="text-navy-2">{r.noteStrong}</b>}
                  {r.noteStrong ? ` ${r.note}` : r.note}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-mono text-[11px] font-semibold text-navy">{r.mock2Agg}</span>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-[11px] italic text-navy-3">
                  No candidates match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] italic text-navy-3">
        {visible.length} of {counts.all} candidates · registration frozen · index numbers issued Feb
        2026 · WAEC export ran 14 Feb 2026.
      </p>
    </div>
  );
}
