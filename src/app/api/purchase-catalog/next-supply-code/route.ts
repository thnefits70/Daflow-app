import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canUsePurchaseRequestForm } from "@/lib/guards";
import { formatSupplyCode, nextSupplyNumber } from "@/lib/supplyCode";

// Vista previa del código automático de un Suministro nuevo (2026-10-05).
// Es solo para mostrarlo en el formulario: el código real se asigna al
// guardar (POST /api/purchase-catalog), por si otro suministro entra antes.
export async function GET(req: NextRequest) {
  if (!(await canUsePurchaseRequestForm())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const name = req.nextUrl.searchParams.get("name") ?? "";
  const rows = await prisma.purchaseCatalogItem.findMany({
    where: { bodega: "MKT_SUMINISTROS", justCode: { contains: "-SUM-" } },
    select: { justCode: true },
  });
  return NextResponse.json({ code: formatSupplyCode(name, nextSupplyNumber(rows.map((r) => r.justCode))) });
}
