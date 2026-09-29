import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { TopLine } from "@/components/ui/TopLine";
import { dbUserId } from "@/lib/guards";
import { canViewSuddenDemand } from "@/lib/suddenDemand";
import { SuddenDemandPanel } from "@/components/marketanalysis/SuddenDemandPanel";

// Pedido de Daniel 2026-09-29: el aviso y la tarjeta de Inicio llevan acá,
// para las personas de su lista que no entran a Análisis de Mercado (Daniel,
// Yair, Nairoby). La misma lista está en Análisis de Mercado.
export default async function ProductosQueDespiertanPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const userId = dbUserId(session.user.id);
  if (session.user.role !== "admin" && !(userId && (await canViewSuddenDemand(userId)))) notFound();

  return (
    <div>
      <TopLine eyebrow="Análisis de Mercado" title="Productos que despiertan" />
      <SuddenDemandPanel />
    </div>
  );
}
