import { getPublicCatalog, getPublicStats } from "@/lib/provedixPublic";
import { PvxCatalog } from "@/components/pvx/PvxCatalog";

// Página pública de provedix.com (etapa 3, pedido del usuario 2026-10-12).
// Se arma como mucho una vez por minuto (antes 10: el "hay stock / agotado"
// tiene que verse casi al instante, 2026-10-12), al recalcular el resumen o
// cuando un producto pasa de 0 a tener stock, y se sirve igual a todos desde
// el caché de Vercel: aguanta muchas visitas sin tocar la base. Lo personal
// (si ya se registró, la ficha completa) lo pide el navegador aparte.
export const revalidate = 60;

export default async function ProvedixPublicPage() {
  // Sin la fecha de corte: dejaría ver el retraso de los datos (pedido 2026-10-12).
  const [{ cards }, stats] = await Promise.all([getPublicCatalog(), getPublicStats()]);
  return <PvxCatalog cards={cards} stats={stats} />;
}
