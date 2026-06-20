import type { Metadata } from "next";
import { OnboardingWizard } from "@/components/onboarding/wizard";

export const metadata: Metadata = {
  title: "Onboard your school",
  description:
    "Set up your school on Omnischools — identity, school type, calendar, structure, staff and billing. Basic schools finish in six steps; SHS adds residency and WAEC. Your GES-standard calendar is configured automatically.",
};

export default function StartPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <div className="mb-7 text-center">
        <div className="mb-3 inline-block text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
          Get started
        </div>
        <h1 className="font-display text-4xl font-semibold text-navy">
          Onboard your{" "}
          <em className="not-italic text-gold [font-style:italic]">school.</em>
        </h1>
        <p className="mt-3 text-base text-navy-2">
          Six short steps — Basic schools finish at six; SHS adds two. No card, no
          commitment — a 30-day trial starts the moment you&apos;re in.
        </p>
      </div>
      <OnboardingWizard />
    </main>
  );
}
