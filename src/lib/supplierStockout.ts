import { notifyOwner } from "@/lib/notifications";
import { getSupplierStockoutResolverIds } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

const URL_BASE = "/area/workspace?tab=analisis-mercado&ptab=sinstock";

// Confirmado 2026-09-23, pedido de Jariel (vía el usuario): apenas Jariel
// reporta que un producto ya no se consigue con ningún proveedor, les llega
// de una a Heidy y a Bryan (getSupplierStockoutResolverIds) para que decidan
// cerrar el ID en Dropi o bajar el stock a 0 — antes esto se avisaba por
// fuera del sistema (WhatsApp/llamada), sin quedar registro.
export async function notifySupplierStockoutReported(report: { catalogItemName: string; instructionNote: string; reportedByName: string | null }): Promise<void> {
  const [resolverIds, mktMembers] = await Promise.all([
    getSupplierStockoutResolverIds(),
    // Pedido del usuario 2026-10-07 (Yair): el resto del equipo de MKT
    // (asesores que venden en sus tiendas) también se entera, solo como aviso.
    prisma.user.findMany({ where: { isActive: true, department: { code: "MKT" } }, select: { id: true } }),
  ]);
  const ids = new Set([...resolverIds, ...mktMembers.map((u) => u.id)]);
  const title = "Producto sin stock de proveedor";
  const body = `${report.reportedByName ?? "Compras"} reportó "${report.catalogItemName}" — ${report.instructionNote}`;
  await Promise.all([...ids].map((id) => notifyOwner(id, { title, body, url: URL_BASE }).catch(() => null)));
}

// Para Inicio de quien no resuelve (ej. Yair): los reportados en los
// últimos 3 días, resueltos o no, para que deje de ofrecerlos en su tienda.
export const SUPPLIER_STOCKOUT_INFO_DAYS = 3;
