import type { Metadata } from "next";
import Link from "next/link";
import { authIsLive } from "@/lib/auth";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Log in",
  description: "Sign in to manage your school on Omnischools.",
};

export const dynamic = "force-dynamic";

export default function LoginPage() {
  // Live: real Supabase phone-OTP. Dev bypass: a shortcut into the app.
  if (authIsLive()) {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-content items-center justify-center px-6 py-20">
        <LoginForm />
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-content flex-col items-center justify-center px-6 py-24 text-center">
      <h1 className="mb-3 font-display text-4xl font-semibold text-navy">
        Welcome <em className="not-italic text-gold [font-style:italic]">back.</em>
      </h1>
      <p className="mb-8 max-w-[420px] text-base text-navy-2">
        Phone sign-in (OTP) activates once Supabase Auth is configured. In dev mode you
        can jump straight into the app.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link
          href="/dashboard"
          className="text-bg rounded-md bg-navy px-6 py-3 text-sm font-semibold transition-colors hover:bg-navy-deep"
        >
          Continue to dashboard (dev)
        </Link>
        <Link
          href="/start"
          className="border-border-2 rounded-md border px-6 py-3 text-sm font-semibold text-navy transition-colors hover:bg-gold-bg"
        >
          Onboard a school
        </Link>
      </div>
    </main>
  );
}
