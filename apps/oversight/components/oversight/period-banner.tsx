import type { ReactNode } from "react";

/**
 * THE PERIOD / DATA-FRESHNESS BANNER (Lucy §3.2 `.period-banner`).
 *
 * Built inline rather than through the `Banner` primitive — Lucy's option (b). `Banner` has no
 * right-aligned aside slot and carries `rounded-[14px] border-[1.5px]` against this element's
 * `rounded-[10px] border`, and the aside is the half that matters: "next sync" is the one piece of
 * chrome that tells an officer whether the figures they are reading are about to change.
 *
 * GOLD IS INFORMATIONAL HERE, NEVER AN ERROR (§3.2). This banner states which period the page is a
 * view of; it does not warn. Partial coverage is an always-on state, not a fault, so nothing on this
 * surface switches it to `warn`/`terra` tones.
 *
 * All copy is passed IN, because every figure in it (the academic year, the term, the sync vintage,
 * the sitting year, the region count) is computed from the database at request time. A component that
 * owned the sentence would own the numbers in it, and that is how a mock placeholder becomes a lie.
 */
export function PeriodBanner({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start gap-[14px] rounded-[10px] border border-gold-soft bg-gold-bg px-[18px] py-3">
      <span
        aria-hidden
        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md bg-gold font-display italic text-navy"
      >
        i
      </span>
      <div className="min-w-[16rem] flex-1 text-xs leading-[1.5] text-navy-2">
        {children}
      </div>
      {aside ? (
        <div className="ml-auto text-[10px] font-semibold text-navy-3 sm:text-right">
          {aside}
        </div>
      ) : null}
    </div>
  );
}
