import type { Metadata } from "next";
import { Faq } from "@/components/marketing/faq";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Answers to what Ghanaian schools actually ask about Omnischools — setup time, offline use, mobile money, data residency, STPSHS, and SSP.",
};

export default function FaqPage() {
  return (
    <main>
      <Faq />
    </main>
  );
}
