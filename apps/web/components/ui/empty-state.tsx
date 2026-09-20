import Link from "next/link";
import { cn } from "@/lib/utils";

export type EmptyAction = {
  label: string;
  href?: string;
  variant?: "gold" | "navy" | "outline" | "link";
};

const ACTION_CLASS: Record<NonNullable<EmptyAction["variant"]>, string> = {
  gold: "rounded-md bg-gold px-4 py-2 text-sm font-semibold text-navy transition-colors hover:bg-gold-soft",
  navy: "rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep",
  outline:
    "rounded-md border border-gold px-4 py-2 text-sm font-semibold text-gold transition-colors hover:bg-gold-bg",
  link: "text-sm font-semibold text-gold hover:underline",
};

function Action({ action }: { action: EmptyAction }) {
  const cls = ACTION_CLASS[action.variant ?? "gold"];
  return action.href ? (
    <Link href={action.href} className={cls}>
      {action.label}
    </Link>
  ) : (
    <span className={cls}>{action.label}</span>
  );
}

/**
 * Shared empty-state primitive (replicates the schoolup-empty-states surfaces).
 * - `tone="muted"` = the calm single-line dashed card used across the app today.
 * - `tone="default"` = a centered dashed card with optional icon tile, eyebrow,
 *   Fraunces title (pass an <em> for the gold-italic accent), body, meta and actions.
 * - `tone="navy"` = the celebratory day-one hero treatment.
 * Icons accept a lucide node OR a serif glyph string (rendered in the gold tile).
 */
export function EmptyState({
  icon,
  eyebrow,
  title,
  body,
  meta,
  primary,
  secondary,
  tone = "default",
  framed = true,
  className,
  children,
}: {
  icon?: React.ReactNode;
  eyebrow?: string;
  title?: React.ReactNode;
  body?: React.ReactNode;
  meta?: string;
  primary?: EmptyAction;
  secondary?: EmptyAction;
  tone?: "default" | "navy" | "muted";
  framed?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  if (tone === "muted") {
    return (
      <p
        className={cn(
          "rounded-xl border border-dashed border-border-2 bg-surface p-8 text-center text-sm text-navy-3",
          className,
        )}
      >
        {body ?? children}
      </p>
    );
  }

  const navy = tone === "navy";
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl p-10 text-center",
        framed && (navy ? "border border-navy bg-navy" : "border border-dashed border-border-2 bg-surface"),
        className,
      )}
    >
      {icon != null && (
        <div
          aria-hidden
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-[10px] font-display text-lg font-bold",
            navy ? "bg-white/10 text-gold" : "bg-gold-bg text-gold",
          )}
        >
          {icon}
        </div>
      )}
      {eyebrow && (
        <div
          className={cn(
            "text-[10px] font-bold uppercase tracking-[0.14em]",
            navy ? "text-gold-soft" : "text-gold",
          )}
        >
          {eyebrow}
        </div>
      )}
      {title && (
        <h3 className={cn("font-display text-lg font-semibold", navy ? "text-bg" : "text-navy")}>
          {title}
        </h3>
      )}
      {(body ?? children) && (
        <p
          className={cn(
            "max-w-md text-sm leading-relaxed",
            navy ? "text-gold-soft" : "text-navy-2",
          )}
        >
          {body ?? children}
        </p>
      )}
      {meta && (
        <div
          className={cn(
            "text-[10px] font-bold uppercase tracking-[0.1em]",
            navy ? "text-gold-soft" : "text-navy-3",
          )}
        >
          {meta}
        </div>
      )}
      {(primary || secondary) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
          {primary && <Action action={primary} />}
          {secondary && (
            <Action action={{ ...secondary, variant: secondary.variant ?? "link" }} />
          )}
        </div>
      )}
    </div>
  );
}
