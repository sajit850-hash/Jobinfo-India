import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const pages = ["", "/jobs", "/companies", "/institutions", "/pricing", "/for-recruiters", "/about", "/contact", "/faqs"];
  return pages.map((page) => ({ url: new URL(page, base).toString(), changeFrequency: page === "" ? "daily" : "weekly", priority: page === "" ? 1 : 0.7 }));
}
