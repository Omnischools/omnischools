import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { BOARDING_ROLES, hasAnyRole } from "@/lib/access";
import { getHouseRoster } from "@/lib/boarding/roster-data";
import { isLightColour } from "@/lib/boarding/roster";
import { RosterBoard } from "@/components/boarding/roster-board";

export const dynamic = "force-dynamic";

const GENDER_PILL: Record<"BOYS" | "GIRLS" | "COED", { label: string; cls: string }> = {
  BOYS: { label: "Boys", cls: "bg-navy text-bg" },
  GIRLS: { label: "Girls", cls: "bg-terra text-bg" },
  COED: { label: "Mixed", cls: "bg-gold text-navy" },
};

function crestInitial(name: string) {
  return name.charAt(0).toUpperCase();
}

export default async function HouseRosterPage({ params }: { params: { houseId: string } }) {
  const { school, user } = await requireSchoolRole(BOARDING_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  // Reload roles/id for the house-scope guard (dev bypass returns a fixed ADMIN user).
  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  const userId = current?.id ?? user.id;

  const roster = await getHouseRoster(school.id, params.houseId, roles, userId);
  if (!roster) notFound();

  const { house, summary, dorms, prefects, unallocated, swaps, swapsThisSem, currentTermLabel } =
    roster;
  const canReassign = hasAnyRole(roles, BOARDING_ROLES);
  const light = isLightColour(house.colour);
  const strip = {
    backgroundColor: house.colour ?? "var(--navy)",
    color: light ? "var(--navy)" : "var(--bg)",
  } as const;
  const gender = house.gender ? GENDER_PILL[house.gender] : null;

  return (
    <div className="mx-auto max-w-page pb-16">
      <div className="mb-5">
        <Link
          href="/senior/boarding"
          className="text-[11px] font-semibold uppercase tracking-[0.16em] text-navy-3 hover:text-navy"
        >
          ← Boarding · Houses
        </Link>
      </div>

      {/* House identity strip — house.colour is USER DATA, inline style only, never a token. */}
      <div
        className={`flex flex-wrap items-center gap-4 rounded-t-xl px-6 py-5 ${
          light ? "border-2 border-b-0 border-border-2" : ""
        }`}
        style={strip}
      >
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-bg font-display text-xl font-bold"
          style={{ color: house.colour ?? "var(--navy)" }}
        >
          {crestInitial(house.name)}
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] opacity-80">
            House
            {gender && (
              <span
                className={`rounded-pill px-2 py-0.5 text-[9px] font-bold tracking-[0.08em] ${gender.cls}`}
              >
                {gender.label}
              </span>
            )}
          </div>
          <h1 className="font-display text-2xl font-semibold leading-tight">{house.name} House</h1>
        </div>
        <div className="flex gap-6 text-right">
          <Stat label="Capacity" value={house.capacity ?? "—"} />
          <Stat label="Boarders" value={summary.boarderCount} />
          <Stat label="Filled" value={summary.filled} />
          <Stat label="Vacant" value={summary.vacant} />
        </div>
      </div>

      {/* Header row */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-x border-border bg-surface px-6 py-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">
            Boarding &amp; residential life · Houses · {house.name} · Roster &amp; bunk allocation
          </div>
          <h2 className="mt-1 font-display text-xl font-semibold text-navy">
            Roster · <em className="italic text-gold">today&apos;s bed map</em>
          </h2>
          <div className="mt-1 text-[12px] text-navy-3">
            {dorms.length} {dorms.length === 1 ? "dormitory" : "dormitories"} ·{" "}
            {summary.totalBunks} bunks · resident HM {house.hmName ?? "unassigned"}
            {currentTermLabel ? ` · ${currentTermLabel}` : ""}
          </div>
        </div>
        <Link
          href={`/senior/boarding/houses/${house.id}/today`}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-[13px] font-semibold text-navy hover:border-gold hover:text-gold"
        >
          Today&apos;s operational view →
        </Link>
      </div>

      {/* Summary strip — every number derived from data, nothing hard-coded. */}
      <div className="grid grid-cols-2 gap-3 border-x border-border bg-bg px-6 py-5 md:grid-cols-5">
        <SumCard featured label={`Total boarders · ${house.name}`} big={summary.boarderCount}>
          {summary.unallocatedCount > 0
            ? `${summary.unallocatedCount} awaiting a bunk`
            : "all allocated"}
        </SumCard>
        <SumCard label="Vacant bunks" big={summary.vacant}>
          of {summary.totalBunks} total
        </SumCard>
        <SumCard label="Prefects in House" big={summary.prefectCount}>
          {prefects.filter((p) => !p.occupant).length} role(s) unfilled
        </SumCard>
        <SumCard warn={summary.flaggedCount > 0} label="Pastoral flags" big={summary.flaggedCount}>
          {summary.flaggedCount > 0 ? "active (VLC module pending)" : "none active"}
        </SumCard>
        <SumCard label="Swaps this semester" big={swapsThisSem}>
          {summary.movedThisSemCount} moved-in this semester
        </SumCard>
      </div>

      {/* Prefect strip · unallocated tray · dorm grid · detail card · reassign (interactive). */}
      <div className="rounded-b-xl border-x border-b border-border bg-surface px-6 py-6">
        <RosterBoard
          house={{ id: house.id, name: house.name, gender: house.gender }}
          dorms={dorms}
          unallocated={unallocated}
          prefects={prefects}
          canReassign={canReassign}
        />

        {/* Swap log — append-only allocation history, newest-first (AC C5). */}
        <div className="mt-8">
          <div className="mb-3 flex items-end justify-between border-b border-border pb-2">
            <h3 className="font-display text-lg font-semibold text-navy">
              Bunk swap log · <em className="italic text-gold">this House</em>
            </h3>
            <span className="text-[11px] text-navy-3">
              {swaps.length} recorded · {swapsThisSem} this semester
            </span>
          </div>
          {swaps.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border-2 bg-bg px-4 py-6 text-center text-sm text-navy-3">
              No bunk reassignments recorded yet.
            </p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {swaps.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]">
                  <span className="font-semibold text-navy">{s.studentName}</span>
                  <span className="font-mono text-[11px] text-navy-3">
                    {s.fromAddress ?? "—"} → {s.toAddress ?? "—"}
                  </span>
                  <span className="text-navy-2">· {s.reason}</span>
                  <span className="ml-auto text-[11px] text-navy-3">
                    {s.staffName ?? "—"} · {s.atLabel}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-[9px] font-bold uppercase tracking-[0.08em] opacity-70">{label}</div>
      <div className="mt-0.5 font-display text-lg font-semibold">{value}</div>
    </div>
  );
}

function SumCard({
  label,
  big,
  children,
  featured,
  warn,
}: {
  label: string;
  big: string | number;
  children: React.ReactNode;
  featured?: boolean;
  warn?: boolean;
}) {
  const tone = featured
    ? "bg-navy text-bg border-navy"
    : warn
      ? "bg-warn-bg border-warn"
      : "bg-surface border-border";
  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <div
        className={`text-[10px] font-bold uppercase tracking-[0.12em] ${
          featured ? "text-gold-soft" : warn ? "text-warn" : "text-navy-3"
        }`}
      >
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-semibold leading-none">{big}</div>
      <div
        className={`mt-1.5 text-[11px] ${
          featured ? "text-gold-soft" : warn ? "text-warn" : "text-navy-3"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
