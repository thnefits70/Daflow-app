import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { isProvedixHost } from "@/lib/provedixHosts";

// robots.txt según el dominio (pedido 2026-10-13: provedix.com no salía en
// Google — no había robots.txt ni sitemap). En provedix.com se deja buscar
// todo menos las rutas internas y se indica el sitemap. En cualquier otro
// dominio (DAFLOW) solo se esconde /pvx, para que Google no indexe la página
// pública dos veces ni la asocie con DAFLOW.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host")?.split(":")[0];
  if (isProvedixHost(host)) {
    return {
      rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
      sitemap: "https://provedix.com/sitemap.xml",
      host: "https://provedix.com",
    };
  }
  return { rules: { userAgent: "*", disallow: ["/pvx"] } };
}
