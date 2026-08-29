import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow } from "@/lib/guards";
import { outflowItemDisplayName } from "@/lib/merchandiseOutflow";
import { notifyColaboradorDispatchAssigned } from "@/lib/externalSales";

const schema = z.object({ colaboradorId: z.string().min(1) });

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
      isContraEntrega: true,
      invoiceUploadedAt: true,
      code: true,
      declaredProductName: true,
      catalogItem: { select: { name: true } },
    },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (sale.reviewStatus !== "APPROVED") return NextResponse.json({ error: "Esta venta todavía no está aprobada." }, { status: 409 });
  if (!sale.isContraEntrega && !sale.invoiceUploadedAt) return NextResponse.json({ error: "Falta que Nairoby facture esta venta." }, { status: 409 });
  if (sale.dispatchAssignedToId) return NextResponse.json({ error: "Ya fue asignada." }, { status: 409 });

  const colaborador = await prisma.user.findFirst({ where: { id: parsed.data.colaboradorId, department: { code: "INV" } }, select: { id: true } });
  if (!colaborador) return NextResponse.json({ error: "Colaborador no encontrado en Inventario." }, { status: 404 });

  const updated = await prisma.externalSale.update({
    where: { id },
    data: { dispatchAssignedToId: colaborador.id, dispatchAssignedAt: new Date(), dispatchAssignedById: session.user.id },
  });

  await notifyColaboradorDispatchAssigned(colaborador.id, sale.code, outflowItemDisplayName({ declaredName: sale.declaredProductName, catalogItem: sale.catalogItem }));
  return NextResponse.json(updated);
}
