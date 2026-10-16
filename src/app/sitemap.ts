import type { MetadataRoute } from "next";

// Mapa del sitio de provedix.com para Google (2026-10-13). La portada, sus
// enlaces para compartir y la política de privacidad (2026-10-16).
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://provedix.com/", lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: "https://provedix.com/calculadora", changeFrequency: "monthly", priority: 0.6 },
    { url: "https://provedix.com/michelle", changeFrequency: "monthly", priority: 0.5 },
    { url: "https://provedix.com/privacidad", changeFrequency: "yearly", priority: 0.2 },
  ];
}
