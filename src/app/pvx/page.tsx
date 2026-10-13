import { getPublicCatalog, getPublicStats } from "@/lib/provedixPublic";
import { PvxCatalog } from "@/components/pvx/PvxCatalog";

// Página pública de provedix.com (etapa 3, pedido del usuario 2026-10-12).
// Se arma como mucho una vez por minuto (antes 10: el "hay stock / agotado"
// tiene que verse casi al instante, 2026-10-12), al recalcular el resumen o
// cuando un producto pasa de 0 a tener stock, y se sirve igual a todos desde
// el caché de Vercel: aguanta muchas visitas sin tocar la base. Lo personal
// (si ya se registró, la ficha completa) lo pide el navegador aparte.
export const revalidate = 60;

// Ficha de la empresa para Google (2026-10-13, Bryan preguntó por qué Provedix
// no salía en el buscador): nombre, logo, Instagram y WhatsApp de atención.
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://provedix.com/#org",
      name: "Provedix",
      slogan: "Conectando productos y oportunidades",
      url: "https://provedix.com/",
      logo: "https://provedix.com/pvx/icon.png",
      image: "https://provedix.com/pvx/brand/stacked-orange.png",
      description: "Proveedor verificado de Dropi en Ecuador para dropshippers: productos ganadores, más de 3 cortes diarios y despacho en menos de 3 horas.",
      address: { "@type": "PostalAddress", addressLocality: "Guayaquil", addressCountry: "EC" },
      areaServed: "EC",
      sameAs: ["https://www.instagram.com/provedix.ec/", "https://www.tiktok.com/@provedix.ec", "https://www.facebook.com/share/1FHzeG3XBR/"],
      contactPoint: [{ "@type": "ContactPoint", telephone: "+593995147410", contactType: "customer service", areaServed: "EC", availableLanguage: "es" }],
    },
    { "@type": "WebSite", "@id": "https://provedix.com/#web", url: "https://provedix.com/", name: "Provedix", inLanguage: "es-EC", publisher: { "@id": "https://provedix.com/#org" } },
  ],
};

export default async function ProvedixPublicPage() {
  // Sin la fecha de corte: dejaría ver el retraso de los datos (pedido 2026-10-12).
  const [{ cards }, stats] = await Promise.all([getPublicCatalog(), getPublicStats()]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <PvxCatalog cards={cards} stats={stats} />
    </>
  );
}
