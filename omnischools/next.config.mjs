/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @react-pdf/renderer (receipt/report-card PDFs) is a Node-only lib pulling in fontkit;
  // keep it out of the webpack bundle so the server route can require it at runtime.
  serverExternalPackages: ["@react-pdf/renderer"],
  // Portability (BUILD_STACK): keep image optimisation host-agnostic.
  images: {
    remotePatterns: [
      // Supabase Storage (served via our own API route in app code).
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
  // Don't leak host-specific build details.
  poweredByHeader: false,
};

export default nextConfig;
