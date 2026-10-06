import Link from "next/link";
import { cn } from "@/lib/utils";
import { initialsOf } from "./breakdown-table";
import type { ChildLevel } from "@/lib/oversight/breakdown";
import { MAX_ENTITIES } from "@/lib/oversight/comparison";
import type { ComparisonEntity } from "@/lib/oversight/comparison-entities";

/**
 * THE COMPARISON PICKER (increment I, Lucy's map §1) — the access model made concrete, URL-driven.
 *
 * Selection lives in the query string (`?e=id,id,…`), so the whole surface is a server component with no
 * client store: add/remove are plain links that rewrite that param. This is the shipped page's "no dead
 * controls" precedent carried forward — every affordance here either changes the URL or is honestly
 * disabled.
 *
 * ═══ THE TIER TOGGLE ENFORCES THE CEILING VISIBLY ═══════════════════════════════════════════════════
 * Exactly ONE tier is active — the entities ONE LEVEL BELOW the officer (`childLevel`). The other two are
 * shown DISABLED, never hidden: the officer sees the option exists and sees it is not theirs, exactly as
 * the mock disables "Regions" for a district director. Same-tier (sibling) comparison is among the
 * disabled ones — it is DEFERRED pending an access ruling, not available in this slice (the scope note
 * says so in words). The toggle is gated on `childLevel`, deliberately NOT on `withinTierCeiling`, which
 * would mark a district officer's "Districts" selectable and then return an empty table.
 *
 * ═══ LIKE-FOR-LEVEL ═══════════════════════════════════════════════════════════════════════════════════
 * The first school picked pins the level; thereafter only same-level schools are offered to add, so a
 * mixed-level comparison (an SHS beside a JHS, WASSCE beside BECE) cannot be assembled (Kofi R2). Above
 * SCHOOL depth every child is already one type, so nothing is pinned and all are offerable.
 */

const TIER_OPTIONS: { label: string; level: ChildLevel }[] = [
  { label: "Schools", level: "SCHOOL" },
  { label: "Districts", level: "DISTRICT" },
  { label: "Regions", level: "REGION" },
];

/** "public · est. 1960" for a school; null for a district/region (nothing to qualify). */
export function entityMeta(entity: ComparisonEntity): string | null {
  const parts: string[] = [];
  if (entity.ownershipType) parts.push(entity.ownershipType.toLowerCase());
  if (entity.foundedYear !== null) parts.push(`est. ${entity.foundedYear}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function hrefFor(basePath: string, ids: string[]): string {
  return ids.length === 0 ? basePath : `${basePath}?e=${ids.join(",")}`;
}

export function ComparisonPicker({
  basePath,
  childLevel,
  entities,
  selectedIds,
  benchmarkLabel,
}: {
  basePath: string;
  childLevel: ChildLevel;
  /** The in-subtree entities the officer may add (already RLS-bounded). */
  entities: ComparisonEntity[];
  /** Selected entity ids, in order — the column order of the table. */
  selectedIds: string[];
  benchmarkLabel: string;
}) {
  const byId = new Map(entities.map((e) => [e.jurisdictionId, e]));
  const selected = selectedIds
    .map((id) => byId.get(id))
    .filter((e): e is ComparisonEntity => e !== undefined);

  // The level pinned by the first valid pick (SCHOOL depth only); null ⇒ nothing pinned yet / above school.
  const pinnedType = selected.find((e) => e.schoolType !== null)?.schoolType ?? null;

  const atCap = selected.length >= MAX_ENTITIES;
  const addable = entities.filter(
    (e) =>
      !selectedIds.includes(e.jurisdictionId) &&
      (pinnedType === null || e.schoolType === pinnedType),
  );

  const childNoun =
    childLevel === "SCHOOL" ? "schools" : childLevel === "DISTRICT" ? "districts" : "regions";

  return (
    <div className="space-y-0 overflow-hidden rounded-xl border border-border-1 bg-surface">
      {/* Tier toggle — one active, the rest honestly disabled. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border-1 px-5 py-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
          Compare
        </span>
        <div className="inline-flex gap-0.5 rounded-md border border-border-2 bg-bg p-0.5">
          {TIER_OPTIONS.map((opt) => {
            const active = opt.level === childLevel;
            return (
              <span
                key={opt.level}
                aria-disabled={!active}
                title={active ? undefined : "Not available at your jurisdiction level"}
                className={cn(
                  "rounded px-3 py-1.5 text-[11px] font-semibold",
                  active ? "bg-navy text-bg" : "cursor-not-allowed text-border-2",
                )}
              >
                {opt.label}
                {/* The title attribute is sighted-only; name the reason for a screen reader too, so the
                    "visible, labelled, not theirs" affordance (Kofi R1.2) is not sight-dependent (Dex N1). */}
                {!active ? (
                  <span className="sr-only"> (not available at your jurisdiction level)</span>
                ) : null}
              </span>
            );
          })}
        </div>
      </div>

      {/* Selected set — entity chips (removable) + the pinned benchmark chip. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border-1 bg-bg px-5 py-4">
        {selected.length === 0 ? (
          <span className="text-[11px] italic text-navy-3">
            No {childNoun} selected yet — add from the list below to build a comparison.
          </span>
        ) : null}

        {selected.map((entity, i) => {
          const remaining = selectedIds.filter((id) => id !== entity.jurisdictionId);
          const anchor = i === 0;
          return (
            <span
              key={entity.jurisdictionId}
              className="flex items-center gap-2 rounded-lg border border-border-2 bg-surface py-1.5 pl-2 pr-2.5"
            >
              <span
                aria-hidden
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-md font-display text-[10px] font-semibold",
                  anchor ? "bg-gold text-navy" : "bg-navy text-bg",
                )}
              >
                {initialsOf(entity.name)}
              </span>
              <span className="leading-tight">
                <span className="block text-[11.5px] font-bold text-navy">{entity.name}</span>
                {entityMeta(entity) ? (
                  <span className="block text-[9px] font-semibold text-navy-3">
                    {entityMeta(entity)}
                  </span>
                ) : null}
              </span>
              <Link
                href={hrefFor(basePath, remaining)}
                aria-label={`Remove ${entity.name}`}
                className="flex h-4 w-4 items-center justify-center rounded-full bg-bg text-[11px] font-bold text-navy-3 hover:bg-terra-bg hover:text-terra"
              >
                ×
              </Link>
            </span>
          );
        })}

        {selected.length > 0 ? (
          // The pinned benchmark — styled apart (navy), not removable: it is the reference line, present
          // whenever there is anything to read it against.
          <span className="flex items-center gap-2 rounded-lg border border-navy bg-navy py-1.5 pl-2 pr-3">
            <span
              aria-hidden
              className="flex h-7 w-7 items-center justify-center rounded-md bg-gold font-display text-[10px] font-semibold text-navy"
            >
              Ø
            </span>
            <span className="leading-tight">
              <span className="block text-[11.5px] font-bold text-bg">{benchmarkLabel}</span>
              <span className="block text-[9px] font-semibold text-gold-soft">
                benchmark · pinned
              </span>
            </span>
          </span>
        ) : null}
      </div>

      {/* Add area — level-pinned, cap-enforced. */}
      <div className="px-5 py-4">
        {atCap ? (
          <p className="text-[10.5px] font-semibold text-navy-3">
            Maximum of {MAX_ENTITIES} {childNoun} selected — remove one to add another. Beyond eight a
            comparison stops being legible.
          </p>
        ) : addable.length === 0 ? (
          <p className="text-[10.5px] italic text-navy-3">
            {selected.length === 0
              ? `No ${childNoun} are available to compare in your jurisdiction.`
              : `No more same-level ${childNoun} to add.`}
          </p>
        ) : (
          <>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
              {pinnedType ? `Add ${pinnedType} ${childNoun}` : `Add ${childNoun}`}
            </p>
            <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
              {addable.map((entity) => (
                <Link
                  key={entity.jurisdictionId}
                  href={hrefFor(basePath, [...selectedIds, entity.jurisdictionId])}
                  className="rounded-lg border border-dashed border-border-2 px-3 py-1.5 text-[11px] font-semibold text-navy-2 hover:border-gold hover:bg-gold-bg"
                >
                  + {entity.name}
                  {entity.schoolType ? (
                    <span className="ml-1.5 text-[9px] font-semibold text-navy-3">
                      {entity.schoolType}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
