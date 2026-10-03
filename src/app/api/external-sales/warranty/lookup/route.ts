import { NextRequest, NextResponse } from "next/server";
import { canDeclareExternalSales } from "@/lib/guards";
import { lookupWarrantySource } from "@/lib/localWarranty";
import { WARRANTY_PICKUP_FREIGHT_AVG } from "@/lib/localWarrantyConstants";
import { bodegaUnitCost, resolveCostBasisForCatalogItems } from "@/lib/marketProduct";

// Lee el PDF ya guardado del corte para sacar cliente, dirección y productos
// de la guía — puede tardar en un lote grande.
export const maxDuration = 60;

// Pedido del usuario 2026-10-02: el asesor escribe la guía (o la venta
// VE-000X) y DAFLOW trae solo los datos de lo que de verdad salió.
export async function GET(req: NextRequest) {
  if (!(await canDeclareExternalSales())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const ref = req.nextUrl.searchParams.get("ref") ?? "";
  const result = await lookupWarrantySource(ref);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  // Pedido del usuario 2026-10-02: ¿conviene recoger el producto dañado?
  // Con el costo puesto en bodega de hoy (el mismo de los precios) contra el
  // flete promedio de recogida. Solo viaja la cantidad mínima, no el costo.
  const costs = await resolveCostBasisForCatalogItems(result.source.lines.map((l) => l.catalogItemId));
  const lines = result.source.lines.map((l) => {
    const b = costs.get(l.catalogItemId);
    const unit = b ? bodegaUnitCost(b.batchCost, b.freightCost, b.batchUnits) : 0;
    return { ...l, pickupMinQty: unit > 0 ? Math.max(1, Math.ceil(WARRANTY_PICKUP_FREIGHT_AVG / unit)) : null };
  });
  return NextResponse.json({ ...result.source, lines });
}
