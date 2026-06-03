import type { Metadata } from "next";
import { ContactSection } from "@/components/marketing/contact-form";

export const metadata: Metadata = {
  title: "Book a demo",
  description:
    "Book a 30-minute Omnischools demo, or reach out about GES Oversight. We respond within one working day.",
};

export default function ContactPage() {
  return (
    <main className="pt-8">
      <ContactSection
        eyebrow="Talk to us"
        heading="Book a 30-minute demo."
        intro="Tell us about your school and what you're trying to solve. We'll tailor the session to your size and level — Basic, Senior, or GES Oversight — and route you to the right person."
      />
    </main>
  );
}
