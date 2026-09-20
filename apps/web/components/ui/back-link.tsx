import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * App-wide back link: "← {label}" → href. The shared version of the ad-hoc
 * `← Label` links used across the app. Navy-3, gold on hover, with the arrow
 * nudging left on hover. Hidden in print. Pass `className` for placement (margin).
 */
export function BackLink({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group inline-flex items-center gap-1.5 text-sm text-navy-3 transition-colors hover:text-gold print:hidden",
        className,
      )}
    >
      <span aria-hidden className="transition-transform group-hover:-translate-x-0.5">
        ←
      </span>
      {label}
    </Link>
  );
}
