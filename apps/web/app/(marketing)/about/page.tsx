import type { Metadata } from "next";
import { About } from "@/components/marketing/about";

export const metadata: Metadata = {
  title: "About",
  description:
    "Omnischools is built in Ghana, for the way Ghanaian schools actually run — mobile money first, WAEC/NaCCA-aligned, data resident in Ghana.",
};

export default function AboutPage() {
  return (
    <main>
      <About />
    </main>
  );
}
