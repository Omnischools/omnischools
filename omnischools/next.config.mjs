/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @react-pdf/renderer (receipt/report-card PDFs) is a Node-only lib pulling in fontkit;
  // keep it out of the webpack bundle so the server route can require it at runtime.
  serverExternalPackages: ["@react-pdf/renderer"],
  // No `images.remotePatterns` on purpose: with none configured, the optimiser
  // refuses every remote URL, so /_next/image can only ever transform files we
  // ship in public/. The two Supabase-hosted images we render (school logo and
  // stamp) go through plain <img>, never next/image, so nothing needs an entry
  // here. Do NOT add a wildcard host — `*.supabase.co` matches any Supabase
  // project, which lets anyone with a free project feed an attacker-crafted
  // image to sharp/libvips server-side.
  // Don't leak host-specific build details.
  poweredByHeader: false,
};

export default nextConfig;
