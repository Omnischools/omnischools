import type { Metadata } from "next";
import { Pricing } from "@/components/marketing/pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Omnischools pricing — GHS 10/student/term for Basic, GHS 20/student/semester for Senior, custom for GES Oversight. No setup fees, no minimums.",
};

export default function PricingPage() {
  return (
    <main>
      <Pricing />
    </main>
  );
}
