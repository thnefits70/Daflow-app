import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow } from "@/lib/guards";
import { notifyColaboradorDispatchAssigned, saleItemsSummary } from "@/lib/externalSales";

// `reassign` (2026-10-01, pedido de Marcos): Daniel cambia a quién le tocó
// agrupar mientras todavía no se marcó listo — no agrupa él mismo.
const schema = z.object({ colaboradorId: z.string().min(1), reassign: z.boolean().optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnMerchandiseOutflow()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Falta el colaborador." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: {
      reviewStatus: true,
      dispatchAssignedToId: true,
      prepReadyAt: true,
      code: true,
      items: { select: { declaredProductName: true, catalogItem: { select: { name: true } } } },
    },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (sale.reviewStatus !== "APPROVED") return NextResponse.json({ error: "Esta venta todavía no está aprobada." }, { status: 409 });
  const reassign = !!parsed.data.reassign;
  if (sale.dispatchAssignedToId && !reassign) return NextResponse.json({ error: "Ya fue asignada." }, { status: 409 });
  if (reassign) {
    if (!sale.dispatchAssignedToId) return NextResponse.json({ error: "Todavía no tiene a nadie asignado." }, { status: 409 });
    if (sale.prepReadyAt) return NextResponse.json({ error: "Ya se agrupó, no se puede reasignar." }, { status: 409 });
    if (sale.dispatchAssignedToId === parsed.data.colaboradorId) return NextResponse.json({ error: "Ya está asignada a esa persona." }, { status: 409 });
  }

  const colaborador = await prisma.user.findFirst({ where: { id: parsed.data.colaboradorId, department: { code: "INV" }, isActive: true }, select: { id: true } });
  if (!colaborador) return NextResponse.json({ error: "Colaborador no encontrado en Inventario." }, { status: 404 });

  const updated = await prisma.externalSale.update({
    where: { id, prepReadyAt: null },
    data: { dispatchAssignedToId: colaborador.id, dispatchAssignedAt: new Date(), dispatchAssignedById: session.user.id },
  });

  await notifyColaboradorDispatchAssigned(colaborador.id, sale.code, saleItemsSummary(sale.items));
  return NextResponse.json(updated);
}
