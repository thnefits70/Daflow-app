import { auth } from "@/auth";
import { canActOnMarketProductReview, canApprovePurchaseRequests, canCreateNewPurchaseRequests } from "@/lib/guards";

// Recompras (pedido del usuario 2026-10-06): envía quien compra (Jariel,
// Nairoby — mismo permiso que "Solicitar" en Control de Compras); decide solo
// el líder de Análisis de Mercado (Bryan Ríos), ni siquiera el admin, mismo
// criterio que la aprobación de Proponer. El admin y quien aprueba compras
// ven todo en solo lectura. El admin no envía: él no pasa por esta regla.
export async function getRepurchaseAccess() {
  const session = await auth();
  if (!session) return null;
  const isAdmin = session.user.role === "admin";
  const [canCreate, canDecide, canApprove] = await Promise.all([canCreateNewPurchaseRequests(), canActOnMarketProductReview(), canApprovePurchaseRequests()]);
  const canRequest = !isAdmin && canCreate;
  return {
    userId: session.user.id,
    name: session.user.name ?? "Alguien",
    isAdmin,
    canRequest,
    canDecide,
    canViewAll: isAdmin || canDecide || canApprove,
    canView: isAdmin || canRequest || canDecide || canApprove,
  };
}
