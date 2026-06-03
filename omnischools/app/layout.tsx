import type { Metadata, Viewport } from "next";
import { Fraunces, Manrope, JetBrains_Mono } from "next/font/google";
import { PwaRegister } from "@/components/pwa-register";
import "../styles/tokens.css";
import "./globals.css";

// Brand type system (BUILD_STACK.md): Fraunces display, Manrope body, JetBrains Mono data.
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  axes: ["opsz"],
});
const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: {
    default: "Omnischools — School management for Ghana",
    template: "%s · Omnischools",
  },
  description:
    "Omnischools is a multi-tenant school-management system built for Ghanaian schools — admissions, fees, attendance, gradebook, and parent communication.",
  manifest: "/manifest.webmanifest",
  applicationName: "Omnischools",
};

export const viewport: Viewport = {
  themeColor: "#1A2B47",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${manrope.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
