import type { Metadata } from "next";
import { ResetForm } from "@/components/auth/reset-form";

export const metadata: Metadata = {
  title: "Reset password",
  description: "Reset your Omnischools password by phone code or email link.",
};

export const dynamic = "force-dynamic";

/**
 * INCR-36 (L3) — the forgot-password reset flow. Both prove-identity paths are offered (phone code /
 * email link) and chosen by the user, not auto-routed. The PHONE path is fully exercisable under
 * AUTH_DEV_BYPASS (the OTP console-degrades); the email path shows its enumeration-safe confirmation in
 * every mode but can only send a real link once Supabase Auth is configured. Same chrome as login/accept.
 */
export default function ResetPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-content items-center justify-center px-6 py-20">
      <ResetForm />
    </main>
  );
}
