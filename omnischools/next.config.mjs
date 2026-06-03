/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
