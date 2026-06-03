import type { Metadata } from "next";
import { OnboardingWizard } from "@/components/onboarding/wizard";

export const metadata: Metadata = {
  title: "Onboard your school",
  description:
    "Set up your school on Omnischools in a few steps — details, product, headmaster, and admin. Your GES-standard academic calendar is configured automatically.",
};

export default function StartPage() {
  return (
    <main className="mx-auto max-w-content px-6 py-16">
      <div className="mb-8 text-center">
        <div className="mb-3 inline-block text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
          Get started
        </div>
        <h1 className="font-display text-4xl font-semibold text-navy">
          Onboard your{" "}
          <em className="not-italic text-gold [font-style:italic]">school.</em>
        </h1>
        <p className="mt-3 text-base text-navy-2">
          Five short steps. No card, no commitment — a 30-day trial starts the moment
          you&apos;re in.
        </p>
      </div>
      <OnboardingWizard />
    </main>
  );
}
