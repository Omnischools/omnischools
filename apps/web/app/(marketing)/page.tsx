import { Hero } from "@/components/marketing/hero";
import { Features } from "@/components/marketing/features";
import { About } from "@/components/marketing/about";
import { Pricing } from "@/components/marketing/pricing";
import { ContactSection } from "@/components/marketing/contact-form";
import { Faq } from "@/components/marketing/faq";

export default function HomePage() {
  return (
    <main>
      <Hero />
      <Features />
      <About />
      <Pricing />
      <ContactSection
        eyebrow="See it in action"
        heading="Book a 30-minute demo."
        intro="We'll walk through the modules that matter for your school's size and level, answer questions on mobile money setup or data migration, and show how Omnischools handles the workflows you're stuck on today."
      />
      <Faq />
    </main>
  );
}
