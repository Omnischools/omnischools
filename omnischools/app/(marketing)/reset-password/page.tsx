import Link from "next/link";
import { authIsLive, establishRecoverySession } from "@/lib/auth";
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
 * INCR-36 (L3) — the EMAIL-link landing. The recovery link Supabase emails carries a PKCE `?code=…`;
 * we exchange it for a recovery session, then let the user set a new password (→ /login?reset=1).
 * Supabase mints + owns the token — no token row on our side (seam-only). Dev-bypass shows a "not yet
 * configured" notice, not a live form; a missing/invalid/expired code shows the unavailable shell
 * (mirrors accept/[token]). NB (Sarah / wiring): the code-exchange runs in a Server-Component render,
 * which cannot persist the session cookie in production — this path is structurally-verified only; the
 * live fix is a Route Handler / Server Action exchange. Flagged.
 */
export default async function ResetPasswordPage(props: {
  searchParams: Promise<{ code?: string }>;
}) {
  // Dev bypass: no real Supabase / recovery link exists — mirror login's dev notice, never a live form.
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

  const { code } = await props.searchParams;
  const recovery = code ? await establishRecoverySession(code) : { ok: false };

  if (!recovery.ok) {
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
