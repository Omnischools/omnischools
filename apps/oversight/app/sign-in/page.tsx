import { isSupabaseAuthConfigured } from "@/lib/env";
import { AuthFrame, AuthCard, AuthCrest } from "@/components/oversight/auth-frame";
import { Banner } from "@/components/oversight/primitives";
import { AUTH_UNAVAILABLE_COPY } from "@/lib/auth/mfa";
import { safeReturnPath } from "@/lib/auth/route-guard";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in · Omnischools Oversight" };

/**
 * G1 — the sign-in route. PRE-AUTH: the deep-navy frame replaces the shell (there is no officer yet,
 * so no identity strip and no nav).
 *
 * The route is in `PRE_AUTH_PATHS` (lib/auth/route-guard.ts), which is the only reason the middleware
 * lets it render. An already-signed-in officer who lands here is redirected to the landing by the
 * same guard, so this page never has to think about that case.
 *
 * ⚠ THE UNAVAILABLE STATE IS A REFUSAL, NOT A FORM. With the Supabase vars unset there is nothing to
 * authenticate against, so the card says so instead of rendering fields that cannot work. That is
 * the `.env`-driven half of "Supabase vars are REQUIRED at runtime when the bypass is off": the app
 * still BUILDS without them (lib/env.ts keeps them optional for exactly that reason) and still
 * boots, but it cannot admit anybody, and it says which variables are missing in the server log
 * rather than looking like a credential problem to every officer who tries.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const params = await searchParams;
  const next = safeReturnPath(params.next ?? null);
  const reason = params.reason ?? null;

  if (!isSupabaseAuthConfigured()) {
    return (
      <AuthFrame>
        <AuthCard>
          <AuthCrest />
          <div className="mt-6">
            <Banner tone="gold" glyph="⊘" title="Sign-in unavailable.">
              {AUTH_UNAVAILABLE_COPY}
            </Banner>
          </div>
          <p className="mt-4 text-[11px] text-navy-3">
            This is a deployment configuration issue, not a problem with your account. No
            Oversight surface will open until it is resolved — which is the intended
            behaviour: an unauthenticated request must never reach a named record.
          </p>
        </AuthCard>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <SignInForm next={next} reason={reason} />
    </AuthFrame>
  );
}
