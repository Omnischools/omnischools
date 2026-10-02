import Link from "next/link";
import { AuthFrame, AuthCard, AuthCrest } from "@/components/oversight/auth-frame";

export const dynamic = "force-dynamic";

export const metadata = { title: "Signed out · Omnischools Oversight" };

/**
 * G3 — the post-sign-out confirmation. Deep-navy frame, compact card, NO destructive styling:
 * signing out is routine, and a red screen would imply something went wrong.
 *
 * It is a separate route rather than a flash message because the sign-out action clears the session
 * cookies — anything rendered inside the app shell at that moment would be rendering a shell with no
 * officer, which is the one state Lucy G2 says a user must never see.
 */
export default function SignedOutPage() {
  return (
    <AuthFrame>
      <AuthCard>
        <AuthCrest />
        <h1 className="mt-6 font-display text-2xl text-navy">
          You&apos;re <em className="accent-italic">signed out.</em>
        </h1>
        <p className="mt-2 text-sm text-navy-2">
          Your Oversight session has ended. Sign in again to continue.
        </p>
        <Link
          href="/sign-in"
          className="mt-6 block w-full rounded-md bg-gold px-4 py-2.5 text-center text-sm font-semibold text-navy-deep"
        >
          Sign in →
        </Link>
      </AuthCard>
    </AuthFrame>
  );
}
