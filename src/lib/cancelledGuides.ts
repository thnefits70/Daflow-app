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

const URL_BASE = "/area/workspace?tab=egresos&otab=guias";

// Confirmado 2026-08-25: apenas se sube una guía a cancelar, Fulfillment
// entero se entera (son quienes despacharían físicamente) y en especial
// Daniel — pedido explícito del usuario, "en especial el líder de
// inventario debería [saber de] esas cancelaciones".
export async function notifyCancelledGuideSubmitted(code: string, guideNumber: string): Promise<void> {
  const [fulfillmentTeam, invLeadId] = await Promise.all([
    prisma.user.findMany({ where: { department: { code: "FUL" } }, select: { id: true } }),
    getInventoryLeadId(),
  ]);
  const recipients = new Set([...fulfillmentTeam.map((u) => u.id), ...(invLeadId ? [invLeadId] : [])]);
  await Promise.all(
    [...recipients].map((id) =>
      notifyOwner(id, { title: "🚫 Guía para cancelar — no despachar", body: `${code} — guía ${guideNumber}.`, url: URL_BASE }).catch(() => null)
    )
  );
}

export async function notifyMarketingLeadCutoffReady(code: string): Promise<void> {
  const leadId = await getMarketingLeadId();
  if (!leadId) return;
  await notifyOwner(leadId, { title: "Guía cancelada lista para decidir", body: `${code} — confirma si realmente no se despachó.`, url: `${URL_BASE}&sub=corte` }).catch(() => null);
}

export async function notifyInventoryLeadCancelledGuideConfirmed(code: string): Promise<void> {
  const leadId = await getInventoryLeadId();
  if (!leadId) return;
  await notifyOwner(leadId, { title: "Guía cancelada confirmada — reingresar a Just", body: `${code} — Bryan confirmó que no se despachó.`, url: `${URL_BASE}&sub=reingreso` }).catch(() => null);
}
