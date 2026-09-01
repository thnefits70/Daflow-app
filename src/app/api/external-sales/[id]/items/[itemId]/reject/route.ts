import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canReviewExternalSales } from "@/lib/guards";
import { notifyAdvisorItemRejected } from "@/lib/externalSales";

const schema = z.object({ reason: z.string().trim().min(1, "Explica por qué se rechaza.") });

// Confirmado 2026-09-01, pedido explícito del usuario: Bryan puede rechazar
// un producto puntual (ej. precio mal) sin tumbar toda la venta — solo le
// llega el aviso al asesor sobre ese producto, no sobre los demás. Mientras
// haya algún producto rechazado, la venta no se puede aprobar completa (ver
// /review).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  if (!(await canReviewExternalSales())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id, itemId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({ where: { id }, select: { reviewStatus: true, advisorId: true, code: true } });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (sale.reviewStatus !== "PENDING") return NextResponse.json({ error: "Esta venta ya fue revisada." }, { status: 409 });

  const item = await prisma.externalSaleItem.findUnique({
    where: { id: itemId },
    select: { saleId: true, rejectedAt: true, declaredProductName: true, catalogItem: { select: { name: true } } },
  });
  if (!item || item.saleId !== id) return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });
  if (item.rejectedAt) return NextResponse.json({ error: "Este producto ya está rechazado." }, { status: 409 });

  await prisma.externalSaleItem.update({
    where: { id: itemId },
    data: { rejectedAt: new Date(), rejectionReason: parsed.data.reason },
  });

  await notifyAdvisorItemRejected(sale.advisorId, sale.code, item.catalogItem?.name ?? item.declaredProductName, parsed.data.reason);

  return NextResponse.json({ ok: true });
}
