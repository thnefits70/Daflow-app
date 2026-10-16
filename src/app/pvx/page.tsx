import { getPublicCatalog, getPublicStats } from "@/lib/provedixPublic";
import { PvxCatalog } from "@/components/pvx/PvxCatalog";
import { getPublicTestimonials } from "@/lib/provedixRatings";
import { PVX_FAQ } from "@/lib/pvxFaq";

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
      contactPoint: [{ "@type": "ContactPoint", telephone: "+593983809912", contactType: "customer service", areaServed: "EC", availableLanguage: "es" }],
    },
    { "@type": "WebSite", "@id": "https://provedix.com/#web", url: "https://provedix.com/", name: "Provedix", inLanguage: "es-EC", publisher: { "@id": "https://provedix.com/#org" } },
  ],
};

// Preguntas frecuentes y lista de productos para Google (2026-10-16). Solo
// nombre, foto y posición: el precio y las ventas se ven con registro. Las
// fotos van solo si salen por provedix.com (/pvx/f/…), nunca la dirección
// interna del almacenamiento.
function pageJsonLd(cards: { name: string; photo: string | null }[]) {
  const faq = {
    "@type": "FAQPage",
    "@id": "https://provedix.com/#preguntas",
    mainEntity: PVX_FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  const list = {
    "@type": "ItemList",
    "@id": "https://provedix.com/#productos",
    name: "Productos ganadores de Provedix",
    numberOfItems: Math.min(cards.length, 30),
    itemListElement: cards.slice(0, 30).map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      url: "https://provedix.com/#productos",
      ...(c.photo?.startsWith("/pvx/") ? { image: `https://provedix.com${c.photo}` } : {}),
    })),
  };
  return { "@context": "https://schema.org", "@graph": [...JSON_LD["@graph"], faq, ...(cards.length ? [list] : [])] };
}

export default async function ProvedixPublicPage() {
  // Sin la fecha de corte: dejaría ver el retraso de los datos (pedido 2026-10-12).
  const [{ cards }, stats, testimonials] = await Promise.all([getPublicCatalog(), getPublicStats(), getPublicTestimonials().catch(() => null)]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pageJsonLd(cards)).replace(/</g, "\\u003c") }} />
      <PvxCatalog cards={cards} stats={stats} testimonials={testimonials} />
    </>
  );
}
