import type { Metadata } from "next";
import { OnboardingWizard } from "@/components/onboarding/wizard";
import type { CardId } from "@/lib/onboarding";

export const metadata: Metadata = {
  title: "Onboard your school",
  description:
    "Set up your school on Omnischools in two quick steps — school type and school identity. Your GES-standard calendar, classes and grade scale are configured automatically; you finish the rest from a guided checklist after signing in.",
};

const VALID_TYPES = ["BASIC", "SENIOR", "MULTI"] as const;

export default async function StartPage(
  props: {
    searchParams: Promise<{ type?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  // A pricing plan may pre-select the school type (?type=BASIC|SENIOR); when it does,
  // the wizard skips straight to School identity.
  const raw = searchParams.type?.toUpperCase();
  const initialType = (VALID_TYPES as readonly string[]).includes(raw ?? "")
    ? (raw as CardId)
    : undefined;

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
          {initialType
            ? "One step — tell us who you are. Your calendar, classes and grade scale come pre-configured; you finish setup from a guided checklist after signing in."
            : "Two short steps — your school type and who you are. Everything else is pre-configured and completed from a guided checklist after you sign in."}{" "}
          No card, no commitment — a 30-day trial starts the moment you&apos;re in.
        </p>
      </div>
      <OnboardingWizard initialType={initialType} />
    </main>
  );
}
