import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";
import { getInventoryLeadId, getMarketingLeadId } from "@/lib/guards";

// Pedido del usuario 2026-09-30 (caso 168766 Mesa Auxiliar Doble Repisa):
// un cliente compró en Dropi un producto que NO tenemos ni vamos a comprar.
// Yair lo marca en el PDF de guías como "Producto dado de baja / no lo
// tenemos": no sale ni descuenta stock. Heidy es quien entra a Dropi y lo da
// de baja; Daniel, Bryan Ríos (líder MKT) y Jariel reciben el mismo aviso
// para estar pendientes de qué pasa con esos pedidos.

export const DISCONTINUED_URL = "/area/workspace?tab=analisis-mercado&ptab=sinstock";

// Quien da de baja en Dropi: Heidy, por el mismo flag de "Sin stock de
// proveedor" (sin el líder de MKT — el usuario: "Heidy es la que entra a
// Dropi y da de baja").
export async function getDropiDelisterIds(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true, canResolveSupplierStockout: true, NOT: { isLeader: true, leadsDept: { code: "MKT" } } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

// Solo para estar pendientes: Bryan Ríos y Jariel (canManagePurchases
// dentro de MKT — Nairoby también lo tiene pero es de Finanzas). Daniel va
// aparte porque no ve Análisis de Mercado: su aviso abre el corte.
async function getDiscontinuedWatcherIds(): Promise<string[]> {
  const [bryanId, jariel] = await Promise.all([
    getMarketingLeadId(),
    prisma.user.findMany({ where: { isActive: true, canManagePurchases: true, department: { code: "MKT" } }, select: { id: true } }),
  ]);
  return [...new Set([bryanId, ...jariel.map((u) => u.id)].filter((x): x is string => !!x))];
}

export async function notifyDiscontinuedSales(batchId: string): Promise<void> {
  const sales = await prisma.dropiDiscontinuedSale.findMany({ where: { batchId }, orderBy: { name: "asc" } });
  if (sales.length === 0) return;
  const detail = sales
    .map((s) => `${s.name} (ID ${s.code}) · ${s.quantity} unid.${s.guideNumbers.length ? ` · guía ${s.guideNumbers.join(", ")}` : ""}`)
    .join("; ");
  const [delisters, watchers, danielId, bryanId] = await Promise.all([getDropiDelisterIds(), getDiscontinuedWatcherIds(), getInventoryLeadId(), getMarketingLeadId()]);
  const title = sales.length === 1 ? "Se vendió un producto dado de baja" : `Se vendieron ${sales.length} productos dados de baja`;
  // Pedido del usuario 2026-09-30: Heidy da de baja el producto y cancela el
  // pedido; como la guía ya se generó, Bryan Ríos gestiona con la gente de
  // Dropi para que la anulen allá (no se va a despachar).
  const heidyBody = `${detail}. No lo tenemos, así que ese pedido no sale. Entra a Dropi, da de baja el producto y cancela el pedido; después marca "Ya lo di de baja".`;
  const bryanBody = `${detail}. No lo tenemos, así que ese pedido no se despacha. La guía ya se generó: gestiona con la gente de Dropi para que den de baja ese pedido allá y después marca "Dropi ya anuló la guía". Heidy da de baja el producto en Dropi.`;
  const watcherBody = `${detail}. No lo tenemos, así que ese pedido no sale. Heidy lo da de baja en Dropi y Bryan gestiona con Dropi que anulen la guía. Estén pendientes de ese pedido.`;
  await Promise.all([
    ...delisters.map((id) => notifyOwner(id, { title, body: heidyBody, url: DISCONTINUED_URL }).catch(() => null)),
    ...watchers
      .filter((id) => !delisters.includes(id) && id !== danielId)
      .map((id) => notifyOwner(id, { title: id === bryanId ? "Guía generada de un producto dado de baja" : title, body: id === bryanId ? bryanBody : watcherBody, url: DISCONTINUED_URL }).catch(() => null)),
    ...(danielId && !delisters.includes(danielId)
      ? [notifyOwner(danielId, { title, body: `${watcherBody} No hay que sacarlo de bodega.`, url: "/area/workspace?tab=egresos&otab=solicitud" }).catch(() => null)]
      : []),
  ]);
}

export async function getDiscontinuedPendingCount(): Promise<number> {
  return prisma.dropiDiscontinuedSale.count({ where: { delistedAt: null } });
}

// Guías de productos dados de baja que Bryan todavía no confirmó anuladas.
export async function getDiscontinuedOrderPendingCount(): Promise<number> {
  return prisma.dropiDiscontinuedSale.count({ where: { orderCancelledAt: null } });
}

export async function listDiscontinuedSales() {
  const rows = await prisma.dropiDiscontinuedSale.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const ids = [...new Set(rows.flatMap((r) => [r.reportedById, r.delistedById, r.orderCancelledById]).filter((x): x is string => !!x))];
  const people = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const nameOf = (id: string | null) => (id ? people.find((p) => p.id === id)?.name ?? null : null);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    quantity: r.quantity,
    guideNumbers: r.guideNumbers,
    carriers: r.carriers,
    createdAt: r.createdAt,
    reportedByName: nameOf(r.reportedById),
    delistedAt: r.delistedAt,
    delistedByName: nameOf(r.delistedById),
    orderCancelledAt: r.orderCancelledAt,
    orderCancelledByName: nameOf(r.orderCancelledById),
  }));
}
