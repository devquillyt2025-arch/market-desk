import type { MetadataRoute } from "next";

import { getSiteUrl } from "@/lib/siteUrl";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const lastModified = new Date();

  return [
    { url: siteUrl, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/notes`, lastModified, changeFrequency: "weekly", priority: 0.7 },
    { url: `${siteUrl}/history`, lastModified, changeFrequency: "weekly", priority: 0.6 },
    { url: `${siteUrl}/links`, lastModified, changeFrequency: "monthly", priority: 0.5 },
    { url: `${siteUrl}/logs`, lastModified, changeFrequency: "weekly", priority: 0.3 },
  ];
}
