import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://omnischools.gh";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/about", "/pricing", "/faq", "/contact", "/start", "/login"];
  return routes.map((path) => ({
    url: `${BASE}${path}`,
    changeFrequency: "monthly",
    priority: path === "" ? 1 : 0.7,
  }));
}
