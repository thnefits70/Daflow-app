import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";
import { getMarketingLeadId, getInventoryLeadId } from "@/lib/guards";

export async function nextCancelledGuideNumber(): Promise<number> {
  const updated = await prisma.platformSettings.update({
    where: { id: "singleton" },
    data: { lastCancelledGuideNumber: { increment: 1 } },
  });
  return updated.lastCancelledGuideNumber;
}

export function formatCancelledGuideCode(reportNumber: number): string {
  return `GC-${String(reportNumber).padStart(4, "0")}`;
}

export async function nextCancelledGuideBatchNumber(): Promise<number> {
  const updated = await prisma.platformSettings.update({
    where: { id: "singleton" },
    data: { lastCancelledGuideBatchNumber: { increment: 1 } },
  });
  return updated.lastCancelledGuideBatchNumber;
}

export function formatCancelledGuideBatchCode(batchNumber: number): string {
  return `LOTE-${String(batchNumber).padStart(4, "0")}`;
}

const URL_BASE = "/area/workspace?tab=egresos&otab=guias";

// Confirmado 2026-08-25: apenas se sube una guía a cancelar, Fulfillment
// entero se entera (son quienes despacharían físicamente) y en especial
// Daniel — pedido explícito del usuario, "en especial el líder de
// inventario debería [saber de] esas cancelaciones". Actualizado
// 2026-09-02: ahora se manda una sola vez por lote (no una por guía) para
// no saturar de pushes cuando Yair sube muchas guías juntas.
export async function notifyCancelledGuideBatchSubmitted(batchCode: string, guideCount: number): Promise<void> {
  const [fulfillmentTeam, invLeadId] = await Promise.all([
    prisma.user.findMany({ where: { department: { code: "FUL" } }, select: { id: true } }),
    getInventoryLeadId(),
  ]);
  const recipients = new Set([...fulfillmentTeam.map((u) => u.id), ...(invLeadId ? [invLeadId] : [])]);
  const body = guideCount === 1 ? `${batchCode} — 1 guía.` : `${batchCode} — ${guideCount} guías.`;
  await Promise.all(
    [...recipients].map((id) =>
      notifyOwner(id, { title: "🚫 Guías para cancelar — no despachar", body, url: URL_BASE }).catch(() => null)
    )
  );
}

// Yair confirmó un lote — le llega a Bryan (líder MKT) para que lo gestione
// con la transportadora/Dropi.
export async function notifyMarketingLeadBatchReceived(batchCode: string, guideCount: number): Promise<void> {
  const leadId = await getMarketingLeadId();
  if (!leadId) return;
  const body = guideCount === 1 ? `${batchCode} — 1 guía lista para gestionar.` : `${batchCode} — ${guideCount} guías listas para gestionar.`;
  await notifyOwner(leadId, { title: "Lote de guías canceladas para gestionar", body, url: `${URL_BASE}&sub=lotes` }).catch(() => null);
}

// Bryan confirmó que gestionó el lote con la transportadora/Dropi — les
// llega a quienes tienen canAssignCancelledGuideItems (hoy Heidy) para que
// carguen los productos de cada guía.
export async function notifyItemAssigneesBatchManaged(batchCode: string, guideCount: number): Promise<void> {
  const assignees = await prisma.user.findMany({ where: { canAssignCancelledGuideItems: true, isActive: true }, select: { id: true } });
  const body = guideCount === 1 ? `${batchCode} — 1 guía pendiente de cancelación, cargá qué venía.` : `${batchCode} — ${guideCount} guías pendientes de cancelación, cargá qué venía en cada una.`;
  await Promise.all(
    assignees.map((u) =>
      notifyOwner(u.id, { title: "Guías pendientes de cancelación", body, url: `${URL_BASE}&sub=productos` }).catch(() => null)
    )
  );
}

export async function notifyInventoryLeadCancelledGuideConfirmed(code: string): Promise<void> {
  const leadId = await getInventoryLeadId();
  if (!leadId) return;
  await notifyOwner(leadId, { title: "Guía cancelada lista — reingresar a Just", body: `${code} — ya tiene los productos cargados.`, url: `${URL_BASE}&sub=reingreso` }).catch(() => null);
}
