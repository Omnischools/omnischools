import type { Metadata, Viewport } from "next";
import { Fraunces, Manrope, JetBrains_Mono } from "next/font/google";
import "../styles/tokens.css";
import "./globals.css";

// Brand type system (BUILD_STACK.md): Fraunces display, Manrope body, JetBrains Mono data.
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  axes: ["opsz"],
});
const manrope = Manrope({ subsets: ["latin"], display: "swap", variable: "--font-body" });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: {
    default: "Omnischools Oversight — GES district, regional & national monitoring",
    template: "%s · Omnischools Oversight",
  },
  description:
    "Omnischools Oversight is the observational analytics tier for GES district and regional directors and the Ministry of Education — jurisdiction-scoped dashboards over aggregate school data.",
  applicationName: "Omnischools Oversight",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://oversight.omnischools.gh"),
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#13203A",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${manrope.variable} ${jetbrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
