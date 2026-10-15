import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { TopLine } from "@/components/ui/TopLine";
import { canActOnMerchandiseOutflow, canCaptureMerchandiseOutflow } from "@/lib/guards";
import { StockCountPanel } from "@/components/inventory/StockCountPanel";
import { GuideVariantReview } from "@/components/inventory/GuideVariantReview";
import { VariantListEditor } from "@/components/inventory/VariantListEditor";

// Conteo físico de inventario (pedido del usuario 2026-10-02): el equipo de
// Inventario cuenta a ciegas desde el celular; Daniel revisa y envía.
export default async function ConteoInventarioPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const isLead = await canActOnMerchandiseOutflow();
  if (!isLead && !(await canCaptureMerchandiseOutflow())) notFound();
  return (
    <div>
      <TopLine eyebrow="INVESTOCK" title="Conteo de inventario" />
      {/* Daniel une los colores/tallas de las guías con la lista del conteo (2026-10-06). */}
      {isLead && <GuideVariantReview />}
      {/* Todo el equipo edita tallas y colores, siempre (2026-10-15). */}
      <VariantListEditor isLead={isLead} />
      <StockCountPanel />
    </div>
  );
}
