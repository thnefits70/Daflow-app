import { getPublicCatalog } from "@/lib/provedixPublic";
import { PvxCatalog } from "@/components/pvx/PvxCatalog";

// Página pública de provedix.com (etapa 3, pedido del usuario 2026-10-12).
// Se arma una vez cada 10 minutos (o al recalcular el resumen) y se sirve
// igual a todos desde el caché de Vercel: aguanta muchas visitas sin tocar
// la base. Lo personal (si ya se registró, la ficha completa) lo pide el
// navegador aparte.
export const revalidate = 600;

export default async function ProvedixPublicPage() {
  const { windowTo, cards } = await getPublicCatalog();
  return <PvxCatalog cards={cards} windowTo={windowTo} />;
}
