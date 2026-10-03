import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";

// Pedido del usuario 2026-10-03 (AM-0018 "Casco de Gateo para Bebe"): una
// propuesta de Análisis de Mercado ya aprobada que al final no se va a vender
// quedaba "aprobada" para siempre. Se cancela (pasa a Rechazado con motivo)
// solo si todavía no está publicada en Dropi y su producto no tiene ninguna
// compra viva (pendiente, aprobada o recibida) — si ya hay mercadería o ID
// real, no es cancelar, es dar de baja un producto real. El catálogo
// provisional se queda (las compras rechazadas lo referencian) y sigue con
// awaitingDropiId, así que no entra a INVESTOCK ni a duplicados.
// Usado por el botón de Trazabilidad y por el rechazo de compras.
export async function cancelMarketProposal(params: { proposalId: string; reason: string; actorUserId: string | null }): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const existing = await prisma.marketProductProposal.findUnique({ where: { id: params.proposalId } });
  if (!existing) return { ok: false, error: "No encontrada.", status: 404 };
  if (existing.status !== "APPROVED") return { ok: false, error: "Solo se puede cancelar una propuesta aprobada.", status: 409 };
  if (existing.publishedAt || existing.dropiProductId) return { ok: false, error: "Ya está publicada en Dropi — no se puede cancelar.", status: 409 };
  if (existing.catalogItemId) {
    const live = await prisma.purchaseRequest.count({ where: { catalogItemId: existing.catalogItemId, status: { not: "REJECTED" } } });
    if (live > 0) return { ok: false, error: "Tiene compras en curso o recibidas — no se puede cancelar.", status: 409 };
  }

  await prisma.marketProductProposal.update({
    where: { id: existing.id },
    data: { status: "REJECTED", rejectReason: `Cancelada después de aprobada: ${params.reason}`, readyToBuyAt: null, readyToBuyById: null },
  });

  if (existing.proposedById && existing.proposedById !== params.actorUserId) {
    await notifyOwner(existing.proposedById, {
      title: "Propuesta cancelada",
      body: `${existing.code} ${existing.productName} — ${params.reason}`,
      url: "/area/workspace?tab=analisis-mercado",
    }).catch(() => null);
  }
  return { ok: true };
}
