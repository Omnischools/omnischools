import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://omnischools.gh";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // App (tenant) and API surfaces are not for indexing.
      disallow: ["/api/", "/basic/", "/senior/"],
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
