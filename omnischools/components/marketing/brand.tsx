import Link from "next/link";
import { cn } from "@/lib/utils";

/** Omnischools wordmark with the navy "O" mark (gold italic on footer variant). */
export function Brand({
  href = "/",
  variant = "light",
}: {
  href?: string;
  variant?: "light" | "dark";
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 font-display text-[22px] font-semibold tracking-[-0.01em]",
        variant === "dark" ? "text-bg" : "text-navy",
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-md font-display text-[15px] font-semibold italic",
          variant === "dark" ? "bg-gold text-navy" : "bg-navy text-gold-soft",
        )}
      >
        O
      </span>
      Omnischools
    </Link>
  );
}
