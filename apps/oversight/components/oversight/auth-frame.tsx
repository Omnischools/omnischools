import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * THE PRE-AUTH FRAME (Lucy A.1 / §0, ported 1:1 from Surfaces/schoolup-oversight-onboarding.html).
 *
 * The deep navy is meaningful, not decorative. Lucy's note, kept verbatim because it is the reason
 * this component exists rather than a plain centred card: "A GES officer signing into Oversight
 * should feel they are entering the government oversight tool, not a school's app." It is the same
 * navy as the sidebar, the §6 record head and the append-only banner — the visual signal of the
 * audited, named tier.
 *
 * Every colour is a TOKEN (`tailwind.config.ts` → `styles/tokens.css`). No literal hex, including in
 * the gradient and the two gold radial circles, so a brand change stays one file.
 *
 * There is no `Shell` here on purpose: pre-auth there is no officer, so there is no identity strip
 * and no nav to render. A sign-in page that showed nav items would be implying an access it does not
 * have.
 */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-navy-deep via-navy to-navy-2 px-5 py-12">
      {/* Decorative, and announced as such. */}
      <div
        aria-hidden
        className="bg-gold/10 pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full blur-2xl"
      />
      <div
        aria-hidden
        className="bg-gold/5 pointer-events-none absolute -bottom-32 -right-20 h-80 w-80 rounded-full blur-2xl"
      />
      <div className="relative w-full max-w-[480px]">{children}</div>
    </div>
  );
}

/** The white card the mock centres in the frame: `rounded-[18px]`, generous padding, soft shadow. */
export function AuthCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[18px] border border-border-1 bg-surface p-8 shadow-xl",
        className,
      )}
    >
      {children}
    </section>
  );
}

/**
 * The crest row (mock §01): a 44px navy square with gold Fraunces "GES", beside the two institution
 * lines. `institution` is the second line and varies by tier at national (Lucy G2) — pre-auth we do
 * not know the tier, so the default is the service.
 */
export function AuthCrest({
  institution = "Ghana Education Service",
}: {
  institution?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-11 w-11 items-center justify-center rounded-md bg-navy-deep font-display text-sm font-semibold text-gold">
        GES
      </span>
      <div className="leading-tight">
        <div className="font-display text-base text-navy">Omnischools Oversight</div>
        <div className="text-[9px] uppercase tracking-[0.14em] text-navy-3">
          {institution}
        </div>
      </div>
    </div>
  );
}

/**
 * The "provisioned-by" panel (Lucy A.1 — "the load-bearing, keep-verbatim element").
 *
 * It makes the provisioning model visible on day one: the officer did not register this account and
 * cannot change its role or jurisdiction. Rendered with PLACEHOLDERS when the facts are not known
 * pre-auth, never with invented ones — the provisioning-audit row (Lucy G8.e) is the one
 * authoritative source for the date, the administrator and the node, and nothing here may guess at
 * them. Pre-auth we therefore show the generic form of the statement, which is true for every
 * officer; the specific form appears post-sign-in, where the facts can be read.
 */
export function ProvisionedByPanel({
  date,
  provisioner,
  jurisdiction,
}: {
  date?: string;
  provisioner?: string;
  jurisdiction?: string;
}) {
  const specific = Boolean(date && provisioner && jurisdiction);
  return (
    <div className="mt-6 flex gap-3 rounded-md border border-gold-soft bg-gold-bg p-4">
      <span
        aria-hidden
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-gold font-mono text-[11px] font-bold text-navy-deep"
      >
        P
      </span>
      <p className="text-[11px] leading-relaxed text-navy-2">
        {specific ? (
          <>
            This account was provisioned on <strong>{date}</strong> by{" "}
            <strong>{provisioner}</strong>, and bound to the{" "}
            <strong>{jurisdiction}</strong> jurisdiction. You did not register it and you
            cannot change its role or jurisdiction — both are set by GES.
          </>
        ) : (
          <>
            Oversight accounts are provisioned by the GES Oversight administrator and
            bound to one jurisdiction. You did not register this account and you cannot
            change its role or jurisdiction — both are set by GES.
          </>
        )}
      </p>
    </div>
  );
}

/** The mock's `.field-label` — 10px, uppercase, muted. */
export function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-[10px] uppercase tracking-[0.14em] text-navy-3"
    >
      {children}
    </label>
  );
}

/** The mock's `.field-input` — JetBrains Mono on `bg-bg` with the secondary border. */
export function FieldInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return (
    <input
      {...rest}
      className={cn(
        "mt-1.5 w-full rounded-md border border-border-2 bg-bg px-3 py-2 font-mono text-sm text-navy outline-none focus:border-navy",
        className,
      )}
    />
  );
}

/** The gold full-width primary CTA ("Verify & continue →"). */
export function AuthButton({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, ...props } = rest;
  return (
    <button
      {...props}
      className={cn(
        "mt-6 w-full rounded-md bg-gold px-4 py-2.5 text-sm font-semibold text-navy-deep transition disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** An inline terra error line under a field. Terra IS correct here: a wrong code is a real error. */
export function AuthError({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-xs text-terra">{children}</p>;
}
