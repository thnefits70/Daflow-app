import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";
import { getMarketingLeadId, getInventoryLeadId, getFulfilmentLeadId } from "@/lib/guards";

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

// Yair confirmó un lote nuevo — les llega DE UNA a quienes tienen
// canAssignCancelledGuideItems (hoy Heidy), en paralelo con el aviso a
// Bryan. Pedido explícito del usuario 2026-09-02: cargar productos no
// tiene que esperar a que Bryan termine de gestionar con Dropi, los dos
// pasos corren a la par.
export async function notifyItemAssigneesNewBatch(batchCode: string, guideCount: number): Promise<void> {
  const assignees = await prisma.user.findMany({ where: { canAssignCancelledGuideItems: true, isActive: true }, select: { id: true } });
  const body = guideCount === 1 ? `${batchCode} — 1 guía nueva, cargá qué venía.` : `${batchCode} — ${guideCount} guías nuevas, cargá qué venía en cada una.`;
  await Promise.all(
    assignees.map((u) =>
      notifyOwner(u.id, { title: "Guías canceladas para cargar productos", body, url: `${URL_BASE}&sub=productos` }).catch(() => null)
    )
  );
}

// Agregado 2026-09-03, pedido explícito del usuario: apenas Bryan gestiona
// un lote, le llega a Yair (líder FUL) para que confirme que ya sacó esas
// guías del área de Fulfillment (fulfillmentRemovedAt) — paso nuevo, antes
// de que el lote pueda llegar a Daniel.
export async function notifyFulfillmentLeadBatchManaged(batchCode: string, guideCount: number): Promise<void> {
  const leadId = await getFulfilmentLeadId();
  if (!leadId) return;
  const body = guideCount === 1 ? `${batchCode} — 1 guía gestionada, confirmá que la sacaste de Fulfillment.` : `${batchCode} — ${guideCount} guías gestionadas, confirmá que las sacaste de Fulfillment.`;
  await notifyOwner(leadId, { title: "Lote gestionado — sacalo de Fulfillment", body, url: `${URL_BASE}&sub=salida-fulfillment` }).catch(() => null);
}

// Una guía queda lista para Daniel recién cuando los TRES pasos (Bryan
// gestionó + Yair confirmó que sacó el lote de Fulfillment + productos
// cargados) están hechos, sin importar cuál terminó primero — se llama
// desde los lugares donde eso puede completarse.
export async function notifyInventoryLeadCancelledGuidesReady(codes: string[]): Promise<void> {
  if (codes.length === 0) return;
  const leadId = await getInventoryLeadId();
  if (!leadId) return;
  const body = codes.length === 1 ? `${codes[0]} — ya tiene los productos cargados.` : `${codes.length} guías listas — ${codes.join(", ")}.`;
  await notifyOwner(leadId, { title: "Guía cancelada lista — reingresar a Just", body, url: `${URL_BASE}&sub=reingreso` }).catch(() => null);
}
