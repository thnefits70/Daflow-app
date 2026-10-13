import type { MetadataRoute } from "next";

// Mapa del sitio de provedix.com para Google (2026-10-13). Es una sola página.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: "https://provedix.com/", lastModified: new Date(), changeFrequency: "daily", priority: 1 }];
}
