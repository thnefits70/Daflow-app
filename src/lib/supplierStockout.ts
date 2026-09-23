import { notifyOwner } from "@/lib/notifications";
import { getSupplierStockoutResolverIds } from "@/lib/guards";

const URL_BASE = "/area/workspace?tab=analisis-mercado&ptab=sinstock";

// Confirmado 2026-09-23, pedido de Jariel (vía el usuario): apenas Jariel
// reporta que un producto ya no se consigue con ningún proveedor, les llega
// de una a Heidy y a Bryan (getSupplierStockoutResolverIds) para que decidan
// cerrar el ID en Dropi o bajar el stock a 0 — antes esto se avisaba por
// fuera del sistema (WhatsApp/llamada), sin quedar registro.
export async function notifySupplierStockoutReported(report: { catalogItemName: string; instructionNote: string; reportedByName: string | null }): Promise<void> {
  const resolverIds = await getSupplierStockoutResolverIds();
  const title = "Producto sin stock de proveedor";
  const body = `${report.reportedByName ?? "Compras"} reportó "${report.catalogItemName}" — ${report.instructionNote}`;
  await Promise.all(resolverIds.map((id) => notifyOwner(id, { title, body, url: URL_BASE }).catch(() => null)));
}
