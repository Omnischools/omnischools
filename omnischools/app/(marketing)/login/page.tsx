import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Log in",
  description: "Sign in to manage your school on Omnischools.",
};

// Placeholder: phone-OTP sign-in is wired with the app tier (Phase 3). The auth
// interface already exists at lib/auth; this page becomes the real login then.
export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-content flex-col items-center justify-center px-6 py-24 text-center">
      <h1 className="mb-3 font-display text-4xl font-semibold text-navy">
        Welcome <em className="not-italic text-gold [font-style:italic]">back.</em>
      </h1>
      <p className="mb-8 max-w-[420px] text-base text-navy-2">
        Phone sign-in (OTP) opens together with your school&apos;s app dashboard. If
        you&apos;re setting up a new school, start here.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link
          href="/start"
          className="text-bg rounded-md bg-navy px-6 py-3 text-sm font-semibold transition-colors hover:bg-navy-deep"
        >
          Onboard a school
        </Link>
        <Link
          href="/contact"
          className="border-border-2 hover:bg-surface rounded-md border px-6 py-3 text-sm font-semibold text-navy transition-colors"
        >
          Talk to us
        </Link>
      </div>
    </main>
  );
}
