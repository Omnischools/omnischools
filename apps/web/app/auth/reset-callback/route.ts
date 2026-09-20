import { NextResponse } from "next/server";
import { establishRecoverySession } from "@/lib/auth";

/**
 * INCR-36 (L3) — the EMAIL recovery-link landing (Route Handler). Supabase's password-reset link carries
 * a PKCE `?code=…`. The exchange MUST run HERE, not in the `/reset-password` Server Component: only a
 * route handler / server action can PERSIST the session cookie (a Server Component's cookie write is a
 * silent no-op — `lib/supabase/server.ts` `setAll` catch, and there is no session-refresh middleware).
 * We exchange (which sets the recovery-session cookie on this response), then redirect to
 * `/reset-password`, which reads that session and renders the set-new-password form. On a missing/failed
 * exchange we redirect with `?error=1` → the page shows the unavailable state. The exchange stays behind
 * the `lib/auth` seam (`establishRecoverySession`); feature code never touches `supabase.auth.*`.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const { origin, searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/reset-password?error=1", origin));
  const res = await establishRecoverySession(code);
  return NextResponse.redirect(
    new URL(res.ok ? "/reset-password" : "/reset-password?error=1", origin),
  );
}
