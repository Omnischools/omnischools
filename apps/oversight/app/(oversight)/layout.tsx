import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getAuthContext, officerChrome } from "@/lib/auth";
import { signOutAction } from "@/app/sign-in/actions";
import { Shell, PageBody, PageHead } from "@/components/oversight/shell";
import { Banner } from "@/components/oversight/primitives";

export const dynamic = "force-dynamic";

/**
 * THE AUTHORIZATION HALF of route protection (the authentication half is `middleware.ts`).
 *
 * Middleware proves there is a verified, MFA'd, unexpired Supabase session; it cannot reach the
 * analytics database, so it cannot know whether that person is a provisioned officer or what they
 * may see. This layout resolves that, once, for every surface in the group — so a page added to
 * `(oversight)` inherits the check without its author writing a line.
 *
 * THREE OUTCOMES, and nothing else:
 *   · an officer            → the shell with a real identity strip (Lucy G2) and the page.
 *   · authenticated, not provisioned (or withdrawn) → Lucy G4, in a degraded shell with no nav.
 *   · no session at all     → redirect to sign-in. Should already have happened in middleware; this
 *                             is the backstop for any path the matcher does not cover, and for the
 *                             case where a session ends between the middleware check and the render.
 *
 * ⚠ THE PAGES KEEP THEIR OWN REFUSAL COPY. Each gated surface still calls `getOfficerSession()` and
 * still renders its own "Sign in required" state. That is not redundancy to be tidied away: this
 * layout protects the GROUP, while those checks protect the FUNCTION — the gate's server actions can
 * be invoked without ever rendering the layout, and `requireOfficerSession()` is what refuses them.
 */
export default async function OversightLayout({ children }: { children: ReactNode }) {
  const context = await getAuthContext();

  if (context.officer) {
    return (
      <Shell identity={officerChrome(context.officer)} signOut={signOutAction}>
        {children}
      </Shell>
    );
  }

  // Authenticated, but the database did not resolve an officer. Lucy G4 — and NOT a 403: the
  // sign-in genuinely succeeded and the person has done nothing wrong. Calm gold, never terra.
  if (context.authenticated && context.reason === "unprovisioned") {
    return (
      <Shell
        identity={{
          name: context.authenticatedName ?? "Signed in",
          role: "Oversight account",
          tier: "Pending set-up",
          institution: "Ghana Education Service",
          jurisdiction: "Pending set-up",
        }}
        showNav={false}
        signOut={signOutAction}
      >
        <PageHead
          crumb="Account"
          title={
            <>
              Almost <em className="accent-italic">there.</em>
            </>
          }
          lede="Your GES identity is verified. Oversight access is granted per person by the Oversight administrator."
        />
        <PageBody>
          <Banner tone="gold" glyph="⊘" title="Your access isn't set up yet.">
            {/* Owner-provided stem — keep verbatim. */}
            Your sign-in succeeded, but your Oversight access hasn&apos;t been set up yet.
            Contact the Oversight administrator.
          </Banner>
          {/*
            R4 (owner-ratify): the contact is a PLACEHOLDER LABEL on purpose. Lucy's map is explicit
            that it is unconfirmed whether this is the MoE Oversight desk or Omnischools support, and
            an invented email address on a government tool's locked-out screen is worse than an
            honest placeholder — it sends people somewhere nobody is reading.
          */}
          <p className="text-xs text-navy-2">
            Contact: the Oversight administrator (contact details pending — owner to
            confirm whether this is the MoE Oversight desk or Omnischools support).
          </p>
          <p className="text-xs text-navy-3">
            This is not an error. Access is granted per person by the Oversight
            administrator once your appointment is on record.
          </p>
          {/*
            ⚠ DEVIATION FROM LUCY G5, DELIBERATE AND FLAGGED. A WITHDRAWN officer sees this same
            screen rather than the distinct "your access has been withdrawn" wording.
            `ov_resolve_officer()` returns zero rows for an unprovisioned uid and for a deactivated
            one alike — policies.sql calls that out as "not an account-state oracle" — so telling the
            two apart in the UI would need an app-reachable read that confirms a directory row
            exists for a uid, which is precisely the enumeration surface the officer directory is
            designed to withhold. The copy above is true in both cases, and the administrator the
            officer is pointed at can see the provisioning log. Reinstating G5's distinct wording is
            an owner/Wells decision about that trade, not something to work around here.
          */}
        </PageBody>
      </Shell>
    );
  }

  // No verified session (or one we could not measure). Middleware normally catches this; carry the
  // reason so the sign-in screen can say WHY rather than appearing out of nowhere (Lucy G6).
  const reason =
    context.reason === "expired-absolute"
      ? "expired"
      : context.reason === "expired-idle"
        ? "idle"
        : context.reason === "mfa-required"
          ? "mfa"
          : context.reason === "auth-unavailable"
            ? "unavailable"
            : null;
  redirect(reason ? `/sign-in?reason=${reason}` : "/sign-in");
}
