import Link from "next/link";
import { authIsLive, getCurrentUser } from "@/lib/auth";
import { SetNewPassword } from "@/components/auth/set-new-password";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set a new password" };

const Shell = ({ children }: { children: React.ReactNode }) => (
  <main className="mx-auto flex min-h-[80vh] max-w-content items-center justify-center px-6 py-16">
    <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-7 shadow-md">
      {children}
    </div>
  </main>
);

/**
 * INCR-36 (L3) — the EMAIL-link landing. The PKCE `?code=…` was already exchanged for a recovery session
 * by the `/auth/reset-callback` Route Handler (which redirected here); THIS page only READS that session
 * (a Server Component can read cookies) and renders the set-new-password form. No exchange happens here —
 * that is why the cookie now persists (see the route handler docblock). No session / a failed exchange
 * (`?error=1`) / an ordinary visit with no recovery → the unavailable state. `completePasswordReset`
 * re-checks the session's `amr` as the real boundary (R276). Supabase mints + owns the token — no token
 * row on our side (seam-only). Dev-bypass shows a "not yet configured" notice, never a live form.
 */
export default async function ResetPasswordPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!authIsLive()) {
    return (
      <Shell>
        <h1 className="font-display text-2xl font-semibold text-navy">Set a new password</h1>
        <p className="mt-2 text-sm text-navy-3">
          Email password reset activates once Supabase Auth is configured. In dev mode you can sign in
          straight into the app.
        </p>
        <Link href="/login" className="mt-4 inline-block text-sm font-semibold text-gold">
          Go to sign in →
        </Link>
      </Shell>
    );
  }

  const { error } = await props.searchParams;
  // The callback set (or failed to set) the recovery-session cookie; here we only read it. A live
  // session ⇒ the exchange succeeded ⇒ show the form. Missing/failed ⇒ unavailable.
  const user = error ? null : await getCurrentUser();

  if (!user) {
    return (
      <Shell>
        <h1 className="font-display text-2xl font-semibold text-navy">Link unavailable</h1>
        <p className="mt-2 text-sm text-navy-3">
          This reset link isn&apos;t valid or has expired — request a new one.
        </p>
        <Link href="/reset" className="mt-4 inline-block text-sm font-semibold text-gold">
          Go to reset →
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <SetNewPassword redirectTo="/login?reset=1" />
    </Shell>
  );
}
