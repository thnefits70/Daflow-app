import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";
import { checkCatalogItemDeletable } from "@/lib/stockKardex";

const schema = z.object({ action: z.enum(["approve", "reject"]) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const deleteRequest = await prisma.purchaseCatalogItemDeleteRequest.findUnique({ where: { id } });
  if (!deleteRequest) return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });

  if (parsed.data.action === "reject") {
    await prisma.purchaseCatalogItemDeleteRequest.delete({ where: { id } });
    return NextResponse.json({ ok: true, deleted: false });
  }

  // Confirmado 2026-09-21: además de compras (PurchaseRequest), un producto
  // tampoco se puede borrar de verdad si tiene lotes de caducidad, es
  // componente de un combo, ya se pidió en Fulfillment, o tiene movimiento
  // real en el Kardex — todas relaciones con onDelete: Restrict en el
  // schema. Antes solo se revisaba PurchaseRequest, así que esto podía
  // reventar con un error crudo de llave foránea (y de paso nunca borraba
  // la línea "SEED" que todo producto tiene en el Kardex desde la carga
  // inicial de INVESTOCK). Ver checkCatalogItemDeletable en stockKardex.ts.
  const check = await checkCatalogItemDeletable(deleteRequest.itemId);
  if (!check.deletable) {
    return NextResponse.json({ error: check.reason }, { status: 409 });
  }

  await prisma.$transaction([
    prisma.purchaseCatalogItemDeleteRequest.delete({ where: { id } }),
    prisma.stockKardexEntry.deleteMany({ where: { catalogItemId: deleteRequest.itemId } }),
    prisma.purchaseCatalogItem.delete({ where: { id: deleteRequest.itemId } }),
  ]);
  return NextResponse.json({ ok: true, deleted: true });
}
